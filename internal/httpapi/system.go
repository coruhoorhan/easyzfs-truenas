// system.go — /api/version, /api/settings, /api/alerts, /api/overview.
package httpapi

import (
	"net/http"
	"runtime"
	"strconv"
	"time"

	"github.com/gnacho/zfsctl/internal/db"
	"github.com/gnacho/zfsctl/internal/model"
)

// getVersion — GET /api/version → estado del backend y del runtime.
func (s *Server) getVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"version":     s.version,
		"build":       s.build,
		"go":          runtime.Version(),
		"os_arch":     runtime.GOOS + "/" + runtime.GOARCH,
		"uptime_sec":  int64(time.Since(s.started).Seconds()),
		"rss_bytes":   memRSS(),
		"db_bytes":    db.SizeBytes(s.cfg.DBPath),
		"db_path":     s.cfg.DBPath,
		"zfs_version": s.zfsVersion,
		"demo":        s.cfg.Demo,
	})
}

// getSettings — GET /api/settings.
func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	st, err := s.settings.Load(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// putSettings — PUT /api/settings (admin) → 204.
func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var st settingsBody
	if !decodeJSON(w, r, &st) {
		return
	}
	cur, err := s.settings.Load(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	cur.Lang = st.Lang
	cur.CapWarnPct = st.CapWarnPct
	cur.CapCritPct = st.CapCritPct
	cur.DiskTempC = st.DiskTempC
	cur.Webhook = st.Webhook
	cur.NotifyScrubErrors = st.NotifyScrubErrors
	cur.NotifySmartChange = st.NotifySmartChange
	if err := s.settings.Save(r.Context(), cur); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	s.act.AuditOnly(r.Context(), actor(r), "settings.update", "settings", st)
	w.WriteHeader(http.StatusNoContent)
}

// settingsBody — body de PUT /api/settings (idéntico a settings.Settings).
type settingsBody struct {
	Lang              string `json:"lang"`
	CapWarnPct        int    `json:"cap_warn_pct"`
	CapCritPct        int    `json:"cap_crit_pct"`
	DiskTempC         int    `json:"disk_temp_c"`
	Webhook           string `json:"webhook"`
	NotifyScrubErrors bool   `json:"notify_scrub_errors"`
	NotifySmartChange bool   `json:"notify_smart_change"`
}

// listAlerts — GET /api/alerts → últimas 100.
func (s *Server) listAlerts(w http.ResponseWriter, r *http.Request) {
	list, err := s.alerter.List(r.Context(), 100)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// ackAlert — POST /api/alerts/{id}/ack → 204.
func (s *Server) ackAlert(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_id", "id de alerta inválido")
		return
	}
	if err := s.alerter.Ack(r.Context(), id); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// getOverview — GET /api/overview: KPIs agregados desde cachés + BD.
func (s *Server) getOverview(w http.ResponseWriter, r *http.Request) {
	pools := s.pools.Pools()
	snaps := s.pools.SnapshotGroups()

	ov := map[string]any{}
	ov["pools_total"] = len(pools)
	online := 0
	var used, total uint64
	var lastScrub *model.ScrubInfo
	var lastScrubPool string
	snapCount := 0
	for _, p := range pools {
		if p.Status == "ONLINE" {
			online++
		}
		used += p.UsedBytes
		total += p.TotalBytes
		if p.Scrub.State == "done" && (lastScrub == nil || p.Scrub.Ts.After(lastScrub.Ts)) {
			sc := p.Scrub
			lastScrub = &sc
			lastScrubPool = p.Name
		}
	}
	for _, g := range snaps {
		snapCount += len(g.Snaps)
	}
	ov["pools_online"] = online
	ov["cap_used_bytes"] = used
	ov["cap_total_bytes"] = total
	ov["snapshots_total"] = snapCount

	jobs, err := s.jstore.List(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	active := 0
	for _, j := range jobs {
		if j.Enabled {
			active++
		}
	}
	ov["jobs_active"] = active

	ls := map[string]any{"pool": lastScrubPool}
	if lastScrub != nil {
		ls["ts"] = lastScrub.Ts
		ls["errors"] = lastScrub.Errors
	} else {
		ls["pool"] = ""
		ls["ts"] = nil
		ls["errors"] = 0
	}
	ov["last_scrub"] = ls

	alerts, err := s.alerter.List(r.Context(), 3)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	ov["alerts"] = alerts

	activity, err := s.recentActivity(r, 10)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	ov["activity"] = activity

	writeJSON(w, http.StatusOK, ov)
}

// activityEntry — entrada de actividad reciente (audit_log).
type activityEntry struct {
	Ts     string `json:"ts"`
	Text   string `json:"text"`
	Detail string `json:"detail"`
}

// recentActivity — últimas acciones auditadas como actividad del dashboard.
func (s *Server) recentActivity(r *http.Request, limit int) ([]activityEntry, error) {
	rows, err := s.db.QueryContext(r.Context(),
		"SELECT ts, action, actor, target FROM audit_log ORDER BY id DESC LIMIT ?", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []activityEntry{}
	for rows.Next() {
		var e activityEntry
		var actorName, target string
		if err := rows.Scan(&e.Ts, &e.Text, &actorName, &target); err != nil {
			return nil, err
		}
		if t, err := time.Parse(time.RFC3339, e.Ts); err == nil {
			e.Ts = t.UTC().Format(time.RFC3339)
		}
		e.Detail = target
		if actorName != "" {
			e.Detail = actorName + " · " + target
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
