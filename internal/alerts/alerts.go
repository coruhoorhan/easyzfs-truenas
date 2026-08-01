// Package alerts — generación de alertas por umbrales (capacidad, temperatura,
// SMART, scrub con errores) en la tabla alerts + evento SSE alert.new.
// Dedupe: no repite una alerta idéntica (source+message) mientras siga sin reconocer.
package alerts

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"easyzfs/internal/hub"
	"easyzfs/internal/model"
	"easyzfs/internal/settings"
)

// webhookClient — envío best-effort de alertas al webhook configurado.
var webhookClient = &http.Client{Timeout: 5 * time.Second}

// Alerter evalúa umbrales y persiste/emite alertas.
type Alerter struct {
	db  *sql.DB
	hub *hub.Hub
	st  *settings.Store
}

// New crea el Alerter.
func New(d *sql.DB, h *hub.Hub, st *settings.Store) *Alerter {
	return &Alerter{db: d, hub: h, st: st}
}

// Raise inserta una alerta (si no hay otra idéntica sin reconocer) y la emite
// por SSE. target es el destino navegable en la UI ("pools:tank",
// "disks:nvme1n1", "tasks", "settings"; "" si no aplica).
func (a *Alerter) Raise(ctx context.Context, level, source, target, message string) {
	var exists int
	err := a.db.QueryRowContext(ctx,
		"SELECT 1 FROM alerts WHERE source=? AND message=? AND acked_at IS NULL LIMIT 1",
		source, message).Scan(&exists)
	if err == nil {
		return // ya hay una idéntica activa
	}
	now := time.Now().UTC()
	res, err := a.db.ExecContext(ctx,
		"INSERT INTO alerts(ts, level, source, target, message) VALUES (?,?,?,?,?)",
		now.Format(time.RFC3339), level, source, target, message)
	if err != nil {
		log.Printf("alerts: insert: %v", err)
		return
	}
	id, _ := res.LastInsertId()
	a.hub.Publish("alert.new", map[string]any{
		"alert": model.Alert{ID: id, Ts: now, Level: level, Source: source, Target: target, Message: message},
	})
	a.notifyWebhook(level, source, target, message, now)
}

// notifyWebhook envía la alerta al webhook de settings (si no está vacío) en
// una goroutine: POST JSON {level, source, target, message, ts}, timeout 5 s,
// best-effort (solo log si falla).
func (a *Alerter) notifyWebhook(level, source, target, message string, ts time.Time) {
	st, err := a.st.Load(context.Background())
	if err != nil || st.Webhook == "" {
		return
	}
	payload, err := json.Marshal(map[string]any{
		"level": level, "source": source, "target": target, "message": message,
		"ts": ts.UTC().Format(time.RFC3339),
	})
	if err != nil {
		return
	}
	go func(url string, body []byte) {
		resp, err := webhookClient.Post(url, "application/json", bytes.NewReader(body))
		if err != nil {
			log.Printf("alerts: webhook %s: %v", url, err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			log.Printf("alerts: webhook %s: HTTP %d", url, resp.StatusCode)
		}
	}(st.Webhook, payload)
}

// EvaluatePools aplica umbrales de capacidad y scrub con errores.
func (a *Alerter) EvaluatePools(ctx context.Context, pools []model.Pool) {
	st, err := a.st.Load(ctx)
	if err != nil {
		st = settings.Defaults()
	}
	for _, p := range pools {
		if p.TotalBytes == 0 {
			continue
		}
		pct := int(p.UsedBytes * 100 / p.TotalBytes)
		switch {
		case pct >= st.CapCritPct:
			a.Raise(ctx, "crit", "pool."+p.Name, "pools:"+p.Name,
				fmt.Sprintf("Pool %s al %d%% de capacidad (crítico ≥ %d%%)", p.Name, pct, st.CapCritPct))
		case pct >= st.CapWarnPct:
			a.Raise(ctx, "warn", "pool."+p.Name, "pools:"+p.Name,
				fmt.Sprintf("Pool %s al %d%% de capacidad (aviso ≥ %d%%)", p.Name, pct, st.CapWarnPct))
		}
		if p.Status == "DEGRADED" {
			a.Raise(ctx, "crit", "pool."+p.Name, "pools:"+p.Name, "Pool "+p.Name+" DEGRADED")
		} else if p.Status == "FAULTED" {
			a.Raise(ctx, "crit", "pool."+p.Name, "pools:"+p.Name, "Pool "+p.Name+" FAULTED")
		}
		if st.NotifyScrubErrors && p.Scrub.State == "done" && p.Scrub.Errors > 0 {
			a.Raise(ctx, "warn", "scrub."+p.Name, "pools:"+p.Name,
				fmt.Sprintf("Scrub de %s terminó con %d errores", p.Name, p.Scrub.Errors))
		}
	}
}

// EvaluateDisks aplica umbrales de temperatura y estado SMART.
func (a *Alerter) EvaluateDisks(ctx context.Context, disks []model.Disk) {
	st, err := a.st.Load(ctx)
	if err != nil {
		st = settings.Defaults()
	}
	for _, d := range disks {
		if d.TempC != nil && int(*d.TempC) >= st.DiskTempC {
			a.Raise(ctx, "warn", "disk."+d.Dev, "disks:"+d.Dev,
				fmt.Sprintf("Disco %s a %.0f °C (umbral %d °C)", d.Dev, *d.TempC, st.DiskTempC))
		}
		if !st.NotifySmartChange {
			continue
		}
		switch d.Smart {
		case "crit":
			a.Raise(ctx, "crit", "smart."+d.Dev, "disks:"+d.Dev,
				fmt.Sprintf("SMART crítico en %s: %s", d.Dev, d.SmartDetail))
		case "warn":
			a.Raise(ctx, "warn", "smart."+d.Dev, "disks:"+d.Dev,
				fmt.Sprintf("SMART con avisos en %s: %s", d.Dev, d.SmartDetail))
		}
	}
}

// List devuelve las últimas alertas (limit), más recientes primero.
func (a *Alerter) List(ctx context.Context, limit int) ([]model.Alert, error) {
	rows, err := a.db.QueryContext(ctx,
		"SELECT id, ts, level, source, target, message, acked_at IS NOT NULL FROM alerts ORDER BY id DESC LIMIT ?",
		limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Alert{}
	for rows.Next() {
		var al model.Alert
		var ts string
		if err := rows.Scan(&al.ID, &ts, &al.Level, &al.Source, &al.Target, &al.Message, &al.Acked); err != nil {
			return nil, err
		}
		al.Ts = parseTS(ts)
		out = append(out, al)
	}
	return out, rows.Err()
}

// Ack marca una alerta como reconocida.
func (a *Alerter) Ack(ctx context.Context, id int64) error {
	_, err := a.db.ExecContext(ctx,
		"UPDATE alerts SET acked_at=? WHERE id=? AND acked_at IS NULL",
		time.Now().UTC().Format(time.RFC3339), id)
	return err
}

// parseTS tolera RFC3339 (desde Go) y 'YYYY-MM-DD HH:MM:SS' (defaults SQLite).
func parseTS(s string) time.Time {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
		return t.UTC()
	}
	return time.Time{}
}
