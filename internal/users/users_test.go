// users_test.go — perfil de usuario (display_name + email, migración v13/v14).
package users

import (
	"context"
	"testing"

	"easyzfs/internal/db"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := db.Migrate(context.Background(), d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return NewStore(d)
}

func TestSetProfile(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)
	if err := s.Create(ctx, "nacho", "password-larga", "admin"); err != nil {
		t.Fatalf("create: %v", err)
	}

	u, err := s.Get(ctx, "nacho")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if u.DisplayName != "" || u.Email != "" {
		t.Fatalf("perfil inicial = %+v, esperaba vacío", u)
	}

	if err := s.SetProfile(ctx, "nacho", "Nacho", "nacho@example.com"); err != nil {
		t.Fatalf("setprofile: %v", err)
	}
	u, _ = s.Get(ctx, "nacho")
	if u.DisplayName != "Nacho" || u.Email != "nacho@example.com" {
		t.Fatalf("perfil = %+v", u)
	}

	// Email opcional: vacío vale; malformado no.
	if err := s.SetProfile(ctx, "nacho", "Nacho", ""); err != nil {
		t.Fatalf("email vacío: %v", err)
	}
	if err := s.SetProfile(ctx, "nacho", "Nacho", "no-es-un-email"); err != ErrInvalidEmail {
		t.Fatalf("email malformado = %v, esperaba ErrInvalidEmail", err)
	}

	// List también trae el perfil.
	list, err := s.List(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v (%d)", err, len(list))
	}
	if list[0].DisplayName != "Nacho" {
		t.Fatalf("list display_name = %q", list[0].DisplayName)
	}

	// Usuario inexistente.
	if err := s.SetProfile(ctx, "nadie", "x", ""); err != ErrNotFound {
		t.Fatalf("inexistente = %v, esperaba ErrNotFound", err)
	}
}
