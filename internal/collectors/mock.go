// mock.go — datos realistas del dominio para desarrollo/demo (MOCK=1 o DEMO=1).
// Dominio: pools tank (raidz1, 3×4 TB) y ssd (mirror, 2×1 TB NVMe), 7 discos
// (incl. una eMMC mmcblk0 sin SMART, como en el hardware real reportado),
// scrub de ssd en curso que avanza en cada tick y emite scrub.progress.
package collectors

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"easyzfs/internal/alerts"
	"easyzfs/internal/hub"
	"easyzfs/internal/model"
)

// Mock — implementa PoolProvider y DiskProvider con datos vivos de mentira.
type Mock struct {
	h  *hub.Hub
	al *alerts.Alerter

	mu         sync.RWMutex
	pools      []model.Pool
	datasets   []model.Dataset
	snaps      []model.Snapshot
	disks      []model.Disk
	scrubStart time.Time
	lastPct    int
}

// NewMock construye el escenario realista.
func NewMock(h *hub.Hub, al *alerts.Alerter) *Mock {
	m := &Mock{h: h, al: al, scrubStart: time.Now()}
	m.build()
	return m
}

// Name implementa Collector.
func (m *Mock) Name() string { return "mock" }

// Run — avanza el scrub del pool ssd (~1 % cada 5 s) y republica temperaturas.
func (m *Mock) Run(ctx context.Context) {
	// Evaluación inicial: sdd tiene SMART con avisos → alerta de ejemplo con
	// target navegable ("disks:sdd"), como haría el colector real.
	m.al.EvaluateDisks(ctx, m.Disks())
	m.al.EvaluatePools(ctx, m.Pools())
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			m.tick(now)
		}
	}
}

// tick — evolución del escenario: scrub avanza; al terminar queda 'done'.
func (m *Mock) tick(now time.Time) {
	m.mu.Lock()
	for i := range m.pools {
		p := &m.pools[i]
		if p.Name != "ssd" {
			continue
		}
		if p.Scrub.State == "running" {
			p.Scrub.Pct += 1.5
			if p.Scrub.Pct >= 100 {
				p.Scrub = model.ScrubInfo{State: "done", Pct: 100, Ts: now.UTC(), Errors: 0}
			} else {
				p.Scrub.EtaSec = int64((100 - p.Scrub.Pct) * 5 / 1.5)
			}
		}
	}
	scrub := model.ScrubInfo{}
	for _, p := range m.pools {
		if p.Name == "ssd" {
			scrub = p.Scrub
		}
	}
	m.mu.Unlock()

	pct := int(scrub.Pct)
	if pct != m.lastPct {
		m.h.Publish("scrub.progress", map[string]any{
			"pool": "ssd", "pct": scrub.Pct, "eta_sec": scrub.EtaSec,
		})
		m.lastPct = pct
		if scrub.State == "done" {
			m.h.Publish("overview", map[string]any{"reason": "scrub.done"})
		}
	}
}

// Pools implementa PoolProvider.
func (m *Mock) Pools() []model.Pool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]model.Pool, len(m.pools))
	copy(out, m.pools)
	return out
}

// Datasets implementa PoolProvider.
func (m *Mock) Datasets() []model.Dataset {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]model.Dataset, len(m.datasets))
	copy(out, m.datasets)
	return out
}

// SnapshotGroups implementa PoolProvider.
func (m *Mock) SnapshotGroups() []model.SnapGroup {
	m.mu.RLock()
	defer m.mu.RUnlock()
	byDS := map[string][]model.Snapshot{}
	order := []string{}
	for _, s := range m.snaps {
		ds, _, _ := strings.Cut(s.Full, "@")
		if _, ok := byDS[ds]; !ok {
			order = append(order, ds)
		}
		byDS[ds] = append(byDS[ds], s)
	}
	sort.Strings(order)
	out := make([]model.SnapGroup, 0, len(order))
	for _, ds := range order {
		snaps := byDS[ds]
		sort.Slice(snaps, func(i, j int) bool { return snaps[i].Ts.After(snaps[j].Ts) })
		out = append(out, model.SnapGroup{Dataset: ds, Snaps: snaps})
	}
	return out
}

// Disks implementa DiskProvider.
func (m *Mock) Disks() []model.Disk {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]model.Disk, len(m.disks))
	copy(out, m.disks)
	return out
}

