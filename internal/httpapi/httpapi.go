// Package httpapi — handlers REST + SSE. Los handlers leen la CACHÉ de los
// colectores, nunca ejecutan comandos del sistema directamente.
// Errores: {"error":"código","message":"texto legible"} con HTTP 4xx/5xx.
package httpapi

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"runtime"
	"strings"
	"time"

	"easyzfs/internal/actions"
	"easyzfs/internal/alerts"
	"easyzfs/internal/auth"
	"easyzfs/internal/collectors"
	"easyzfs/internal/config"
	"easyzfs/internal/hub"
	"easyzfs/internal/push"
	"easyzfs/internal/scheduler"
	"easyzfs/internal/settings"
	"easyzfs/internal/users"
)

// Server — dependencias inyectadas desde main (sin framework de DI).
type Server struct {
	cfg        *config.Config
	db         *sql.DB
	auth       *auth.Manager
	users      *users.Store
	alerter    *alerts.Alerter
	settings   *settings.Store
	pools      collectors.PoolProvider
	disks      collectors.DiskProvider
	sysTimers  collectors.SysTimerProvider
	act        *actions.Service
	sched      *scheduler.Scheduler
	jstore     *scheduler.Store
	h          *hub.Hub
	push       *push.Sender
	started    time.Time
	version    string
	build      string
	zfsVersion string

	loginLimiter *loginLimiter // rate limit de /api/login (IP+usuario)
}

// Deps — parámetros del constructor.
type Deps struct {
	Cfg        *config.Config
	DB         *sql.DB
	Auth       *auth.Manager
	Users      *users.Store
	Alerter    *alerts.Alerter
	Settings   *settings.Store
	Pools      collectors.PoolProvider
	Disks      collectors.DiskProvider
	SysTimers  collectors.SysTimerProvider
	Actions    *actions.Service
	Sched      *scheduler.Scheduler
	Jobs       *scheduler.Store
	Hub        *hub.Hub
	Push       *push.Sender
	Version    string
	Build      string
	ZFSVersion string
}

// NewServer crea el servidor del API.
func NewServer(d Deps) *Server {
	return &Server{
		cfg: d.Cfg, db: d.DB, auth: d.Auth, users: d.Users,
		alerter: d.Alerter, settings: d.Settings,
		pools: d.Pools, disks: d.Disks, sysTimers: d.SysTimers,
		act: d.Actions, sched: d.Sched, jstore: d.Jobs, h: d.Hub, push: d.Push,
		started: time.Now(), version: d.Version, build: d.Build, zfsVersion: d.ZFSVersion,
		loginLimiter: newLoginLimiter(),
	}
}

