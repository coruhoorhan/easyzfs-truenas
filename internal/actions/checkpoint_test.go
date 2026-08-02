// checkpoint_test.go — acciones autotrim y checkpoint con binarios falsos
// (mismo patrón que actions_test.go: fake zpool registra sus argumentos).
package actions

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestSetAutotrim(t *testing.T) {
	svc, logFile := newTestService(t)

	if err := svc.SetAutotrim(context.Background(), "tester", "tank", true); err != nil {
		t.Fatalf("SetAutotrim on: %v", err)
	}
	if err := svc.SetAutotrim(context.Background(), "tester", "tank", false); err != nil {
		t.Fatalf("SetAutotrim off: %v", err)
	}
	out, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatalf("fake zpool: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	want := []string{"set autotrim=on tank", "set autotrim=off tank"}
	if len(lines) != len(want) {
		t.Fatalf("llamadas = %v, esperaba %v", lines, want)
	}
	for i := range want {
		if lines[i] != want[i] {
			t.Errorf("llamada %d = %q, esperaba %q", i, lines[i], want[i])
		}
	}

	// Auditoría: pool.autotrim con actor, no destructiva (confirmed=0).
	var action, actor string
	var confirmed int
	err = svc.db.QueryRow(
		"SELECT action, actor, confirmed FROM audit_log WHERE target='tank' AND action='pool.autotrim'").Scan(&action, &actor, &confirmed)
	if err != nil {
		t.Fatalf("audit_log: %v", err)
	}
	if actor != "tester" || confirmed != 0 {
		t.Fatalf("audit = (%q,%q,%d), esperaba (pool.autotrim,tester,0)", action, actor, confirmed)
	}
}

func TestSetAutotrimNombreInvalido(t *testing.T) {
	svc, _ := newTestService(t)
	for _, bad := range []string{"", "tan k", "tank;rm -rf /", "../etc"} {
		if err := svc.SetAutotrim(context.Background(), "tester", bad, true); !errors.Is(err, ErrInvalidName) {
			t.Errorf("SetAutotrim(%q) = %v, esperaba ErrInvalidName", bad, err)
		}
	}
}

func TestCheckpoint(t *testing.T) {
	svc, logFile := newTestService(t)

	if err := svc.CheckpointCreate(context.Background(), "tester", "tank"); err != nil {
		t.Fatalf("CheckpointCreate: %v", err)
	}
	if err := svc.CheckpointDiscard(context.Background(), "tester", "tank"); err != nil {
		t.Fatalf("CheckpointDiscard: %v", err)
	}
	out, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatalf("fake zpool: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	want := []string{"checkpoint tank", "checkpoint -d tank"}
	if len(lines) != len(want) {
		t.Fatalf("llamadas = %v, esperaba %v", lines, want)
	}
	for i := range want {
		if lines[i] != want[i] {
			t.Errorf("llamada %d = %q, esperaba %q", i, lines[i], want[i])
		}
	}

	// Auditoría: ambas con confirmed=1 (operación delicada, confirm validado fuera).
	var n, confirmed int
	err = svc.db.QueryRow(
		"SELECT COUNT(*), SUM(confirmed) FROM audit_log WHERE action LIKE 'pool.checkpoint.%'").Scan(&n, &confirmed)
	if err != nil {
		t.Fatalf("audit_log: %v", err)
	}
	if n != 2 || confirmed != 2 {
		t.Fatalf("audit checkpoint = (%d,%d), esperaba (2,2)", n, confirmed)
	}
}

func TestCheckpointNombreInvalido(t *testing.T) {
	svc, _ := newTestService(t)
	for _, bad := range []string{"", "tan k", "tank|cat /etc/passwd"} {
		if err := svc.CheckpointCreate(context.Background(), "tester", bad); !errors.Is(err, ErrInvalidName) {
			t.Errorf("CheckpointCreate(%q) = %v, esperaba ErrInvalidName", bad, err)
		}
		if err := svc.CheckpointDiscard(context.Background(), "tester", bad); !errors.Is(err, ErrInvalidName) {
			t.Errorf("CheckpointDiscard(%q) = %v, esperaba ErrInvalidName", bad, err)
		}
	}
}