// SysTimers implementa SysTimerProvider: ejemplos de timers systemd y cron
// que un NAS típico ya tendría (la vista Tareas los muestra junto a los jobs).
func (m *Mock) SysTimers() []model.SysTimer {
	now := time.Now().UTC()
	return []model.SysTimer{
		{
			Source: "systemd", Name: "zfs-scrub@tank-monthly.timer", Schedule: "monthly",
			NextRun: now.Add(11 * 24 * time.Hour).Format(time.RFC3339),
			LastRun: now.Add(-19 * 24 * time.Hour).Format(time.RFC3339),
			Command: "zfs-scrub@tank-monthly.service", Origin: "systemctl list-timers",
			Editable: true,
		},
		{
			Source: "systemd", Name: "logrotate.timer", Schedule: "daily",
			NextRun: now.Add(6 * time.Hour).Format(time.RFC3339),
			LastRun: now.Add(-18 * time.Hour).Format(time.RFC3339),
			Command: "logrotate.service", Origin: "systemctl list-timers",
		},
		{
			Source: "systemd", Name: "man-db.timer", Schedule: "daily",
			NextRun: now.Add(9 * time.Hour).Format(time.RFC3339),
			LastRun: now.Add(-15 * time.Hour).Format(time.RFC3339),
			Command: "man-db.service", Origin: "systemctl list-timers",
		},
		{
			Source: "cron", Name: "backup-tank.sh", Schedule: "30 3 * * *",
			Command: "/usr/local/bin/backup-tank.sh --pool tank --dest /mnt/usb",
			Origin:  "/etc/cron.d/backup", Line: 7, Editable: true,
		},
	}
}

