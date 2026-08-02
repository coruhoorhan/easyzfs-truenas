// auth_handlers.go — login/logout/me/cambio de contraseña propio.
package httpapi

import (
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"easyzfs/internal/auth"
	"easyzfs/internal/users"
)

// --- Rate limiting de /api/login ---
// Limiter en memoria por IP+usuario: máx. 5 intentos/min y bloqueo de 15 min
// tras 10 fallos consecutivos. Respuesta: 429 {"error":"rate_limited"}.
const (
	loginMaxPerMinute  = 5
	loginBlockAfter    = 10
	loginWindow        = time.Minute
	loginBlockDuration = 15 * time.Minute
)

// loginAttempt — estado del limiter para una clave IP+usuario.
type loginAttempt struct {
	mu        sync.Mutex
	window    []time.Time // timestamps de intentos en la ventana deslizante
	failures  int         // fallos consecutivos
	blockedTo time.Time   // bloqueado hasta
}

// loginLimiter agrupa los intentos por clave "IP|usuario".
type loginLimiter struct {
	mu  sync.Mutex
	att map[string]*loginAttempt
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{att: map[string]*loginAttempt{}}
}

// allow registra un intento y dice si puede proceder (y cuándo reintentar).
func (l *loginLimiter) allow(key string, now time.Time) (bool, time.Duration) {
	l.mu.Lock()
	a, ok := l.att[key]
	if !ok {
		a = &loginAttempt{}
		l.att[key] = a
	}
	// higiene best-effort: purga de claves sin actividad reciente
	if len(l.att) > 1024 {
		for k, v := range l.att {
			v.mu.Lock()
			stale := now.Sub(v.lastSeen()) > loginBlockDuration &&
				len(v.window) == 0 && v.failures == 0
			v.mu.Unlock()
			if stale {
				delete(l.att, k)
			}
		}
	}
	l.mu.Unlock()

	a.mu.Lock()
	defer a.mu.Unlock()
	if now.Before(a.blockedTo) {
		return false, time.Until(a.blockedTo)
	}
	// ventana deslizante de 1 minuto
	cut := now.Add(-loginWindow)
	kept := a.window[:0]
	for _, t := range a.window {
		if t.After(cut) {
			kept = append(kept, t)
		}
	}
	a.window = kept
	if len(a.window) >= loginMaxPerMinute {
		return false, loginWindow - now.Sub(a.window[0])
	}
	a.window = append(a.window, now)
	return true, 0
}

// lastSeen devuelve el último intento registrado (llamar con a.mu tomado).
func (a *loginAttempt) lastSeen() time.Time {
	if n := len(a.window); n > 0 {
		return a.window[n-1]
	}
	return a.blockedTo
}

// success resetea los fallos consecutivos de la clave.
func (l *loginLimiter) success(key string) {
	l.mu.Lock()
	a, ok := l.att[key]
	l.mu.Unlock()
	if !ok {
		return
	}
	a.mu.Lock()
	a.failures = 0
	a.blockedTo = time.Time{}
	a.mu.Unlock()
}

// failure anota un fallo; tras loginBlockAfter consecutivos, bloquea 15 min.
func (l *loginLimiter) failure(key string, now time.Time) {
	l.mu.Lock()
	a, ok := l.att[key]
	l.mu.Unlock()
	if !ok {
		return
	}
	a.mu.Lock()
	a.failures++
	if a.failures >= loginBlockAfter {
		a.blockedTo = now.Add(loginBlockDuration)
		a.failures = 0 // tras el bloqueo, la cuenta vuelve a cero
	}
	a.mu.Unlock()
}

// argonSem limita las verificaciones argon2 concurrentes (cada Verify usa
// ~64 MiB; el unit tiene MemoryMax=256M). Máximo 2 en vuelo.
var argonSem = make(chan struct{}, 2)

// loginKey — clave del limiter: IP del cliente + usuario.
func loginKey(r *http.Request, user string) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return host + "|" + user
}

// login — POST /api/login {user, password} → {user, role} + cookie.
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		User     string `json:"user"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	key := loginKey(r, body.User)
	now := time.Now()
	if ok, retry := s.loginLimiter.allow(key, now); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())+1))
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "demasiados intentos de login; inténtalo más tarde")
		return
	}
	// Semáforo argon2: serializar verificaciones para acotar la memoria.
	argonSem <- struct{}{}
	role, err := s.users.Verify(r.Context(), body.User, body.Password)
	<-argonSem
	if err != nil {
		s.loginLimiter.failure(key, now)
		writeErr(w, http.StatusUnauthorized, "bad_credentials", "usuario o contraseña incorrectos")
		return
	}
	s.loginLimiter.success(key)
	cookie, err := s.auth.CreateSession(r.Context(), body.User)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "session_error", "no se pudo crear la sesión")
		return
	}
	http.SetCookie(w, cookie)
	writeJSON(w, http.StatusOK, map[string]string{"user": body.User, "role": role})
}

// logout — POST /api/logout → 204. Invalida la sesión.
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(auth.CookieName); err == nil {
		s.auth.DestroySession(r.Context(), c.Value)
	}
	http.SetCookie(w, s.auth.ExpiredCookie())
	w.WriteHeader(http.StatusNoContent)
}

// me — GET /api/me → {user, role, language} o 401 (401 ya lo da el middleware).
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	lang := "auto"
	if u, err := s.users.Get(r.Context(), auth.UserFromContext(r.Context())); err == nil {
		lang = u.Language
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"user":     auth.UserFromContext(r.Context()),
		"role":     auth.RoleFromContext(r.Context()),
		"language": lang,
	})
}

// putMyLanguage — PUT /api/me/language {language} → 204.
// El idioma del usuario vive en BD (fuente de verdad); el front lo espeja.
func (s *Server) putMyLanguage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Language string `json:"language"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	user := auth.UserFromContext(r.Context())
	if err := s.users.SetLanguage(r.Context(), user, body.Language); err != nil {
		if errors.Is(err, users.ErrInvalidLang) {
			writeErr(w, http.StatusBadRequest, "invalid_language", err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// changeMyPassword — POST /api/me/password {current, new} → 204.
// Cierra el resto de sesiones del usuario (la actual sobrevive).
func (s *Server) changeMyPassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	user := auth.UserFromContext(r.Context())
	// Mismo semáforo argon2 que en login: acota la memoria en verificaciones.
	argonSem <- struct{}{}
	_, err := s.users.Verify(r.Context(), user, body.Current)
	<-argonSem
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "bad_credentials", "la contraseña actual no es correcta")
		return
	}
	if err := s.users.SetPassword(r.Context(), user, body.New); err != nil {
		if errors.Is(err, users.ErrWeakPassword) {
			writeErr(w, http.StatusBadRequest, "weak_password", err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	// cerrar el resto de sesiones (mantener la actual)
	except := ""
	if c, err := r.Cookie(auth.CookieName); err == nil {
		if token, _, found := strings.Cut(c.Value, "|"); found {
			except = token
		}
	}
	if err := s.auth.DestroyUserSessions(r.Context(), user, except); err != nil {
		writeErr(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
