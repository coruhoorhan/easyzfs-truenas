// main.go — entrypoint de zfsctl.
// Wiring: config → db (migraciones) → settings → usuarios (bootstrap) →
// hub SSE → alerter → colectores → acciones → scheduler → HTTP.
// Graceful shutdown: drenar SSE → srv.Shutdown → cerrar SQLite.
package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gnacho/zfsctl/internal/actions"
	"github.com/gnacho/zfsctl/internal/alerts"
	"github.com/gnacho/zfsctl/internal/auth"
	"github.com/gnacho/zfsctl/internal/collectors"
	"github.com/gnacho/zfsctl/internal/config"
	"github.com/gnacho/zfsctl/internal/db"
	"github.com/gnacho/zfsctl/internal/hub"
	"github.com/gnacho/zfsctl/internal/httpapi"
	"github.com/gnacho/zfsctl/internal/scheduler"
	"github.com/gnacho/zfsctl/internal/settings"
	"github.com/gnacho/zfsctl/internal/users"
)

// Inyectadas por ldflags (-X main.version=... -X main.build=...).
var (
	version = "dev"
	build   = ""
)

//go:embed dist
var distFS embed.FS

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg := config.Load()

	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("sqlite: %v", err)
	}
	if err := db.Migrate(ctx, database); err != nil {
		log.Fatalf("migraciones: %v", err)
	}

	stStore, err := settings.NewStore(database)
	if err != nil {
		log.Fatalf("settings: %v", err)
	}

	userStore := users.NewStore(database)
	if err := userStore.Bootstrap(ctx, cfg.AdminPassword); err != nil {
		log.Fatalf("bootstrap usuarios: %v", err)
	}

	h := hub.NewHub()
	alerter := alerts.New(database, h, stStore)

	// Colectores (reales o mock) + providers para los handlers.
	providers, cols := collectors.Build(cfg, database, h, alerter)

	act := actions.NewService(database)
	jobStore := scheduler.NewStore(database)
	sched := scheduler.New(jobStore, act, h, providers.Disks.Disks)

	// Versión de OpenZFS del host (una vez, al arranque).
	zfsVersion := "mock"
	if !cfg.Mock {
		detCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		zfsVersion = collectors.DetectZFSVersion(detCtx)
		cancel()
	}

	srv := httpapi.NewServer(httpapi.Deps{
		Cfg: cfg, DB: database, Auth: auth.NewManager(database, cfg.SessionSecret, cfg.CookieSecure),
		Users: userStore, Alerter: alerter, Settings: stStore,
		Pools: providers.Pools, Disks: providers.Disks,
		Actions: act, Sched: sched, Jobs: jobStore, Hub: h,
		Version: version, Build: build, ZFSVersion: zfsVersion,
	})

	mux := http.NewServeMux()
	mux.Handle("/api/", srv.Handler())

	// SPA embebida: estáticos + fallback a index.html.
	webFS, err := fs.Sub(distFS, "dist")
	if err != nil {
		log.Fatalf("embed dist: %v", err)
	}
	mux.Handle("/", spaHandler(http.FS(webFS)))

	httpSrv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// Sin WriteTimeout global: mataría las conexiones SSE.
	}

	// Arranque de colectores y scheduler (goroutines con ctx cancelable).
	for _, c := range cols {
		go c.Run(ctx)
	}
	go sched.Run(ctx)

	go func() {
		log.Printf("zfsctl %s escuchando en %s (mock=%v demo=%v)", version, cfg.ListenAddr, cfg.Mock, cfg.Demo)
		if err := httpSrv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("apagando: drenando conexiones SSE y HTTP…")
	h.Close() // cierra clientes SSE con evento 'bye'
	shCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
	if err := database.Close(); err != nil {
		log.Printf("sqlite close: %v", err)
	}
	log.Println("apagado limpio")
}

// spaHandler sirve la SPA embebida: fichero si existe, index.html si no
// (fallback de rutas del cliente). Sin caché para index.html; estáticos con
// caché larga (Vite les pone hash en el nombre).
func spaHandler(fsys http.FileSystem) http.Handler {
	fileSrv := http.FileServer(fsys)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		f, err := fsys.Open(path)
		if err != nil {
			// fallback SPA: cualquier ruta no encontrada devuelve index.html
			r.URL.Path = "/"
			fileSrv.ServeHTTP(w, r)
			return
		}
		f.Close()
		fileSrv.ServeHTTP(w, r)
	})
}