// build — el escenario estático inicial.
func (m *Mock) build() {
	const (
		gib = 1 << 30
		tib = 1 << 40
	)
	m.pools = []model.Pool{
		{
			Name:       "tank",
			Status:     "DEGRADED",
			Topo:       "raidz1",
			UsedBytes:  6*uint64(tib) + 420*uint64(gib),
			TotalBytes: 12 * uint64(tib), // 3×4 TB raidz1 ≈ 8 TB útiles; total bruto 12 TB
			FragPct:    12,
			CompRatio:  1.18,
			Scrub:      model.ScrubInfo{State: "done", Pct: 100, Ts: time.Now().Add(-9 * 24 * time.Hour).UTC(), Errors: 0},
			Vdevs: []model.Vdev{
				{Dev: "sdb", Role: "raidz1", Status: "ONLINE", TempC: 34},
				{Dev: "sdc", Role: "raidz1", Status: "ONLINE", TempC: 35},
				// Caso real (pool heredado): vdev nombrado por PARTUUID y
				// FAULTED; sin Path porque el disco ya no responde.
				{Dev: "8ab95469-2ae7-411a-af39-47b1d4f39d3c", Role: "raidz1", Status: "FAULTED"},
			},
		},
		{
			Name:       "ssd",
			Status:     "DEGRADED",
			Topo:       "mirror",
			UsedBytes:  420 * uint64(gib),
			TotalBytes: 2 * uint64(tib),
			FragPct:    4,
			CompRatio:  1.09,
			Scrub:      model.ScrubInfo{State: "running", Kind: "resilver", Pct: 23, EtaSec: 1500, Ts: m.scrubStart.UTC(), Errors: 0},
			Vdevs: []model.Vdev{
				{Dev: "nvme0n1", Role: "mirror", Status: "ONLINE", TempC: 41},
				// Pareja replacing- real: viejo saliente (CANT_OPEN) + nuevo ya ONLINE
				{Dev: "13501483247074580929", Role: "mirror", Status: "CANT_OPEN", Replacing: true},
				{Dev: "nvme1n1", Role: "mirror", Status: "ONLINE", TempC: 42, Replacing: true},
			},
		},
	}
	m.datasets = []model.Dataset{
		{Name: "tank", Type: "fs", Compression: "lz4", UsedBytes: 6*uint64(tib) + 420*uint64(gib), AvailBytes: 5 * uint64(tib), QuotaBytes: 0, Mountpoint: "/tank"},
		{Name: "tank/docs", Type: "fs", Compression: "lz4", UsedBytes: 220 * uint64(gib), AvailBytes: 5 * uint64(tib), QuotaBytes: 512 * uint64(gib), Mountpoint: "/tank/docs"},
		{Name: "tank/fotos", Type: "fs", Compression: "lz4", UsedBytes: 3*uint64(tib) + 100*uint64(gib), AvailBytes: 5 * uint64(tib), QuotaBytes: 0, Mountpoint: "/tank/fotos"},
		{Name: "tank/backups", Type: "fs", Compression: "zstd", UsedBytes: 3*uint64(tib) + 40*uint64(gib), AvailBytes: 5 * uint64(tib), QuotaBytes: 4 * uint64(tib), Mountpoint: "/tank/backups"},
		{Name: "ssd", Type: "fs", Compression: "lz4", UsedBytes: 420 * uint64(gib), AvailBytes: 1500 * uint64(gib), QuotaBytes: 0, Mountpoint: "/ssd"},
		{Name: "ssd/vm", Type: "volume", Compression: "zstd", UsedBytes: 320 * uint64(gib), AvailBytes: 1500 * uint64(gib), QuotaBytes: 400 * uint64(gib), Mountpoint: "-"},
	}
	now := time.Now().UTC()
	mkSnap := func(ds, name string, age time.Duration, used uint64, kind string) model.Snapshot {
		return model.Snapshot{Name: name, Full: ds + "@" + name, Ts: now.Add(-age), UsedBytes: used, Kind: kind}
	}
	m.snaps = []model.Snapshot{
		mkSnap("tank/docs", "easyzfs-auto-20250101-0600", 48*time.Hour, 1*uint64(gib), "auto"),
		mkSnap("tank/docs", "easyzfs-auto-20250102-0600", 24*time.Hour, 800*(1<<20), "auto"),
		mkSnap("tank/docs", "antes-de-migracion", 30*24*time.Hour, 2*uint64(gib), "manual"),
		mkSnap("tank/fotos", "easyzfs-auto-20250102-0600", 24*time.Hour, 3*uint64(gib), "auto"),
		mkSnap("tank/backups", "easyzfs-auto-20250102-0600", 24*time.Hour, 12*uint64(gib), "auto"),
		mkSnap("ssd/vm", "pre-upgrade", 7*24*time.Hour, 20*uint64(gib), "manual"),
	}
	m.disks = []model.Disk{
		{Dev: "sda", Model: "CT500MX500SSD1", Serial: "2034E5A1B2C3", SizeBytes: 500 * uint64(gib), TempC: f64ptr(33), Smart: "ok", SmartDetail: "PASSED", Pool: "", Hours: 18200},
		{Dev: "sdb", Model: "WDC WD40EFRX-68N", Serial: "WD-WCC7K1AAAA01", SizeBytes: 4 * uint64(tib), TempC: f64ptr(34), Smart: "ok", SmartDetail: "PASSED", Pool: "tank", Hours: 41230},
		{Dev: "sdc", Model: "WDC WD40EFRX-68N", Serial: "WD-WCC7K1AAAA02", SizeBytes: 4 * uint64(tib), TempC: f64ptr(35), Smart: "ok", SmartDetail: "PASSED", Pool: "tank", Hours: 41231},
		{Dev: "sdd", Model: "WDC WD40EFRX-68N", Serial: "WD-WCC7K1AAAA03", SizeBytes: 4 * uint64(tib), TempC: f64ptr(36), Smart: "warn", SmartDetail: "PASSED (realloc=2 pending=0)", Pool: "tank", Hours: 42010},
		{Dev: "nvme0n1", Model: "Samsung SSD 980 1TB", Serial: "S649NL0R111111", SizeBytes: 1 * uint64(tib), TempC: f64ptr(41), Smart: "ok", SmartDetail: "PASSED", Pool: "ssd", Hours: 9800},
		{Dev: "nvme1n1", Model: "Samsung SSD 980 1TB", Serial: "S649NL0R222222", SizeBytes: 1 * uint64(tib), TempC: f64ptr(42), Smart: "ok", SmartDetail: "PASSED", Pool: "ssd", Hours: 9812},
		// Caso real: eMMC de placa (smartctl no la soporta → "unknown", sin
		// lectura de temperatura → TempC nil, JSON null). En el sistema también
		// había zd0 y mmcblk0boot0/boot1, pero el filtro de discos físicos los
		// excluye (ver smart.go).
		{Dev: "mmcblk0", Model: "S008G1 eMMC", Serial: "0x2c8f1a3b", SizeBytes: 8 * uint64(gib), TempC: nil, Smart: "unknown", SmartDetail: "no disponible", Pool: "", Hours: 0},
	}
}

// f64ptr — helper para literales *float64 del mock (temp_c: number|null).
func f64ptr(v float64) *float64 { return &v }
