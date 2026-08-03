package recs

import (
	"testing"

	"easyzfs/internal/model"
)

func pool(name, status, topo string) model.Pool {
	return model.Pool{Name: name, Status: status, Topo: topo}
}

// Caso real sdb (ZJV3K043): 2528 realloc + 184 pending + 184 offunc → crit replace_now.
func TestEvaluate_DiscoMuriendo(t *testing.T) {
	disks := []model.Disk{{
		Dev: "sdb", Serial: "ZJV3K043", Pool: "TheZBox", Smart: "warn",
		ReallocSectors: 2528, PendingSectors: 184, OfflineUncorr: 184,
	}}
	pools := []model.Pool{pool("TheZBox", "ONLINE", "raidz1")}
	rs := Evaluate(disks, pools)
	if len(rs) != 1 {
		t.Fatalf("recs = %d, esperada 1: %+v", len(rs), rs)
	}
	r := rs[0]
	if r.Level != "crit" || r.Kind != model.RecReplaceNow {
		t.Errorf("rec = %s/%s, esperado crit/replace_now", r.Level, r.Kind)
	}
	if r.Hold {
		t.Errorf("Hold = true con pool ONLINE raidz1, esperado false")
	}
	if r.Serial != "ZJV3K043" || r.PendingSectors != 184 {
		t.Errorf("serial/contadores mal propagados: %+v", r)
	}
}

// Caso real sdc (ZJV47B0J): 48 realloc (vigilar) + 1,19M CRC (cable) →
// info watch + warn check_cable. Jamás debe sugerir cambiar el disco por CRC.
func TestEvaluate_TormentaCRC(t *testing.T) {
	disks := []model.Disk{{
		Dev: "sdc", Serial: "ZJV47B0J", Pool: "TheZBox", Smart: "warn",
		ReallocSectors: 48, CrcErrors: 1194458,
	}}
	pools := []model.Pool{pool("TheZBox", "ONLINE", "raidz1")}
	rs := Evaluate(disks, pools)
	if len(rs) != 2 {
		t.Fatalf("recs = %d, esperadas 2: %+v", len(rs), rs)
	}
	var cable, watch bool
	for _, r := range rs {
		if r.Kind == model.RecCheckCable && r.Level == "warn" {
			cable = true
		}
		if r.Kind == model.RecWatch && r.Level == "info" {
			watch = true
		}
		if r.Kind == model.RecReplaceNow || r.Kind == model.RecReplaceSoon {
			t.Errorf("NUNCA sugerir sustitución por CRC: %+v", r)
		}
	}
	if !cable || !watch {
		t.Errorf("esperadas check_cable(warn) + watch(info): %+v", rs)
	}
}

// SMART overall FAILED → crit replace_now aunque no haya contadores.
func TestEvaluate_SmartFailed(t *testing.T) {
	disks := []model.Disk{{Dev: "sda", Serial: "X", Pool: "tank", Smart: "crit"}}
	rs := Evaluate(disks, []model.Pool{pool("tank", "ONLINE", "mirror")})
	if len(rs) != 1 || rs[0].Kind != model.RecReplaceNow || rs[0].Level != "crit" {
		t.Fatalf("esperado crit/replace_now: %+v", rs)
	}
}

// Disco sano → cero recomendaciones.
func TestEvaluate_Sano(t *testing.T) {
	disks := []model.Disk{
		{Dev: "sda", Serial: "A", Pool: "tank", Smart: "ok"},
		{Dev: "nvme0n1", Serial: "B", Pool: "tank", Smart: "ok", CrcErrors: 3}, // CRC histórico suelto
		{Dev: "mmcblk0", Serial: "C", Pool: "—", Smart: "unknown"},             // sin SMART: sin recs
	}
	if rs := Evaluate(disks, []model.Pool{pool("tank", "ONLINE", "mirror")}); len(rs) != 0 {
		t.Fatalf("esperadas 0 recs: %+v", rs)
	}
}

// Guardas de seguridad: la sustitución debe esperar con resilver en curso,
// pool degradado o pool sin redundancia (stripe).
func TestEvaluate_Holds(t *testing.T) {
	dying := model.Disk{Dev: "sdb", Serial: "X", Pool: "tank", Smart: "warn", PendingSectors: 10}
	casos := []struct {
		nombre string
		pool   model.Pool
		hold   string
	}{
		{"resilver", func() model.Pool {
			p := pool("tank", "ONLINE", "raidz1")
			p.Scrub.State, p.Scrub.Kind = "running", "resilver"
			return p
		}(), model.HoldResilver},
		{"degradado", pool("tank", "DEGRADED", "raidz1"), model.HoldPoolDegraded},
		{"stripe", pool("tank", "ONLINE", "stripe"), model.HoldNoRedundancy},
		{"online ok", pool("tank", "ONLINE", "raidz1"), ""},
	}
	for _, c := range casos {
		rs := Evaluate([]model.Disk{dying}, []model.Pool{c.pool})
		if len(rs) != 1 {
			t.Fatalf("%s: recs = %d", c.nombre, len(rs))
		}
		if c.hold == "" && rs[0].Hold {
			t.Errorf("%s: Hold inesperado (%s)", c.nombre, rs[0].HoldReason)
		}
		if c.hold != "" && (!rs[0].Hold || rs[0].HoldReason != c.hold) {
			t.Errorf("%s: Hold = %v/%q, esperado true/%q", c.nombre, rs[0].Hold, rs[0].HoldReason, c.hold)
		}
	}
}

// Orden del resultado: crit primero, luego warn, luego info.
func TestEvaluate_OrdenSeveridad(t *testing.T) {
	disks := []model.Disk{
		{Dev: "sdinfo", Serial: "I", Pool: "tank", Smart: "warn", ReallocSectors: 5},
		{Dev: "sdcrit", Serial: "C", Pool: "tank", Smart: "warn", PendingSectors: 1},
		{Dev: "sdwarn", Serial: "W", Pool: "tank", Smart: "warn", ReallocSectors: 500},
	}
	rs := Evaluate(disks, []model.Pool{pool("tank", "ONLINE", "raidz1")})
	if len(rs) != 3 || rs[0].Dev != "sdcrit" || rs[1].Dev != "sdwarn" || rs[2].Dev != "sdinfo" {
		t.Fatalf("orden incorrecto: %+v", rs)
	}
}

// Umbral realloc: 99 → watch, 100 → replace_soon.
func TestEvaluate_UmbralRealloc(t *testing.T) {
	for n, want := range map[int64]string{99: model.RecWatch, 100: model.RecReplaceSoon} {
		disks := []model.Disk{{Dev: "sda", Serial: "X", Pool: "tank", Smart: "warn", ReallocSectors: n}}
		rs := Evaluate(disks, []model.Pool{pool("tank", "ONLINE", "mirror")})
		if len(rs) != 1 || rs[0].Kind != want {
			t.Errorf("realloc=%d: kind = %v, esperado %s", n, rs, want)
		}
	}
}
