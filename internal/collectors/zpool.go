// zpool.go — colector ZFS: pools (list + status con JSON/fallback), datasets,
// snapshots. Intervalo 30 s. Publica pool.status / scrub.progress solo en cambios.
package collectors

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gnacho/zfsctl/internal/alerts"
	"github.com/gnacho/zfsctl/internal/executil"
	"github.com/gnacho/zfsctl/internal/hub"
	"github.com/gnacho/zfsctl/internal/model"
)

const (
	zpoolInterval   = 30 * time.Second
	zpoolMaxBackoff = 5 * time.Minute
	seriesInterval  = 10 * time.Minute // persistir series con esta cadencia mínima
)

// ZpoolCollector — caché de pools, datasets y snapshots.
type ZpoolCollector struct {
	db *sql.DB
	h  *hub.Hub
	al *alerts.Alerter

	mu       sync.RWMutex
	pools    []model.Pool
	datasets []model.Dataset
	snaps    []model.Snapshot

	fails      int
	stale      bool
	prevStatus map[string]string
	prevPct    map[string]int
	lastSeries map[string]time.Time
}

// NewZpoolCollector crea el colector.
func NewZpoolCollector(d *sql.DB, h *hub.Hub, al *alerts.Alerter) *ZpoolCollector {
	return &ZpoolCollector{
		db:         d,
		h:          h,
		al:         al,
		prevStatus: map[string]string{},
		prevPct:    map[string]int{},
		lastSeries: map[string]time.Time{},
	}
}

// Name implementa Collector.
func (c *ZpoolCollector) Name() string { return "zpool" }

// Run — bucle con ticker, backoff tras 3 fallos seguidos (patrón del skill).
func (c *ZpoolCollector) Run(ctx context.Context) {
	interval := zpoolInterval
	t := time.NewTicker(interval)
	defer t.Stop()
	if err := c.collectOnce(ctx); err != nil {
		log.Printf("zpool: %v", err)
		c.fails++
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := c.collectOnce(ctx); err != nil {
				log.Printf("zpool: %v", err)
				c.fails++
			} else {
				c.fails = 0
			}
			if c.fails >= 3 {
				if !c.stale {
					log.Printf("zpool: fuente stale tras %d fallos; backoff", c.fails)
				}
				c.stale = true
				interval = min(2*interval, zpoolMaxBackoff)
				t.Reset(interval)
			} else if interval != zpoolInterval {
				c.stale = false
				interval = zpoolInterval
				t.Reset(interval)
			}
		}
	}
}

// Pools — caché de pools (copia defensiva).
func (c *ZpoolCollector) Pools() []model.Pool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]model.Pool, len(c.pools))
	copy(out, c.pools)
	return out
}

// Datasets — caché de datasets.
func (c *ZpoolCollector) Datasets() []model.Dataset {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make([]model.Dataset, len(c.datasets))
	copy(out, c.datasets)
	return out
}