// Handler monta el árbol de rutas: /api/login público, resto tras auth,
// mutaciones bloqueadas en modo demo.
func (s *Server) Handler() http.Handler {
	root := http.NewServeMux()
	root.HandleFunc("POST /api/login", s.login)

	a := http.NewServeMux()
	// sesión
	a.HandleFunc("POST /api/logout", s.logout)
	a.HandleFunc("GET /api/me", s.me)
	a.HandleFunc("POST /api/me/password", s.changeMyPassword)
	// usuarios (admin)
	a.HandleFunc("GET /api/users", s.auth.RequireAdmin(s.listUsers))
	a.HandleFunc("POST /api/users", s.auth.RequireAdmin(s.createUser))
	a.HandleFunc("DELETE /api/users/{name}", s.auth.RequireAdmin(s.deleteUser))
	a.HandleFunc("POST /api/users/{name}/password", s.auth.RequireAdmin(s.setUserPassword))
	// sistema
	a.HandleFunc("GET /api/version", s.getVersion)
	a.HandleFunc("GET /api/settings", s.getSettings)
	a.HandleFunc("PUT /api/settings", s.auth.RequireAdmin(s.putSettings))
	a.HandleFunc("GET /api/alerts", s.listAlerts)
	a.HandleFunc("POST /api/alerts/{id}/ack", s.ackAlert)
	a.HandleFunc("GET /api/overview", s.getOverview)
	a.HandleFunc("GET /api/system-timers", s.listSystemTimers)
	a.HandleFunc("POST /api/system-timers/schedule", s.auth.RequireAdmin(s.sysTimerSchedule))
	a.HandleFunc("POST /api/system-timers/migrate", s.auth.RequireAdmin(s.sysTimerMigrate))
	// pools (mutaciones: admin — son potencialmente destructivas)
	a.HandleFunc("GET /api/pools", s.listPools)
	a.HandleFunc("POST /api/pools", s.auth.RequireAdmin(s.createPool))
	a.HandleFunc("POST /api/pools/import", s.auth.RequireAdmin(s.importPool))
	a.HandleFunc("POST /api/pools/{name}/scrub", s.auth.RequireAdmin(s.scrubPool))
	a.HandleFunc("POST /api/pools/{name}/export", s.auth.RequireAdmin(s.exportPool))
	a.HandleFunc("POST /api/pools/{name}/vdev", s.auth.RequireAdmin(s.addVdev))
	a.HandleFunc("POST /api/pools/{name}/vdev/action", s.auth.RequireAdmin(s.vdevAction))
	a.HandleFunc("POST /api/pools/{name}/replace", s.auth.RequireAdmin(s.replaceDisk))
	// datasets
	a.HandleFunc("GET /api/datasets", s.listDatasets)
	a.HandleFunc("POST /api/datasets", s.auth.RequireAdmin(s.createDataset))
	a.HandleFunc("PATCH /api/datasets/{name}", s.auth.RequireAdmin(s.patchDataset))
	a.HandleFunc("DELETE /api/datasets/{name}", s.auth.RequireAdmin(s.deleteDataset))
	// snapshots
	a.HandleFunc("GET /api/snapshots", s.listSnapshots)
	a.HandleFunc("POST /api/snapshots", s.auth.RequireAdmin(s.createSnapshot))
	a.HandleFunc("DELETE /api/snapshots/{full}", s.auth.RequireAdmin(s.deleteSnapshot))
	a.HandleFunc("POST /api/snapshots/{full}/rollback", s.auth.RequireAdmin(s.rollbackSnapshot))
	// jobs
	a.HandleFunc("GET /api/jobs", s.listJobs)
	a.HandleFunc("POST /api/jobs", s.auth.RequireAdmin(s.createJob))
	a.HandleFunc("GET /api/jobs/history", s.jobsHistory)
	a.HandleFunc("PATCH /api/jobs/{id}", s.auth.RequireAdmin(s.patchJob))
	a.HandleFunc("DELETE /api/jobs/{id}", s.auth.RequireAdmin(s.deleteJob))
	a.HandleFunc("POST /api/jobs/{id}/run", s.auth.RequireAdmin(s.runJob))
	// discos
	a.HandleFunc("GET /api/disks", s.listDisks)
	a.HandleFunc("POST /api/disks/{dev}/smart-test", s.auth.RequireAdmin(s.smartTest))
	a.HandleFunc("POST /api/disks/{dev}/poweroff", s.auth.RequireAdmin(s.powerOff))
	// notificaciones push (Web Push; 503 push_not_configured sin claves VAPID)
	a.HandleFunc("GET /api/push/vapid-public-key", s.getPushVapidKey)
	a.HandleFunc("POST /api/push/subscribe", s.postPushSubscribe)
	a.HandleFunc("DELETE /api/push/unsubscribe", s.deletePushUnsubscribe)
	// SSE (con el usuario de la sesión para la regla no-duplicar push/SSE)
	a.Handle("GET /api/events", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.h.ServeSSE(w, r, actor(r))
	}))

	root.Handle("/api/", s.auth.Middleware(s.demoGuard(a)))
	return root
}

// demoGuard — en DEMO=1 las mutaciones devuelven 403 demo_mode
// (excepto logout y ack de alertas, inofensivas y necesarias para la demo).
func (s *Server) demoGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.Demo && r.Method != http.MethodGet && r.Method != http.MethodHead {
			allowed := r.URL.Path == "/api/logout" ||
				(strings.HasPrefix(r.URL.Path, "/api/alerts/") && strings.HasSuffix(r.URL.Path, "/ack"))
			if !allowed {
				writeErr(w, http.StatusForbidden, "demo_mode", "modo demo: las mutaciones están desactivadas")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// --- helpers ---

// writeJSON serializa v con el código dado.
func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("httpapi: encode: %v", err)
	}
}

// writeErr — formato de error del contrato.
func writeErr(w http.ResponseWriter, code int, errCode, msg string) {
	writeJSON(w, code, map[string]string{"error": errCode, "message": msg})
}

// decodeJSON decodifica el body; false = ya se escribió el error 400.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(dst); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json", "body JSON inválido: "+err.Error())
		return false
	}
	return true
}

// requireConfirm valida {"confirm":"<target>"} en destructivas (lección 6).
func requireConfirm(w http.ResponseWriter, confirm, target string) bool {
	if confirm != target || target == "" {
		writeErr(w, http.StatusBadRequest, "confirm_required",
			"se requiere {\"confirm\":\""+target+"\"} para confirmar la operación")
		return false
	}
	return true
}

// actor — usuario autenticado para el audit_log.
func actor(r *http.Request) string {
	return auth.UserFromContext(r.Context())
}

// actionErr traduce errores de actions/scheduler a respuestas HTTP.
func actionErr(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		return
	case strings.Contains(err.Error(), "inválid"):
		writeErr(w, http.StatusBadRequest, "invalid_input", err.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "exec_error", err.Error())
	}
}

// memRSS — RSS aproximado del proceso vía runtime.ReadMemStats.
func memRSS() uint64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return m.Sys
}
