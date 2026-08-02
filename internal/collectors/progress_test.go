// progress_test.go — progreso de scans (scrub/resilver/trim): JSON y texto.
package collectors

import (
	"testing"

	"easyzfs/internal/model"
)

// Salida real de ejemplo: 'zpool status' con scrub al 45% (OpenZFS 2.2).
const statusScrub45 = `  pool: tank
 state: ONLINE
  scan: scrub in progress since Tue Aug 12 02:00:00 2025
	3.61T scanned at 150M/s, 8.02T issued at 200M/s, 8.02T total
	0B repaired, 45.01% done, 04:12:33 to go
config:

	NAME        STATE     READ WRITE CKSUM
	tank        ONLINE       0     0     0
	  raidz1-0  ONLINE       0     0     0
	    sdb1    ONLINE       0     0     0
	    sdc1    ONLINE       0     0     0
	    sdd1    ONLINE       0     0     0

errors: No known data errors
`

// Resilver al 12% (líneas separadas del 'scan:').
const statusResilver12 = `  pool: ssd
 state: DEGRADED
  scan: resilver in progress since Tue Aug 12 10:00:00 2025
	120G scanned at 1.2G/s
	115G issued at 1.1G/s
	12.30% done, 00:25:10 to go
config:

	NAME          STATE     READ WRITE CKSUM
	ssd           DEGRADED     0     0     0
	  mirror-0    DEGRADED     0     0     0
	    nvme0n1   ONLINE       0     0     0
	    replacing-1 DEGRADED   0     0     0
	      old     UNAVAIL      0     0     0
	      nvme1n1 ONLINE       0     0     0

errors: No known data errors
`

// 'zpool status -t' con trim en curso (OpenZFS 2.2/2.3).
const statusTrimRunning = `  pool: ssd
 state: ONLINE
  scan: trim in progress since Tue Aug 12 03:00:00 2025
	452G trimmed at 90M/s, 61.5% done, 00:06:40 to go
config:

	NAME        STATE     READ WRITE CKSUM  TRIM
	ssd         ONLINE       0     0     0  trimming
	  nvme0n1   ONLINE       0     0     0  trimming

errors: No known data errors
`

// Trim completado sin errores.
const statusTrimDone = `  pool: ssd
 state: ONLINE
  scan: trimmed 850G in 0 days 00:15:20 with 0 errors on Tue Aug 12 03:15:20 2025
config:

	NAME        STATE     READ WRITE CKSUM  TRIM
	ssd         ONLINE       0     0     0  un trimmed
	  nvme0n1   ONLINE       0     0     0  trimmed

errors: No known data errors
`

func TestParseStatusTextScrub45(t *testing.T) {
	c := &ZpoolCollector{}
	p := &model.Pool{Name: "tank", Vdevs: []model.Vdev{}}
	c.parseStatusText(statusScrub45, p)
	s := p.Scrub
	if s.State != "running" || s.Kind != "scrub" {
		t.Fatalf("state=%q kind=%q, esperaba running/scrub", s.State, s.Kind)
	}
	if s.Pct < 44.9 || s.Pct > 45.1 {
		t.Errorf("pct=%v, esperaba ~45", s.Pct)
	}
	if s.EtaSec != 4*3600+12*60+33 {
		t.Errorf("eta=%d, esperaba %d", s.EtaSec, 4*3600+12*60+33)
	}
	if s.BytesDone == 0 || s.BytesTotal == 0 {
		t.Errorf("bytes done=%d total=%d, esperaba >0 (scanned/issued)", s.BytesDone, s.BytesTotal)
	}
}

