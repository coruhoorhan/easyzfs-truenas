// scheduler_test.go — tipos de job admitidos y despacho de execute.
package scheduler

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easyzfs/internal/actions"
	"easyzfs/internal/db"
)

func TestValidTiposIncluyeTrim(t *testing.T) {
	for _, tipo := range []string{"snapshot", "scrub", "trim", "smart_short", "smart_long"} {
		if !ValidTipos[tipo] {
			t.Errorf("ValidTipos[%q] = false, esperaba true", tipo)
		}
	}
	if ValidTipos["poweroff"] || ValidTipos[""] {
		t.Error("ValidTipos admite tipos que no debería")
	}
}

// TestExecuteTrim — un job tipo trim despacha 'zpool trim <pool>'.
func TestExecuteTrim(t *testing.T) {
	dir := t.TempDir()
	logFile := filepath.Join(dir, "zpool-args.log")
	zpool := "#!/bin/sh\necho \"$@\" >> " + logFile + "\nexit 0\n"
	sudo := "#!/bin/sh\nwhile [ $# -gt 0 ]; do case \"$1\" in -*) shift;; *) break;; esac; done\nexec \"$@\"\n"
	for name, body := range map[string]string{"zpool": zpool, "sudo": sudo} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	d, err := db.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if err := db.Migrate(context.Background(), d); err != nil {
		t.Fatal(err)
	}

	s := &Scheduler{actions: actions.NewService(d)}
	if err := s.execute(context.Background(), Job{Tipo: "trim", Target: "ssd"}); err != nil {
		t.Fatalf("execute(trim): %v", err)
	}
	out, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatalf("el fake zpool no registró la llamada: %v", err)
	}
	if got := strings.TrimSpace(string(out)); got != "trim ssd" {
		t.Fatalf("args de zpool = %q, esperaba %q", got, "trim ssd")
	}

	// Target inválido: error tipado de actions (nombre inválido).
	err = s.execute(context.Background(), Job{Tipo: "trim", Target: "bad name"})
	if !errors.Is(err, actions.ErrInvalidName) {
		t.Fatalf("execute(trim, nombre inválido) = %v, esperaba ErrInvalidName", err)
	}

	// Tipo desconocido sigue siendo error.
	if err := s.execute(context.Background(), Job{Tipo: "desconocido", Target: "x"}); err == nil {
		t.Fatal("execute(tipo desconocido) no devolvió error")
	}
}
