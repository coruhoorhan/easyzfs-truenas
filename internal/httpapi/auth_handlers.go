// auth_handlers.go — login/logout/me/cambio de contraseña propio.
package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gnacho/zfsctl/internal/auth"
	"github.com/gnacho/zfsctl/internal/users"
)

// login — POST /api/login {user, password} → {user, role} + cookie.
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		User     string `json:"user"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	role, err := s.users.Verify(r.Context(), body.User, body.Password)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "bad_credentials", "usuario o contraseña incorrectos")
		return
	}
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

// me — GET /api/me → {user, role} o 401 (401 ya lo da el middleware).
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"user": auth.UserFromContext(r.Context()),
		"role": auth.RoleFromContext(r.Context()),
	})
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
	if _, err := s.users.Verify(r.Context(), user, body.Current); err != nil {
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
