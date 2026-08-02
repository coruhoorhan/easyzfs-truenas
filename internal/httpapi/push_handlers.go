// push_handlers.go — endpoints Web Push tras el middleware de sesión (misma
// protección que el resto de mutaciones: cookie HttpOnly SameSite=Lax).
//
//	GET    /api/push/vapid-public-key  → {"publicKey":"…"} (503 si no configurado)
//	POST   /api/push/subscribe         → upsert por endpoint
//	DELETE /api/push/unsubscribe       → borra solo suscripciones del propio usuario
package httpapi

import (
	"net/http"
	"strings"

	"easyzfs/internal/auth"
)

// getPushVapidKey — clave pública VAPID para pushManager.subscribe().
// La pública no es secreta, pero va tras sesión como el resto del API.
func (s *Server) getPushVapidKey(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.PushEnabled() {
		writeErr(w, http.StatusServiceUnavailable, "push_not_configured",
			"notificaciones push no configuradas en el servidor (faltan claves VAPID)")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"publicKey": s.cfg.VAPIDPublicKey})
}

// subscribeReq — body de POST /api/push/subscribe (lo que devuelve
// PushSubscription.toJSON() en el navegador + idioma del dispositivo).
type subscribeReq struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
	Lang string `json:"lang"` // 'es' | 'en' (idioma del dispositivo al suscribir)
}

// postPushSubscribe — upsert por endpoint con el usuario de la sesión.
func (s *Server) postPushSubscribe(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.PushEnabled() {
		writeErr(w, http.StatusServiceUnavailable, "push_not_configured",
			"notificaciones push no configuradas en el servidor (faltan claves VAPID)")
		return
	}
	var req subscribeReq
	if !decodeJSON(w, r, &req) {
		return
	}
	// Validación: endpoint HTTPS (capability URL) y claves presentes.
	if req.Endpoint == "" || len(req.Endpoint) > 2048 || !strings.HasPrefix(req.Endpoint, "https://") {
		writeErr(w, http.StatusBadRequest, "invalid_endpoint", "endpoint inválido (se requiere URL https://)")
		return
	}
	if req.Keys.P256dh == "" || req.Keys.Auth == "" || len(req.Keys.P256dh) > 256 || len(req.Keys.Auth) > 256 {
		writeErr(w, http.StatusBadRequest, "invalid_keys", "faltan las claves de la suscripción (p256dh/auth)")
		return
	}
	lang := req.Lang
	if lang != "en" && lang != "es" {
		lang = "" // desconocido/ausente: insert cae al default 'es' y el upsert conserva el existente
	}
	ua := r.UserAgent()
	if len(ua) > 512 {
		ua = ua[:512]
	}
	if err := s.push.Subscribe(r.Context(), auth.UserFromContext(r.Context()),
		req.Endpoint, req.Keys.P256dh, req.Keys.Auth, lang, ua); err != nil {
		writeErr(w, http.StatusInternalServerError, "push_subscribe_error", err.Error())
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}

// unsubscribeReq — body de DELETE /api/push/unsubscribe.
type unsubscribeReq struct {
	Endpoint string `json:"endpoint"`
}

// deletePushUnsubscribe — borra la suscripción SOLO si pertenece al usuario
// de la sesión (multiuser: nadie borra suscripciones ajenas).
func (s *Server) deletePushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	var req unsubscribeReq
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Endpoint == "" {
		writeErr(w, http.StatusBadRequest, "invalid_endpoint", "falta el endpoint de la suscripción")
		return
	}
	if err := s.push.Unsubscribe(r.Context(), auth.UserFromContext(r.Context()), req.Endpoint); err != nil {
		writeErr(w, http.StatusInternalServerError, "push_unsubscribe_error", err.Error())
		return
	}
	writeJSON(w, http.StatusNoContent, nil)
}
