// Package users — multiusuario: CRUD, verificación de credenciales y bootstrap.
package users

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"
)

// User — vista pública de un usuario (contrato GET /api/users).
type User struct {
	Name      string     `json:"user"`
	Role      string     `json:"role"` // "admin" | "user"
	LastLogin *time.Time `json:"last_login"`
	Sessions  int        `json:"sessions"`
}

// Errores de dominio (mapeados a códigos HTTP en httpapi).
var (
	ErrExists        = errors.New("el usuario ya existe")
	ErrNotFound      = errors.New("usuario no encontrado")
	ErrInvalidName   = errors.New("nombre de usuario inválido")
	ErrInvalidRole   = errors.New("rol inválido (admin|user)")
	ErrWeakPassword  = errors.New("la contraseña debe tener al menos 8 caracteres")
	ErrBadCredential = errors.New("credenciales incorrectas")
)

var nameRe = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,32}$`)

// Store — acceso a la tabla users.
type Store struct {
	db *sql.DB
}

// NewStore crea el store de usuarios.
func NewStore(d *sql.DB) *Store {
	return &Store{db: d}
}

// Count devuelve el número total de usuarios.
func (s *Store) Count(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&n)
	return n, err
}

// CountAdmins devuelve cuántos admins quedan (para proteger al último).
func (s *Store) CountAdmins(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM users WHERE role='admin'").Scan(&n)
	return n, err
}

// Bootstrap crea el primer admin si no hay usuarios. Usa ADMIN_PASSWORD o
// genera una aleatoria y la loguea UNA vez (decisión documentada en README).
func (s *Store) Bootstrap(ctx context.Context, adminPassword string) error {
	n, err := s.Count(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	generated := false
	if adminPassword == "" {
		adminPassword = randomPassword()
		generated = true
	}
	if err := s.Create(ctx, "admin", adminPassword, "admin"); err != nil {
		return fmt.Errorf("bootstrap admin: %w", err)
	}
	if generated {
		log.Printf("BOOTSTRAP: creado usuario 'admin' con contraseña generada: %s (cámbiala tras el primer login)", adminPassword)
	} else {
		log.Println("BOOTSTRAP: creado usuario 'admin' con la contraseña de ADMIN_PASSWORD")
	}
	return nil
}

// Create valida y crea un usuario.
func (s *Store) Create(ctx context.Context, name, password, role string) error {
	if !nameRe.MatchString(name) {
		return ErrInvalidName
	}
	if role != "admin" && role != "user" {
		return ErrInvalidRole
	}
	if len(password) < 8 {
		return ErrWeakPassword
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		"INSERT INTO users(user, pass_hash, role) VALUES (?,?,?)", name, hash, role)
	if err != nil {
		if isUniqueErr(err) {
			return ErrExists
		}
		return err
	}
	return nil
}

// Delete elimina un usuario (las sesiones caen por ON DELETE CASCADE).
func (s *Store) Delete(ctx context.Context, name string) error {
	res, err := s.db.ExecContext(ctx, "DELETE FROM users WHERE user=?", name)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// List devuelve todos los usuarios con su nº de sesiones activas.
func (s *Store) List(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.user, u.role, u.last_login,
		       (SELECT COUNT(*) FROM sessions se WHERE se.user=u.user AND se.expires_at > datetime('now'))
		FROM users u ORDER BY u.user`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		var last sql.NullString
		if err := rows.Scan(&u.Name, &u.Role, &last, &u.Sessions); err != nil {
			return nil, err
		}
		if last.Valid && last.String != "" {
			t := parseTS(last.String)
			u.LastLogin = &t
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// Get devuelve un usuario por nombre.
func (s *Store) Get(ctx context.Context, name string) (*User, error) {
	var u User
	var last sql.NullString
	err := s.db.QueryRowContext(ctx,
		"SELECT user, role, last_login FROM users WHERE user=?", name).
		Scan(&u.Name, &u.Role, &last)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if last.Valid && last.String != "" {
		t := parseTS(last.String)
		u.LastLogin = &t
	}
	return &u, nil
}

// Verify comprueba credenciales y actualiza last_login si son válidas.
func (s *Store) Verify(ctx context.Context, name, password string) (role string, err error) {
	var hash string
	err = s.db.QueryRowContext(ctx,
		"SELECT pass_hash, role FROM users WHERE user=?", name).Scan(&hash, &role)
	if errors.Is(err, sql.ErrNoRows) {
		// Comparación dummy para no filtrar por timing si el usuario existe.
		verifyPassword(password, "$argon2id$v=19$m=65536,t=3,p=2$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
		return "", ErrBadCredential
	}
	if err != nil {
		return "", err
	}
	if !verifyPassword(password, hash) {
		return "", ErrBadCredential
	}
	_, _ = s.db.ExecContext(ctx, "UPDATE users SET last_login=? WHERE user=?",
		time.Now().UTC().Format(time.RFC3339), name)
	return role, nil
}

// SetPassword cambia la contraseña (admin sobre otro usuario o el propio).
func (s *Store) SetPassword(ctx context.Context, name, newPassword string) error {
	if len(newPassword) < 8 {
		return ErrWeakPassword
	}
	hash, err := hashPassword(newPassword)
	if err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx,
		"UPDATE users SET pass_hash=? WHERE user=?", hash, name)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// RoleOf devuelve el rol de un usuario (para el middleware de auth).
func (s *Store) RoleOf(ctx context.Context, name string) (string, error) {
	var role string
	err := s.db.QueryRowContext(ctx, "SELECT role FROM users WHERE user=?", name).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return role, err
}

// randomPassword genera una contraseña aleatoria legible (18 chars base64url).
func randomPassword() string {
	b := make([]byte, 14)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// isUniqueErr detecta violación de UNIQUE en modernc.org/sqlite sin depender del texto exacto.
func isUniqueErr(err error) bool {
	s := err.Error()
	return strings.Contains(s, "UNIQUE constraint failed") || strings.Contains(s, "constraint failed")
}

// parseTS tolera RFC3339 y 'YYYY-MM-DD HH:MM:SS' (defaults SQLite).
func parseTS(s string) time.Time {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
		return t.UTC()
	}
	return time.Time{}
}
