// longops_test.go — gate por capabilities/confirm del endpoint rewrite y
// lanzamiento/cancelación a través del runner (MOCK: op simulada con sleep).
package httpapi

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"easyzfs/internal/actions"
	"easyzfs/internal/config"
	"easyzfs/internal/db"
	"easyzfs/internal/executil"
	"easyzfs/internal/hub"
	"easyzfs/internal/longops"
	"easyzfs/internal/model"
)

func init() {
	// El rewrite simulado en MOCK usa sleep: no necesita sudo.
	executil.SetSudoForTest(false)
}

// fakePools — PoolProvider mínimo con un dataset montado.
type fakePools struct{ ds []model.Dataset }

func (f fakePools) Pools() []model.Pool                 { return nil }
func (f fakePools) Datasets() []model.Dataset           { return f.ds }
func (f fakePools) SnapshotGroups() []model.SnapGroup   { return nil }
func (f fakePools) History(string) []model.HistoryEntry { return nil }

type fakeCaps struct{ rewrite bool }

func (f fakeCaps) Capabilities() model.Capabilities {
	return model.Capabilities{Rewrite: f.rewrite}
}

func setupRewriteServer(t *testing.T, rewrite bool) *Server {
	t.Helper()
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	if err := db.Migrate(context.Background(), d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return &Server{
		cfg:     &config.Config{Mock: true},
		act:     actions.NewService(d),
		longOps: longops.New(hub.NewHub()),
		caps:    fakeCaps{rewrite: rewrite},
		pools: fakePools{ds: []model.Dataset{
			{Name: "tank/docs", Type: "fs", Mountpoint: "/tank/docs"},
			{Name: "ssd/vm", Type: "volume", Mountpoint: "-"},
		}},
	}
}

func postRewrite(t *testing.T, s *Server, name, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("POST", "/api/datasets/"+name+"/rewrite", strings.NewReader(body))
	req.SetPathValue("name", name)
	rec := httptest.NewRecorder()
	s.rewriteDataset(rec, req)
	return rec
}

func TestRewriteGateSinCapability(t *testing.T) {
	s := setupRewriteServer(t, false)
	rec := postRewrite(t, s, "tank/docs", `{"confirm":"tank/docs"}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "not_supported") {
		t.Fatalf("code=%d body=%s, esperaba 400 not_supported", rec.Code, rec.Body)
	}
}

func TestRewriteGateConfirm(t *testing.T) {
	s := setupRewriteServer(t, true)
	rec := postRewrite(t, s, "tank/docs", `{"confirm":"otro"}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "confirm_required") {
		t.Fatalf("code=%d body=%s, esperaba 400 confirm_required", rec.Code, rec.Body)
	}
}

func TestRewriteDatasetNoMontado(t *testing.T) {
	s := setupRewriteServer(t, true)
	rec := postRewrite(t, s, "ssd/vm", `{"confirm":"ssd/vm"}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "invalid_input") {
		t.Fatalf("code=%d body=%s, esperaba 400 invalid_input (volume sin mountpoint)", rec.Code, rec.Body)
	}
	rec = postRewrite(t, s, "tank/inexistente", `{"confirm":"tank/inexistente"}`)
	if rec.Code != 400 {
		t.Fatalf("dataset inexistente: code=%d, esperaba 400", rec.Code)
	}
}

func TestRewriteLanzaYCompleta(t *testing.T) {
	s := setupRewriteServer(t, true)
	rec := postRewrite(t, s, "tank/docs", `{"confirm":"tank/docs"}`)
	if rec.Code != 202 {
		t.Fatalf("code=%d body=%s, esperaba 202", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "op_id") {
		t.Fatalf("sin op_id en %s", rec.Body)
	}
	// La op (sleep 4 en mock) aparece como running y completa sola.
	ops := s.longOps.List()
	if len(ops) != 1 || ops[0].Type != "rewrite" || ops[0].Target != "tank/docs" {
		t.Fatalf("ops=%+v", ops)
	}
	if ops[0].Status != longops.StatusRunning {
		t.Fatalf("status=%q, esperaba running", ops[0].Status)
	}
	// Segunda sobre el mismo dataset: conflicto.
	rec2 := postRewrite(t, s, "tank/docs", `{"confirm":"tank/docs"}`)
	if rec2.Code != 409 {
		t.Fatalf("segunda op: code=%d, esperaba 409 already_running", rec2.Code)
	}
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if s.longOps.List()[0].Status == longops.StatusDone {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("la op no completó: %+v", s.longOps.List()[0])
}

func TestRewriteCancela(t *testing.T) {
	s := setupRewriteServer(t, true)
	postRewrite(t, s, "tank/docs", `{"confirm":"tank/docs"}`)
	id := s.longOps.List()[0].ID
	if err := s.longOps.Cancel(id); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		st := s.longOps.List()[0].Status
		if st == longops.StatusCanceled {
			return
		}
		time.Sleep(30 * time.Millisecond)
	}
	t.Fatalf("no quedó canceled: %+v", s.longOps.List()[0])
}
