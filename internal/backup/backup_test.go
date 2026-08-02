package backup

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"easyzfs/internal/settings"
)

// newTestStore — BD SQLite real en dir temporal (VACUUM INTO necesita fichero).
func newTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "app.db")
	d, err := sql.Open("sqlite", "file:"+dbPath+"?_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := d.Exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t(v) VALUES ('a'),('b')"); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec("CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id = 1), json TEXT NOT NULL)"); err != nil {
		t.Fatal(err)
	}
	st, err := settings.NewStore(d)
	if err != nil {
		t.Fatal(err)
	}
	return New(d, dbPath, st)
}

func TestRunAndStatus(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	f, err := s.Run(ctx)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if f.Bytes == 0 {
		t.Fatal("respaldo vacío")
	}
	// El respaldo es una SQLite válida con los datos
	d, err := sql.Open("sqlite", "file:"+filepath.Join(s.Dir(), f.Name)+"?_pragma=query_only(1)")
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	var n int
	if err := d.QueryRow("SELECT COUNT(*) FROM t").Scan(&n); err != nil || n != 2 {
		t.Fatalf("respaldo inválido: n=%d err=%v", n, err)
	}

	st := s.Status(ctx)
	if st.Last == nil || st.NextRun == nil {
		t.Fatalf("Status sin last/next: %+v", st)
	}
	if !st.Enabled || st.FreqHours != 24 || st.RetentionDays != 3 {
		t.Fatalf("defaults inesperados: %+v", st)
	}
}

func TestPurge(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if _, err := s.Run(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.purge(0); err != nil {
		t.Fatal(err)
	}
	if got := s.Latest(); got != nil {
		t.Fatalf("purge(0) debería borrar todo, queda %s", got.Name)
	}
}

func TestConcurrentRunRejected(t *testing.T) {
	s := newTestStore(t)
	s.running = true
	if _, err := s.Run(context.Background()); err == nil {
		t.Fatal("segundo Run concurrente debería fallar")
	}
}

func TestImportCheckSQLite(t *testing.T) {
	dir := t.TempDir()
	// no-SQLite
	bad := filepath.Join(dir, "bad.db")
	os.WriteFile(bad, []byte("no soy sqlite"), 0o600)
	if err := CheckSQLite(bad); err == nil {
		t.Fatal("checkSQLite aceptó un fichero no-SQLite")
	}
	// SQLite válido
	good := filepath.Join(dir, "good.db")
	d, _ := sql.Open("sqlite", "file:"+good)
	d.Exec("CREATE TABLE t (id INTEGER)")
	d.Close()
	if err := CheckSQLite(good); err != nil {
		t.Fatalf("checkSQLite rechazó una SQLite válida: %v", err)
	}
}
