// Package push — sender Web Push (VAPID + webpush-go) con catálogo i18n ES/EN
// compuesto server-side. Reglas (skill web-push-alerts):
//   - El texto final (ES/EN) se compone aquí según push_subscriptions.lang del
//     dispositivo; el service worker solo pinta lo que llega.
//   - 404/410 del push service = suscripción muerta: DELETE en el mismo envío.
//     429/5xx: solo log (se conserva la fila).
//   - El endpoint es un secreto (capability URL): nunca se loguea completo,
//     solo una huella (hash truncado).
//   - Payload < 4 KB, sin datos sensibles; urgency "high" solo críticas.
//   - Modo demo: NUNCA se envía push real; solo log.
package push

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"easyzfs/internal/config"
)

// Hub — lo mínimo que el sender necesita del hub SSE: saber si un usuario
// tiene la app ABIERTA (conexión SSE activa) para no duplicar avisos.
type Hub interface {
	UserActive(userID string) bool
}

// Alert — datos de la alerta a notificar (kind estructurado + params).
type Alert struct {
	Level  string         // "info" | "warn" | "crit"
	Source string         // "pool.tank", "disk.sda"…
	Target string         // "pools:tank", "disks:sda", "tasks", "settings"…
	Kind   string         // pool_capacity | pool_status | scrub_errors | disk_temp | smart_status
	Params map[string]any // parámetros de interpolación del catálogo i18n
}

// subscription — fila de push_subscriptions (endpoint = secreto).
type subscription struct {
	id       int64
	userID   string
	endpoint string
	p256dh   string
	auth     string
	lang     string
}

// Sender envía notificaciones Web Push. Best-effort: Notify nunca devuelve
// error al llamador (la alerta ya está en BD y emitida por SSE).
type Sender struct {
	cfg    *config.Config
	db     *sql.DB
	hub    Hub
	client *http.Client // inyectable en tests
}

// New crea el sender. Si !cfg.PushEnabled() queda inerte (Notify no hace nada).
func New(cfg *config.Config, db *sql.DB, h Hub) *Sender {
	return &Sender{cfg: cfg, db: db, hub: h, client: &http.Client{Timeout: 15 * time.Second}}
}

// --- operaciones de suscripción (usadas por los endpoints HTTP) ---

// Subscribe — upsert por endpoint: re-suscripciones y rotaciones actualizan
// la fila; también reasigna user_id (dos usuarios que comparten navegador).
// lang vacío (p. ej. el re-POST espontáneo de pushsubscriptionchange, que no
// conoce el idioma) NO pisa el guardado: se conserva el de la fila.
func (s *Sender) Subscribe(ctx context.Context, userID, endpoint, p256dh, auth, lang, userAgent string) error {
	if lang == "" {
		// Sin idioma (re-POST espontáneo de pushsubscriptionchange): no tocar
		// lang — insert cae al DEFAULT 'es', upsert conserva el existente.
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth, user_agent, updated_at)
			VALUES (?,?,?,?,?,datetime('now'))
			ON CONFLICT(endpoint) DO UPDATE SET
			  user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth,
			  user_agent=excluded.user_agent, updated_at=datetime('now')`,
			userID, endpoint, p256dh, auth, userAgent)
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth, lang, user_agent, updated_at)
		VALUES (?,?,?,?,?,?,datetime('now'))
		ON CONFLICT(endpoint) DO UPDATE SET
		  user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth,
		  lang=excluded.lang, user_agent=excluded.user_agent, updated_at=datetime('now')`,
		userID, endpoint, p256dh, auth, lang, userAgent)
	return err
}

// Unsubscribe borra la suscripción SOLO si pertenece al usuario de la sesión.
func (s *Sender) Unsubscribe(ctx context.Context, userID, endpoint string) error {
	_, err := s.db.ExecContext(ctx,
		"DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?", endpoint, userID)
	return err
}

// --- envío ---

// Notify envía la alerta a las suscripciones que proceda. Regla no-duplicar:
// push SOLO a usuarios SIN conexión SSE activa, EXCEPTO level=crit que se
// envía siempre. Nunca bloquea ni propaga errores al llamador.
func (s *Sender) Notify(ctx context.Context, a Alert) {
	if s.cfg.Demo {
		// Modo demo: sin push real, jamás. La alerta ya llega in-app por SSE.
		log.Printf("push: demo: alerta %s/%s no enviada (solo log)", a.Kind, a.Source)
		return
	}
	if !s.cfg.PushEnabled() {
		return // push desactivado (aviso ya emitido al arrancar)
	}
	subs, err := s.list(ctx)
	if err != nil {
		log.Printf("push: listar suscripciones: %v", err)
		return
	}
	for _, sub := range subs {
		if a.Level != "crit" && s.hub != nil && s.hub.UserActive(sub.userID) {
			continue // la app está abierta y ya lo ve por SSE: no duplicar
		}
		s.sendTo(ctx, sub, a)
	}
}