// SnapshotGroups — snapshots agrupados por dataset, más recientes primero.
func (c *ZpoolCollector) SnapshotGroups() []model.SnapGroup {
	c.mu.RLock()
	defer c.mu.RUnlock()
	byDS := map[string][]model.Snapshot{}
	order := []string{}
	for _, s := range c.snaps {
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

// collectOnce — una pasada completa: list → status por pool → datasets → snapshots.
func (c *ZpoolCollector) collectOnce(ctx context.Context) error {
	pools, err := c.listPools(ctx)
	if err != nil {
		return err
	}
	for i := range pools {
		c.fillStatus(ctx, &pools[i]) // tolerante: degrada, no falla la pasada
		c.fillCompressRatio(ctx, &pools[i])
	}
	datasets, err := c.listDatasets(ctx)
	if err != nil {
		return err
	}
	snaps, err := c.listSnapshots(ctx)
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.pools = pools
	c.datasets = datasets
	c.snaps = snaps
	c.mu.Unlock()

	c.publishChanges(pools)
	c.al.EvaluatePools(ctx, pools)
	c.persistSeries(ctx, pools)
	return nil
}

// listPools — 'zpool list -Hp' con columnas explícitas por nombre.
func (c *ZpoolCollector) listPools(ctx context.Context) ([]model.Pool, error) {
	out, err := executil.Run(ctx, 10*time.Second, "zpool", "list", "-Hp",
		"-o", "name,size,alloc,fragmentation,health")
	if err != nil {
		return nil, err
	}
	pools := []model.Pool{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		f := strings.Split(line, "\t")
		if len(f) < 5 {
			log.Printf("zpool list: línea con %d campos (esperaba 5): %q", len(f), line)
			continue
		}
		p := model.Pool{
			Name:       f[0],
			TotalBytes: parseUint(f[1]),
			UsedBytes:  parseUint(f[2]),
			FragPct:    parsePct(f[3]),
			Status:     f[4],
			Scrub:      model.ScrubInfo{State: "none"},
			Vdevs:      []model.Vdev{},
		}
		pools = append(pools, p)
	}
	return pools, nil
}

// fillCompressRatio — compressratio del dataset raíz del pool como ratio del pool.
func (c *ZpoolCollector) fillCompressRatio(ctx context.Context, p *model.Pool) {
	out, err := executil.Run(ctx, 5*time.Second, "zfs", "get", "-Hp", "-o", "value",
		"compressratio", p.Name)
	if err != nil {
		return
	}
	v := strings.TrimSuffix(strings.TrimSpace(string(out)), "x")
	if n, err := strconv.ParseFloat(v, 64); err == nil {
		p.CompRatio = n
	}
}

// --- zpool status: JSON (OpenZFS ≥2.2) con fallback a texto ---

type zpoolStatusJSON struct {
	Pools map[string]struct {
		Name      string             `json:"name"`
		State     string             `json:"state"`
		Vdevs     map[string]jsonVdev `json:"vdevs"`
		ScanStats *struct {
			State         string   `json:"state"`
			Percentage    float64  `json:"percentage"`
			TotalSecsLeft flexInt  `json:"total_secs_left"`
			Errors        flexInt  `json:"errors"`
			EndTime       string   `json:"end_time"`
		} `json:"scan_stats"`
	} `json:"pools"`
}

type jsonVdev struct {
	Name     string             `json:"name"`
	VdevType string             `json:"vdev_type"`
	State    string             `json:"state"`
	Vdevs    map[string]jsonVdev `json:"vdevs"`
}

// flexInt tolera números JSON como número o string ("0").
type flexInt int64

// UnmarshalJSON implementa json.Unmarshaler.
func (f *flexInt) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		*f = 0
		return nil // tolerante
	}
	*f = flexInt(n)
	return nil
}

// fillStatus rellena vdevs y scrub; intenta --json y cae a texto plano.
func (c *ZpoolCollector) fillStatus(ctx context.Context, p *model.Pool) {
	out, err := executil.Run(ctx, 15*time.Second, "zpool", "status", "--json", p.Name)
	if err == nil {
		if c.parseStatusJSON(out, p) {
			return
		}
	}
	out, err = executil.Run(ctx, 15*time.Second, "zpool", "status", p.Name)
	if err != nil {
		return
	}
	c.parseStatusText(string(out), p)
}

