// events_test.go — parser de bloques de 'zpool events -f' y mapeo a alertas.
package collectors

import (
	"context"
	"strings"
	"testing"

	"easyzfs/internal/alerts"
	"easyzfs/internal/db"
	"easyzfs/internal/hub"
	"easyzfs/internal/settings"
)

// Bloques representativos reales (formato 'zpool events' de OpenZFS 2.2/2.3).
const (
	blkIOError = `Aug 11 2025 13:27:13.442300254 ereport.fs.zfs.io
        class = "ereport.fs.zfs.io"
        ena = 0x2c1b4d2a00400001
        detector = (embedded nvlist)
                (start "ereport.fs.zfs.io")
                        version = 0x0
                        class = "ereport.fs.zfs.io"
                        pool = "tank"
                        pool_guid = 0x91a2b3c4d5e6f708
                        vdev = "sdb1"
                        vdev_guid = 0x1a2b3c4d5e6f7089
                        io_failure = 0x1
                (end "ereport.fs.zfs.io")
`
	blkChecksum = `Aug 11 2025 14:02:41.112233445 ereport.fs.zfs.checksum
        class = "ereport.fs.zfs.checksum"
        detector = (embedded nvlist)
                (start "ereport.fs.zfs.checksum")
                        version = 0x0
                        class = "ereport.fs.zfs.checksum"
                        pool = "tank"
                        vdev = "nvme0n1p2"
                        cksum_algorithm = "fletcher4"
                        cksum_expected = 0x1122
                        cksum_actual = 0x3344
                (end "ereport.fs.zfs.checksum")
`
	blkResilverFinish = `Aug 11 2025 15:10:02.998877665 sysevent.fs.zfs.resilver_finish
        class = "sysevent.fs.zfs.resilver_finish"
        pool = "ssd"
        pool_guid = 0xaaaabbbbccccdddd
        pool_state = 0x0
        pool_context = 0x1
`
	blkScrubFinish = `Aug 11 2025 02:00:41.556677889 sysevent.fs.zfs.scrub_finish
        class = "sysevent.fs.zfs.scrub_finish"
        pool = "tank"
        pool_guid = 0x91a2b3c4d5e6f708
        errors = 3
`
	blkStatechange = `Aug 11 2025 16:44:00.123456789 sysevent.fs.zfs.vdev_statechange
        class = "sysevent.fs.zfs.vdev_statechange"
        pool = "tank"
        vdev = "/dev/sdc1"
        vdev_state = "FAULTED"
`
	blkConfigSync = `Aug 11 2025 17:00:00.111111111 sysevent.fs.zfs.config_sync
        class = "sysevent.fs.zfs.config_sync"
        pool = "tank"
`
)

func TestParseEventBlock(t *testing.T) {
	ev := parseEventBlock(blkIOError)
	if ev["class"] != "ereport.fs.zfs.io" {
		t.Errorf("class=%q", ev["class"])
	}
	if ev["pool"] != "tank" || ev["vdev"] != "sdb1" {
		t.Errorf("pool=%q vdev=%q", ev["pool"], ev["vdev"])
	}
	ev = parseEventBlock(blkStatechange)
	if ev["vdev_state"] != "FAULTED" || ev["vdev"] != "/dev/sdc1" {
		t.Errorf("vdev=%q state=%q", ev["vdev"], ev["vdev_state"])
	}
}

func TestDevShort(t *testing.T) {
	cases := map[string]string{
		"/dev/sdb1": "sdb", "sdc1": "sdc", "nvme0n1p2": "nvme0n1",
		"ata-WDC_WD40-part3": "ata-WDC_WD40", "mmcblk0p1": "mmcblk0",
		"8ab95469-uuid": "8ab95469-uuid",
	}
	for in, want := range cases {
		if got := devShort(in); got != want {
			t.Errorf("devShort(%q)=%q, esperaba %q", in, got, want)
		}
	}
}

func TestScanEventsSplit(t *testing.T) {
	in := blkIOError + "\n" + blkConfigSync
	var blocks []string
	scanEvents(strings.NewReader(in), func(b string) { blocks = append(blocks, b) })
	if len(blocks) != 2 {
		t.Fatalf("bloques=%d, esperaba 2", len(blocks))
	}
	if !strings.Contains(blocks[0], "ereport.fs.zfs.io") || !strings.Contains(blocks[1], "config_sync") {
		t.Errorf("bloques inesperados: %q | %q", blocks[0], blocks[1])
	}
}