func TestParseStatusTextResilver12(t *testing.T) {
	c := &ZpoolCollector{}
	p := &model.Pool{Name: "ssd", Vdevs: []model.Vdev{}}
	c.parseStatusText(statusResilver12, p)
	s := p.Scrub
	if s.State != "running" || s.Kind != "resilver" {
		t.Fatalf("state=%q kind=%q, esperaba running/resilver", s.State, s.Kind)
	}
	if s.Pct < 12.2 || s.Pct > 12.4 {
		t.Errorf("pct=%v, esperaba ~12.3", s.Pct)
	}
	if s.EtaSec != 25*60+10 {
		t.Errorf("eta=%d, esperaba %d", s.EtaSec, 25*60+10)
	}
}

func TestParseTrimStatusRunning(t *testing.T) {
	c := &ZpoolCollector{}
	p := &model.Pool{Name: "ssd"}
	c.parseTrimStatus(statusTrimRunning, p)
	s := p.Scrub
	if s.State != "running" || s.Kind != "trim" {
		t.Fatalf("state=%q kind=%q, esperaba running/trim", s.State, s.Kind)
	}
	if s.Pct < 61.4 || s.Pct > 61.6 {
		t.Errorf("pct=%v, esperaba ~61.5", s.Pct)
	}
	if s.EtaSec != 6*60+40 {
		t.Errorf("eta=%d, esperaba %d", s.EtaSec, 6*60+40)
	}
	if s.BytesDone == 0 {
		t.Errorf("bytes_done=0, esperaba ~452G (trimmed)")
	}
}

func TestParseTrimStatusDone(t *testing.T) {
	c := &ZpoolCollector{}
	p := &model.Pool{Name: "ssd"}
	c.parseTrimStatus(statusTrimDone, p)
	s := p.Scrub
	if s.State != "done" || s.Kind != "trim" || s.Pct != 100 {
		t.Fatalf("state=%q kind=%q pct=%v, esperaba done/trim/100", s.State, s.Kind, s.Pct)
	}
	if s.Errors != 0 {
		t.Errorf("errors=%d, esperaba 0", s.Errors)
	}
	if got := s.Ts.Format("2006-01-02"); got != "2025-08-12" {
		t.Errorf("ts=%q, esperaba 2025-08-12", got)
	}
}

// Un scrub/resilver en curso no se pisa con el trim simultáneo.
func TestParseTrimNoPisaScrub(t *testing.T) {
	c := &ZpoolCollector{}
	p := &model.Pool{Name: "ssd", Scrub: model.ScrubInfo{State: "running", Kind: "scrub", Pct: 30}}
	c.parseTrimStatus(statusTrimRunning, p)
	if p.Scrub.Kind != "scrub" || p.Scrub.Pct != 30 {
		t.Errorf("kind=%q pct=%v: el trim pisó el scrub en curso", p.Scrub.Kind, p.Scrub.Pct)
	}
}

// JSON con scan_stats rellena bytes (examined/to_examine).
func TestParseStatusJSONScanBytes(t *testing.T) {
	out := []byte(`{"pools":{"tank":{"name":"tank","state":"ONLINE","vdevs":{},
		"scan_stats":{"function":"SCRUB","state":"DSS_SCANNING","percentage":45.0,
			"to_examine":"8.02T","examined":"3.61T","pass_start":1754964000,
			"total_secs_left":"15153","errors":"0"}}}}`)
	c := &ZpoolCollector{}
	p := &model.Pool{Name: "tank"}
	if !c.parseStatusJSON(out, p) {
		t.Fatal("parseStatusJSON devolvió false")
	}
	s := p.Scrub
	if s.State != "running" || s.Pct != 45 {
		t.Fatalf("state=%q pct=%v", s.State, s.Pct)
	}
	if s.BytesDone == 0 || s.BytesTotal == 0 || s.BytesDone >= s.BytesTotal {
		t.Errorf("bytes done=%d total=%d", s.BytesDone, s.BytesTotal)
	}
	if s.EtaSec != 15153 {
		t.Errorf("eta=%d, esperaba 15153", s.EtaSec)
	}
}