// parseStatusJSON — vía primaria. Devuelve false si el JSON no es reconocible.
func (c *ZpoolCollector) parseStatusJSON(out []byte, p *model.Pool) bool {
	var st zpoolStatusJSON
	if err := json.Unmarshal(out, &st); err != nil {
		return false
	}
	pj, ok := st.Pools[p.Name]
	if !ok {
		return false
	}
	if pj.State != "" {
		p.Status = pj.State
	}
	roles := map[string]bool{}
	for _, root := range pj.Vdevs {
		c.walkVdev(root, "stripe", p, roles)
	}
	p.Topo = topoFromRoles(roles)
	if ss := pj.ScanStats; ss != nil {
		switch ss.State {
		case "DSS_SCANNING":
			p.Scrub = model.ScrubInfo{State: "running", Pct: ss.Percentage,
				EtaSec: int64(ss.TotalSecsLeft), Ts: time.Now().UTC(), Errors: int64(ss.Errors)}
		case "DSS_FINISHED":
			p.Scrub = model.ScrubInfo{State: "done", Pct: 100,
				Ts: parseZfsTime(ss.EndTime), Errors: int64(ss.Errors)}
		}
	}
	return true
}

// walkVdev recorre el árbol JSON de vdevs recogiendo discos hoja y roles.
func (c *ZpoolCollector) walkVdev(v jsonVdev, role string, p *model.Pool, roles map[string]bool) {
	t := vdevRole(v.Name, v.VdevType)
	if t != "" {
		role = t
		roles[t] = true
	}
	if len(v.Vdevs) == 0 {
		if v.Name != p.Name && v.VdevType != "root" {
			p.Vdevs = append(p.Vdevs, model.Vdev{
				Dev:    baseName(v.Name),
				Role:   role,
				Status: v.State,
			})
		}
		return
	}
	// orden estable para la UI
	names := make([]string, 0, len(v.Vdevs))
	for n := range v.Vdevs {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		child := v.Vdevs[n]
		c.walkVdev(child, role, p, roles)
	}
}

// vdevRole clasifica un vdev contenedor por nombre/tipo.
func vdevRole(name, vtype string) string {
	s := name + " " + vtype
	switch {
	case strings.Contains(s, "raidz3"):
		return "raidz3"
	case strings.Contains(s, "raidz2"):
		return "raidz2"
	case strings.Contains(s, "raidz"):
		return "raidz1"
	case strings.Contains(s, "mirror"):
		return "mirror"
	case strings.Contains(s, "spare"):
		return "spare"
	case strings.Contains(s, "log"):
		return "log"
	case strings.Contains(s, "cache"):
		return "cache"
	}
	return ""
}

// topoFromRoles — la topología del pool = el rol de datos "más fuerte".
func topoFromRoles(roles map[string]bool) string {
	for _, t := range []string{"raidz3", "raidz2", "raidz1", "mirror"} {
		if roles[t] {
			return t
		}
	}
	return "stripe"
}

// parseZfsTime — formato de fechas de zpool status ('Thu Jun  6 05:12:33 2024').
func parseZfsTime(s string) time.Time {
	if t, err := time.Parse("Mon Jan _2 15:04:05 2006", s); err == nil {
		return t.UTC()
	}
	return time.Now().UTC()
}

// --- Fallback texto (OpenZFS <2.2, sin --json). Mejor esfuerzo documentado. ---

var (
	vdevLineRe  = regexp.MustCompile(`^(\s+)(\S+)\s+(ONLINE|DEGRADED|FAULTED|UNAVAIL|OFFLINE|REMOVED)\s+\d+`)
	scrubDoneRe = regexp.MustCompile(`scrub .* with (\d+) errors on (.+)$`)
	scrubPctRe  = regexp.MustCompile(`(\d+(?:\.\d+)?)%\s+done`)
	scrubEtaRe  = regexp.MustCompile(`(\d+):(\d{2}):(\d{2}) to go`)
)

