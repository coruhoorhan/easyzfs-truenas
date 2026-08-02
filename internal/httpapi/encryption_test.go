// encryption_test.go — endpoints de cifrado nativo y RAID-Z expansion (lote D)
// en modo MOCK: gates (not_supported, confirm_required, validaciones) y
// mutaciones simuladas sobre la caché.
package httpapi

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"easyzfs/internal/actions"
	"easyzfs/internal/config"
	"easyzfs/internal/db"
	"easyzfs/internal/model"
)

// fakePoolCache — PoolProvider con un dataset cifrado y un pool raidz2.
type fakePoolCache struct {
	datasets []model.Dataset
	pools    []model.Pool
}

func (f *fakePoolCache) Pools() []model.Pool                 { return f.pools }
func (f *fakePoolCache) Datasets() []model.Dataset           { return f.datasets }
func (f *fakePoolCache) SnapshotGroups() []model.SnapGroup   { return nil }
func (f *fakePoolCache) History(string) []model.HistoryEntry { return nil }

// mutaciones simuladas (interfaces que usa el handler en MOCK=1)
func (f *fakePoolCache) SetKeyStatus(name, status string) {
	for i := range f.datasets {
		if f.datasets[i].Name == name {
			f.datasets[i].KeyStatus = status
		}
	}
}
func (f *fakePoolCache) AddDataset(name, typ, comp string, enc bool) {
	e, k := "off", "-"
	if enc {
		e, k = "aes-256-gcm", "available"
	}
	f.datasets = append(f.datasets, model.Dataset{Name: name, Type: typ, Compression: comp, Encryption: e, KeyStatus: k})
}
func (f *fakePoolCache) Expand(pool, vdev, disk string) {
	for i := range f.pools {
		if f.pools[i].Name == pool {
			f.pools[i].Vdevs = append(f.pools[i].Vdevs, model.Vdev{Dev: disk, Role: "raidz2", Status: "ONLINE"})
			f.pools[i].Scrub = model.ScrubInfo{State: "running", Kind: "expand"}
		}
	}
}

type fakeDiskCache struct{ disks []model.Disk }

func (f fakeDiskCache) Disks() []model.Disk { return f.disks }

type fakeCapsExpand struct{ raidz bool }

func (f fakeCapsExpand) Capabilities() model.Capabilities {
	return model.Capabilities{RaidzExpansion: f.raidz}
}

func setupLoteD(t *testing.T, raidzCap bool) *Server {
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
		cfg: &config.Config{Mock: true},
		db:  d,
		act: actions.NewService(d),
		pools: &fakePoolCache{
			datasets: []model.Dataset{
				{Name: "tank/secretos", Type: "fs", Encryption: "aes-256-gcm", KeyStatus: "available", Mountpoint: "/tank/secretos"},
				{Name: "tank/boveda", Type: "fs", Encryption: "aes-256-gcm", KeyStatus: "unavailable", Mountpoint: "-"},
				{Name: "tank/docs", Type: "fs", Encryption: "off", KeyStatus: "-", Mountpoint: "/tank/docs"},
			},
			pools: []model.Pool{{
				Name: "tank", Status: "ONLINE", RaidzVdevs: []string{"raidz2-0"},
				Vdevs: []model.Vdev{{Dev: "sdb", Path: "/dev/sdb", Role: "raidz2", Status: "ONLINE"}},
			}},
		},
		disks: fakeDiskCache{disks: []model.Disk{
			{Dev: "sdb", Pool: "tank"},
			{Dev: "sde", Pool: ""},              // libre
			{Dev: "sdf", Pool: "", InUse: true}, // montado fuera de zfs
		}},
		caps: fakeCapsExpand{raidz: raidzCap},
	}
}

func postDataset(t *testing.T, s *Server, name, suffix, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("POST", "/api/datasets/"+name+"/"+suffix, strings.NewReader(body))
	req.SetPathValue("name", name)
	rec := httptest.NewRecorder()
	switch suffix {
	case "unlock":
		s.unlockDataset(rec, req)
	case "lock":
		s.lockDataset(rec, req)
	case "change-key":
		s.changeKeyDataset(rec, req)
	}
	return rec
}