// Salida de 'zpool status' con RAID-Z expansion en curso (OpenZFS 2.3):
// la línea 'scan:' anuncia la expansión y la siguiente trae % y ETA.
const statusExpandRunning = `  pool: tank
 state: ONLINE
  scan: raidz expansion in progress since Tue Aug 12 02:00:00 2025
	2.40T copied at 180M/s, 45.67% done, 01:12:33 to go
config:

	NAME        STATE     READ WRITE CKSUM
	tank        ONLINE       0     0     0
	  raidz2-0  ONLINE       0     0     0
	    sdb     ONLINE       0     0     0
	    sdc     ONLINE       0     0     0
	    sdd     ONLINE       0     0     0
	    sde     ONLINE       0     0     0
	    sdf     ONLINE       0     0     0

errors: No known data errors
`

func TestParseStatusTextExpandRunning(t *testing.T) {
	c := &ZpoolCollector{}
	p := &model.Pool{Name: "tank", Vdevs: []model.Vdev{}}
	c.parseStatusText(statusExpandRunning, p)
	s := p.Scrub
	if s.State != "running" || s.Kind != "expand" {
		t.Fatalf("state=%q kind=%q, esperaba running/expand", s.State, s.Kind)
	}
	if s.Pct < 45.6 || s.Pct > 45.7 {
		t.Errorf("pct=%v, esperaba ~45.67", s.Pct)
	}
	if s.EtaSec != 3600+12*60+33 {
		t.Errorf("eta=%d, esperaba %d", s.EtaSec, 3600+12*60+33)
	}
	if s.BytesDone == 0 {
		t.Errorf("bytes_done=0, esperaba >0 (copied)")
	}
	if len(p.RaidzVdevs) != 1 || p.RaidzVdevs[0] != "raidz2-0" {
		t.Errorf("raidz_vdevs=%v, esperaba [raidz2-0]", p.RaidzVdevs)
	}
}

// Fixture JSON de expansión: scan_stats.function RAIDZ_EXPAND (OpenZFS ≥ 2.3).
const statusJSONExpand = `{
  "output_version": {"command": "zpool status", "vers_major": 0, "vers_minor": 1},
  "pools": {
    "tank": {
      "name": "tank",
      "state": "ONLINE",
      "vdevs": {
        "tank": {
          "name": "tank", "vdev_type": "root", "state": "ONLINE",
          "vdevs": {
            "raidz2-0": {
              "name": "raidz2-0", "vdev_type": "raidz", "state": "ONLINE",
              "vdevs": {
                "sdb": {"name": "sdb", "vdev_type": "disk", "state": "ONLINE"},
                "sdc": {"name": "sdc", "vdev_type": "disk", "state": "ONLINE"},
                "sdd": {"name": "sdd", "vdev_type": "disk", "state": "ONLINE"}
              }
            }
          }
        }
      },
      "scan_stats": {
        "function": "RAIDZ_EXPAND",
        "state": "DSS_SCANNING",
        "percentage": 33.25,
        "total_secs_left": 1800,
        "errors": 0
      }
    }
  }
}`

func TestParseStatusJSONExpand(t *testing.T) {
	c := &ZpoolCollector{}
	p := &model.Pool{Name: "tank", Vdevs: []model.Vdev{}}
	if !c.parseStatusJSON([]byte(statusJSONExpand), p) {
		t.Fatal("parseStatusJSON devolvió false")
	}
	s := p.Scrub
	if s.State != "running" || s.Kind != "expand" {
		t.Fatalf("state=%q kind=%q, esperaba running/expand", s.State, s.Kind)
	}
	if s.Pct < 33.2 || s.Pct > 33.3 {
		t.Errorf("pct=%v, esperaba ~33.25", s.Pct)
	}
	if s.EtaSec != 1800 {
		t.Errorf("eta=%d, esperaba 1800", s.EtaSec)
	}
	if len(p.RaidzVdevs) != 1 || p.RaidzVdevs[0] != "raidz2-0" {
		t.Errorf("raidz_vdevs=%v, esperaba [raidz2-0]", p.RaidzVdevs)
	}
}