// parseStatusText — parseo defensivo del formato clásico de 'zpool status'.
func (c *ZpoolCollector) parseStatusText(out string, p *model.Pool) {
	roles := map[string]bool{}
	curRole := "stripe"
	inConfig := false
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(line, "config:") {
			inConfig = true
			continue
		}
		if inConfig {
			m := vdevLineRe.FindStringSubmatch(line)
			if m != nil {
				name, state := m[2], m[3]
				if r := vdevRole(name, ""); r != "" {
					curRole = r
					roles[r] = true
					continue
				}
				if name == p.Name {
					continue
				}
				p.Vdevs = append(p.Vdevs, model.Vdev{
					Dev:    baseName(name),
					Role:   curRole,
					Status: state,
				})
			}
		}
		if strings.HasPrefix(strings.TrimSpace(line), "scan:") {
			c.parseScanLine(line, p)
		} else if p.Scrub.State == "running" {
			// la línea de progreso va separada del 'scan:' en algunos formatos
			if m := scrubPctRe.FindStringSubmatch(line); m != nil {
				p.Scrub.Pct, _ = strconv.ParseFloat(m[1], 64)
			}
			if m := scrubEtaRe.FindStringSubmatch(line); m != nil {
				h, _ := strconv.Atoi(m[1])
				mi, _ := strconv.Atoi(m[2])
				se, _ := strconv.Atoi(m[3])
				p.Scrub.EtaSec = int64(h*3600 + mi*60 + se)
			}
		}
	}
	p.Topo = topoFromRoles(roles)
}

// parseScanLine interpreta la línea 'scan:' del estado.
func (c *ZpoolCollector) parseScanLine(line string, p *model.Pool) {
	switch {
	case strings.Contains(line, "scrub in progress"):
		p.Scrub = model.ScrubInfo{State: "running", Ts: time.Now().UTC()}
		if m := scrubPctRe.FindStringSubmatch(line); m != nil {
			p.Scrub.Pct, _ = strconv.ParseFloat(m[1], 64)
		}
		if m := scrubEtaRe.FindStringSubmatch(line); m != nil {
			h, _ := strconv.Atoi(m[1])
			mi, _ := strconv.Atoi(m[2])
			se, _ := strconv.Atoi(m[3])
			p.Scrub.EtaSec = int64(h*3600 + mi*60 + se)
		}
	case strings.Contains(line, "scrub repaired") || strings.Contains(line, "scrub resilvered"):
		st := model.ScrubInfo{State: "done", Pct: 100, Ts: time.Now().UTC()}
		if m := scrubDoneRe.FindStringSubmatch(line); m != nil {
			st.Errors, _ = strconv.ParseInt(m[1], 10, 64)
			st.Ts = parseZfsTime(m[2])
		}
		p.Scrub = st
	case strings.Contains(line, "none requested"):
		p.Scrub = model.ScrubInfo{State: "none"}
	}
}

// --- datasets y snapshots ---

// listDatasets — 'zfs list -Hp -t filesystem,volume' con columnas por nombre.
func (c *ZpoolCollector) listDatasets(ctx context.Context) ([]model.Dataset, error) {
	out, err := executil.Run(ctx, 10*time.Second, "zfs", "list", "-Hp",
		"-t", "filesystem,volume",
		"-o", "name,type,compression,used,avail,quota,mountpoint")
	if err != nil {
		return nil, err
	}
	datasets := []model.Dataset{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		f := strings.Split(line, "\t")
		if len(f) < 7 {
			log.Printf("zfs list: línea con %d campos (esperaba 7): %q", len(f), line)
			continue
		}
		typ := "fs"
		if f[1] == "volume" {
			typ = "volume"
		}
		datasets = append(datasets, model.Dataset{
			Name:        f[0],
			Type:        typ,
			Compression: f[2],
			UsedBytes:   parseUint(f[3]),
			AvailBytes:  parseUint(f[4]),
			QuotaBytes:  parseUint(f[5]), // '-' → 0 (sin cuota)
			Mountpoint:  f[6],
		})
	}
	return datasets, nil
}