// list carga todas las suscripciones (una por dispositivo/navegador).
func (s *Sender) list(ctx context.Context) ([]subscription, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, user_id, endpoint, p256dh, auth, lang FROM push_subscriptions")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []subscription
	for rows.Next() {
		var sub subscription
		if err := rows.Scan(&sub.id, &sub.userID, &sub.endpoint, &sub.p256dh, &sub.auth, &sub.lang); err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// sendTo compone el payload en el idioma del dispositivo y lo envía cifrado.
// Ciclo de vida: 404/410 → DELETE inmediato; 429/5xx → solo log.
func (s *Sender) sendTo(ctx context.Context, sub subscription, a Alert) {
	payload, err := json.Marshal(composePayload(sub.lang, a))
	if err != nil {
		log.Printf("push: marshal payload (sub %s): %v", fp(sub.endpoint), err)
		return
	}
	opts := &webpush.Options{
		HTTPClient:      s.client,
		Subscriber:      s.cfg.VAPIDSubject,
		VAPIDPublicKey:  s.cfg.VAPIDPublicKey,
		VAPIDPrivateKey: s.cfg.VAPIDPrivateKey,
		Topic:           a.Kind, // coalescing en tránsito (dispositivo offline)
		TTL:             ttlFor(a.Level),
	}
	if a.Level == "crit" {
		opts.Urgency = webpush.UrgencyHigh // 'high' SOLO críticas
	}
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.endpoint,
		Keys:     webpush.Keys{P256dh: sub.p256dh, Auth: sub.auth},
	}, opts)
	if err != nil {
		log.Printf("push: envío a sub %s: %v", fp(sub.endpoint), err)
		return
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		// Suscripción muerta: no resucita jamás → borrar en el mismo envío.
		if _, err := s.db.ExecContext(ctx,
			"DELETE FROM push_subscriptions WHERE id=?", sub.id); err != nil {
			log.Printf("push: borrar suscripción muerta %s: %v", fp(sub.endpoint), err)
		}
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		log.Printf("push: servicio responde HTTP %d (sub %s): se conserva la suscripción", resp.StatusCode, fp(sub.endpoint))
	case resp.StatusCode >= 400:
		// 400/401/403/413: probablemente bug nuestro (VAPID/payload). Sin endpoint.
		log.Printf("push: HTTP %d al enviar (sub %s)", resp.StatusCode, fp(sub.endpoint))
	}
}

// fp — huella corta del endpoint para logs (el endpoint completo es secreto).
func fp(endpoint string) string {
	sum := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(sum[:])[:12]
}

// ttlFor — TTL acorde a la vigencia: 24 h para críticas, 1 h para el resto.
func ttlFor(level string) int {
	if level == "crit" {
		return 86400
	}
	return 3600
}

// urlFor — destino navegable derivado de alert.target (router por hash de la SPA).
func urlFor(target string) string {
	base, _, _ := strings.Cut(target, ":")
	switch base {
	case "pools", "disks", "tasks", "settings":
		return "/#/" + base
	default:
		return "/"
	}
}

// payload — híbrido: campos planos (title/body/url/tag) para el handler push
// del SW + bloque Declarative Web Push (web_push/notification) que Safari/iOS
// 18.4+ procesa sin ejecutar el SW. < 4 KB y sin datos sensibles.
type payload struct {
	Title        string         `json:"title"`
	Body         string         `json:"body"`
	Tag          string         `json:"tag"` // coalescing en el dispositivo (renotify)
	URL          string         `json:"url"`
	Level        string         `json:"level"`
	WebPush      int            `json:"web_push"` // magic number Declarative Web Push
	Notification map[string]any `json:"notification"`
}

// composePayload — texto final ES/EN según el idioma del dispositivo.
func composePayload(lang string, a Alert) payload {
	title, body := catalog(lang, a.Kind, a.Params)
	url := urlFor(a.Target)
	return payload{
		Title:   title,
		Body:    body,
		Tag:     a.Kind + ":" + a.Source,
		URL:     url,
		Level:   a.Level,
		WebPush: 8030,
		Notification: map[string]any{
			"title":    title,
			"body":     body,
			"navigate": url,
		},
	}
}