func TestUnlockLockFlow(t *testing.T) {
	s := setupLoteD(t, true)
	// unlock sin clave → 400 invalid_input
	rec := postDataset(t, s, "tank/boveda", "unlock", `{}`)
	if rec.Code != 400 {
		t.Fatalf("unlock sin clave: code=%d, esperaba 400", rec.Code)
	}
	// unlock ok → 204 y keystatus available
	rec = postDataset(t, s, "tank/boveda", "unlock", `{"key":"la-clave"}`)
	if rec.Code != 204 {
		t.Fatalf("unlock: code=%d body=%s, esperaba 204", rec.Code, rec.Body)
	}
	if s.pools.(*fakePoolCache).datasets[1].KeyStatus != "available" {
		t.Fatalf("keystatus no cambió: %+v", s.pools.(*fakePoolCache).datasets[1])
	}
	// lock ok → 204 y keystatus unavailable
	rec = postDataset(t, s, "tank/boveda", "lock", `{}`)
	if rec.Code != 204 {
		t.Fatalf("lock: code=%d, esperaba 204", rec.Code)
	}
	if s.pools.(*fakePoolCache).datasets[1].KeyStatus != "unavailable" {
		t.Fatalf("keystatus no volvió a unavailable")
	}
	// dataset no cifrado → 400
	rec = postDataset(t, s, "tank/docs", "unlock", `{"key":"x"}`)
	if rec.Code != 400 {
		t.Fatalf("unlock dataset sin cifrar: code=%d, esperaba 400", rec.Code)
	}
	// dataset inexistente → 404
	rec = postDataset(t, s, "tank/nope", "unlock", `{"key":"x"}`)
	if rec.Code != 404 {
		t.Fatalf("unlock inexistente: code=%d, esperaba 404", rec.Code)
	}
	// audit SIN la clave
	var detail string
	if err := s.db.QueryRow("SELECT detail FROM audit_log WHERE action='dataset.unlock'").Scan(&detail); err != nil {
		t.Fatalf("audit: %v", err)
	}
	if strings.Contains(detail, "la-clave") {
		t.Fatalf("la clave aparece en audit_log: %s", detail)
	}
}

func TestChangeKey(t *testing.T) {
	s := setupLoteD(t, true)
	rec := postDataset(t, s, "tank/secretos", "change-key", `{"current_key":"vieja","new_key":"corta"}`)
	if rec.Code != 400 {
		t.Fatalf("new_key <8: code=%d, esperaba 400", rec.Code)
	}
	rec = postDataset(t, s, "tank/secretos", "change-key", `{"new_key":"nueva-clave-larga"}`)
	if rec.Code != 400 {
		t.Fatalf("sin current_key: code=%d, esperaba 400", rec.Code)
	}
	rec = postDataset(t, s, "tank/secretos", "change-key", `{"current_key":"vieja","new_key":"nueva-clave-larga"}`)
	if rec.Code != 204 {
		t.Fatalf("change-key: code=%d body=%s, esperaba 204", rec.Code, rec.Body)
	}
	var detail string
	if err := s.db.QueryRow("SELECT detail FROM audit_log WHERE action='dataset.change_key'").Scan(&detail); err != nil {
		t.Fatalf("audit: %v", err)
	}
	if strings.Contains(detail, "nueva-clave") || strings.Contains(detail, "vieja") {
		t.Fatalf("claves en audit_log: %s", detail)
	}
}

func postExpand(t *testing.T, s *Server, pool, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("POST", "/api/pools/"+pool+"/expand", strings.NewReader(body))
	req.SetPathValue("name", pool)
	rec := httptest.NewRecorder()
	s.expandPool(rec, req)
	return rec
}

func TestExpandGates(t *testing.T) {
	// sin capability → 400 not_supported
	s := setupLoteD(t, false)
	rec := postExpand(t, s, "tank", `{"vdev":"raidz2-0","disk":"sde","confirm":"tank"}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "not_supported") {
		t.Fatalf("sin capability: code=%d body=%s", rec.Code, rec.Body)
	}

	s = setupLoteD(t, true)
	// sin confirm → 400 confirm_required
	rec = postExpand(t, s, "tank", `{"vdev":"raidz2-0","disk":"sde"}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "confirm_required") {
		t.Fatalf("sin confirm: code=%d body=%s", rec.Code, rec.Body)
	}
	// vdev no raidz del pool → 400 invalid_input
	rec = postExpand(t, s, "tank", `{"vdev":"mirror-0","disk":"sde","confirm":"tank"}`)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "invalid_input") {
		t.Fatalf("vdev no raidz: code=%d body=%s", rec.Code, rec.Body)
	}
	// disco miembro del pool → 409 dev_in_use
	rec = postExpand(t, s, "tank", `{"vdev":"raidz2-0","disk":"sdb","confirm":"tank"}`)
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), "dev_in_use") {
		t.Fatalf("disco en uso por el pool: code=%d body=%s", rec.Code, rec.Body)
	}
	// disco en uso fuera de zfs → 409
	rec = postExpand(t, s, "tank", `{"vdev":"raidz2-0","disk":"sdf","confirm":"tank"}`)
	if rec.Code != 409 {
		t.Fatalf("disco montado: code=%d, esperaba 409", rec.Code)
	}
	// pool inexistente → 404
	rec = postExpand(t, s, "nope", `{"vdev":"raidz2-0","disk":"sde","confirm":"nope"}`)
	if rec.Code != 404 {
		t.Fatalf("pool inexistente: code=%d, esperaba 404", rec.Code)
	}
	// feliz → 202 y scan expand simulado
	rec = postExpand(t, s, "tank", `{"vdev":"raidz2-0","disk":"sde","confirm":"tank"}`)
	if rec.Code != 202 {
		t.Fatalf("expand: code=%d body=%s, esperaba 202", rec.Code, rec.Body)
	}
	p := s.pools.Pools()[0]
	if p.Scrub.Kind != "expand" || p.Scrub.State != "running" {
		t.Fatalf("scrub tras expand: %+v", p.Scrub)
	}
}