// listSnapshots — 'zfs list -Hp -t snapshot' (creation en epoch con -p).
func (c *ZpoolCollector) listSnapshots(ctx context.Context) ([]model.Snapshot, error) {
	out, err := executil.Run(ctx, 10*time.Second, "zfs", "list", "-Hp",
		"-t", "snapshot", "-o", "name,creation,used")
	if err != nil {
		return nil, err
	}
	snaps := []model.Snapshot{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		f := strings.Split(line, "\t")
		if len(f) < 3 {
			continue
		}
		_, snapName, _ := strings.Cut(f[0], "@")
		kind := "manual"
		if strings.HasPrefix(snapName, model.AutoSnapPrefix) {
			kind = "auto"
		}
		snaps = append(snaps, model.Snapshot{
			Name:      snapName,
			Full:      f[0],
			Ts:        time.Unix(int64(parseUint(f[1])), 0).UTC(),
			UsedBytes: parseUint(f[2]),
			Kind:      kind,
		})
	}
	return snaps, nil
}

// --- eventos SSE y series ---

// publishChanges emite pool.status y scrub.progress solo cuando cambian.
func (c *ZpoolCollector) publishChanges(pools []model.Pool) {
	changed := false
	for _, p := range pools {
		if c.prevStatus[p.Name] != "" && c.prevStatus[p.Name] != p.Status {
			c.h.Publish("pool.status", map[string]any{"name": p.Name, "status": p.Status})
			changed = true
		}
		c.prevStatus[p.Name] = p.Status

		pct := int(p.Scrub.Pct)
		if p.Scrub.State == "running" && c.prevPct[p.Name] != pct {
			c.h.Publish("scrub.progress", map[string]any{
				"pool": p.Name, "pct": p.Scrub.Pct, "eta_sec": p.Scrub.EtaSec,
			})
			c.prevPct[p.Name] = pct
		}
		if p.Scrub.State == "done" && c.prevPct[p.Name] != 100 {
			c.h.Publish("scrub.progress", map[string]any{
				"pool": p.Name, "pct": 100.0, "eta_sec": int64(0),
			})
			c.prevPct[p.Name] = 100
			changed = true
		}
	}
	if changed {
		c.h.Publish("overview", map[string]any{"reason": "pool.status"})
	}
}

// persistSeries guarda pool.<name>.used_pct cada seriesInterval (con retención).
func (c *ZpoolCollector) persistSeries(ctx context.Context, pools []model.Pool) {
	now := time.Now()
	for _, p := range pools {
		key := "pool." + p.Name + ".used_pct"
		if last, ok := c.lastSeries[key]; ok && now.Sub(last) < seriesInterval {
			continue
		}
		if p.TotalBytes == 0 {
			continue
		}
		pct := float64(p.UsedBytes) * 100 / float64(p.TotalBytes)
		if _, err := c.db.ExecContext(ctx,
			"INSERT INTO series(source, ts, value) VALUES (?,?,?)",
			key, now.UTC().Format(time.RFC3339), pct); err != nil {
			log.Printf("zpool series: %v", err)
			continue
		}
		c.lastSeries[key] = now
	}
}

// --- helpers de parseo ---

// parseUint convierte un campo numérico de salida -p ('12345' o '-').
func parseUint(s string) uint64 {
	if s == "-" || s == "" {
		return 0
	}
	n, _ := strconv.ParseUint(s, 10, 64)
	return n
}

// parsePct convierte '12' o '12%' a float64.
func parsePct(s string) float64 {
	s = strings.TrimSuffix(s, "%")
	n, _ := strconv.ParseFloat(s, 64)
	return n
}

// DetectZFSVersion — versión de OpenZFS del host para /api/version.
func DetectZFSVersion(ctx context.Context) string {
	out, err := executil.Run(ctx, 5*time.Second, "zpool", "--version")
	if err != nil {
		return "desconocida"
	}
	// formato: 'zfs-2.2.6-1\nzfs-kmod-2.2.6-1'
	first, _, _ := strings.Cut(strings.TrimSpace(string(out)), "\n")
	return strings.TrimPrefix(first, "zfs-")
}