// setupEventsAlerter — Alerter real sobre SQLite en memoria para inspeccionar
// las alertas generadas por dispatch.
func setupEventsAlerter(t *testing.T) (*EventsCollector, *alerts.Alerter, context.Context) {
	t.Helper()
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	if err := db.Migrate(context.Background(), d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	st, err := settings.NewStore(d)
	if err != nil {
		t.Fatalf("settings: %v", err)
	}
	al := alerts.New(d, hub.NewHub(), st)
	return NewEventsCollector(al), al, context.Background()
}

func dispatchBlock(c *EventsCollector, ctx context.Context, blk string) {
	c.dispatch(ctx, parseEventBlock(blk))
}

func TestDispatchAlerts(t *testing.T) {
	c, al, ctx := setupEventsAlerter(t)
	dispatchBlock(c, ctx, blkIOError)
	dispatchBlock(c, ctx, blkChecksum)
	dispatchBlock(c, ctx, blkResilverFinish)
	dispatchBlock(c, ctx, blkScrubFinish)
	dispatchBlock(c, ctx, blkStatechange)
	dispatchBlock(c, ctx, blkConfigSync) // ruido: sin alerta

	// El dedupe puede tardar nada; las inserciones son síncronas.
	list, err := al.List(ctx, 50)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	byLevel := map[string]int{}
	var ioAlert, cksAlert, resAlert, scrubAlert, stAlert string
	for _, a := range list {
		byLevel[a.Level]++
		switch {
		case strings.Contains(a.Source, "ereport.fs.zfs.io"):
			ioAlert = a.Target
		case strings.Contains(a.Source, "checksum"):
			cksAlert = a.Target
		case strings.Contains(a.Source, "resilver_finish"):
			resAlert = a.Target
			if a.Level != "info" {
				t.Errorf("resilver_finish level=%s, esperaba info", a.Level)
			}
		case strings.Contains(a.Source, "scrub_finish"):
			scrubAlert = a.Target
			if a.Level != "warn" {
				t.Errorf("scrub_finish con errores level=%s, esperaba warn", a.Level)
			}
		case strings.Contains(a.Source, "vdev_statechange"):
			stAlert = a.Target
			if a.Level != "crit" {
				t.Errorf("vdev_statechange level=%s, esperaba crit", a.Level)
			}
		}
	}
	if ioAlert != "disks:sdb" {
		t.Errorf("io target=%q, esperaba disks:sdb", ioAlert)
	}
	if cksAlert != "disks:nvme0n1" {
		t.Errorf("checksum target=%q, esperaba disks:nvme0n1", cksAlert)
	}
	if resAlert != "pools:ssd" {
		t.Errorf("resilver target=%q, esperaba pools:ssd", resAlert)
	}
	if scrubAlert != "pools:tank" {
		t.Errorf("scrub target=%q, esperaba pools:tank", scrubAlert)
	}
	if stAlert != "disks:sdc" {
		t.Errorf("statechange target=%q, esperaba disks:sdc", stAlert)
	}
	if byLevel["crit"] != 3 || byLevel["warn"] != 1 || byLevel["info"] != 1 {
		t.Errorf("niveles=%v (esperaba crit=3 warn=1 info=1; config_sync no alerta)", byLevel)
	}
}

func TestDispatchScrubFinishSinErrores(t *testing.T) {
	c, al, ctx := setupEventsAlerter(t)
	dispatchBlock(c, ctx, blkScrubFinish)
	list, _ := al.List(ctx, 50)
	if len(list) != 1 {
		t.Fatalf("alertas=%d, esperaba 1", len(list))
	}
	// Reenviar el mismo evento: dedupe por source+message (sin repetidos).
	dispatchBlock(c, ctx, blkScrubFinish)
	list, _ = al.List(ctx, 50)
	if len(list) != 1 {
		t.Fatalf("tras reenvío alertas=%d, esperaba 1 (dedupe)", len(list))
	}
	// scrub_finish con 0 errores: sin alerta (el éxito no es noticia).
	c2, al2, ctx2 := setupEventsAlerter(t)
	c2.dispatch(ctx2, map[string]string{"class": "sysevent.fs.zfs.scrub_finish", "pool": "tank", "errors": "0"})
	list2, _ := al2.List(ctx2, 50)
	if len(list2) != 0 {
		t.Fatalf("scrub sin errores generó %d alertas, esperaba 0", len(list2))
	}
}
