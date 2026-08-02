// perf_test.go — parsers de /proc arcstats, (z)arc_summary, zpool iostat y
// zpool history.
package collectors

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestParseArcstats(t *testing.T) {
	// Recorte realista de /proc/spl/kstat/zfs/arcstats (name type data)
	content := `name                            type data
hits                            4    9000
iohits                          4    100
misses                          4    1000
demand_data_hits                4    8000
demand_data_misses              4    900
demand_metadata_hits            4    900
demand_metadata_misses          4    90
prefetch_data_hits              4    100
prefetch_data_misses            4    10
prefetch_metadata_hits          4    0
prefetch_metadata_misses        4    0
mru_hits                        4    5000
mru_ghost_hits                  4    100
mfu_hits                        4    4000
mfu_ghost_hits                  4    50
deleted                         4    100
mutex_miss                      4    0
access_skip                     4    0
evict_skip                      4    0
evict_not_enough                4    0
evict_l2_cached                 4    0
evict_l2_eligible               4    1024
evict_l2_eligible_mfu           4    512
evict_l2_eligible_mru           4    512
evict_l2_ineligible             4    0
evict_l2_skip                   4    0
hash_elements                   4    1000
hash_elements_max               4    2000
hash_collisions                 4    0
hash_chains                     4    0
hash_chain_max                  4    0
p                               4    512
c                               4    4294967296
c_min                           4    33554432
c_max                           4    4294967296
size                            4    4089446400
compressed_size                 4    2000000000
uncompressed_size               4    3000000000
overhead_size                   4    100000000
hdr_size                        4    50000000
data_size                       4    3900000000
metadata_size                   4    100000000
`
	st, ok := parseArcstats(content)
	if !ok {
		t.Fatal("parseArcstats no reconoció el contenido")
	}
	if st.SizeBytes != 4089446400 {
		t.Errorf("size = %d, esperaba 4089446400", st.SizeBytes)
	}
	wantPct := 90.0 // 9000 hits / (9000+1000)
	if st.HitPct != wantPct {
		t.Errorf("hit%% = %v, esperaba %v", st.HitPct, wantPct)
	}
}

func TestParseArcstatsIncompleto(t *testing.T) {
	if _, ok := parseArcstats("hits 4 1\n"); ok {
		t.Error("parseArcstats con campos faltantes debería devolver ok=false")
	}
	if _, ok := parseArcstats(""); ok {
		t.Error("parseArcstats vacío debería devolver ok=false")
	}
}

func TestParseArcSummary(t *testing.T) {
	out := `------------------------------------------------------------------------
ZFS Subsystem Report                            Sat Aug 01 06:00:00 2026
Linux 6.9.0                                                  2.4.0-1
ARC size (current):                                    25.4 %    3.80 GiB
    Target size (adaptive):                           100.0 %   15.00 GiB
ARC hit ratio:                                         92.6 %   1.2k
`
	st, ok := parseArcSummary(out)
	if !ok {
		t.Fatal("parseArcSummary no reconoció el texto")
	}
	want := uint64(4080218931) // 3.80 GiB
	if st.SizeBytes != want {
		t.Errorf("size = %d, esperaba %d", st.SizeBytes, want)
	}
	if st.HitPct != 92.6 {
		t.Errorf("hit%% = %v, esperaba 92.6", st.HitPct)
	}
}

func TestParseIostat(t *testing.T) {
	// 'zpool iostat -Hpy 1 1': name alloc free r_ops w_ops r_bw w_bw (bytes)
	out := `tank 6604825600000 13194139533312 12 34 43253760 13421772
ssd 450971566080 1748134858752 210 96 230686720 101187584
`
	pools := parseIostat(out)
	if len(pools) != 2 {
		t.Fatalf("pools = %d, esperaba 2 (%v)", len(pools), pools)
	}
	if pools[0].Name != "tank" || pools[0].ReadBps != 43253760 || pools[0].WriteBps != 13421772 {
		t.Errorf("tank = %+v", pools[0])
	}
	if pools[1].Name != "ssd" || pools[1].ReadBps != 230686720 || pools[1].WriteBps != 101187584 {
		t.Errorf("ssd = %+v", pools[1])
	}
	if got := parseIostat(""); len(got) != 0 {
		t.Errorf("vacío: %+v", got)
	}
}

func TestParseHistory(t *testing.T) {
	out := `History for 'tank':
2026-07-01.03:12:05 zpool create tank raidz sdb sdc sdd (2.10s)
2026-07-22.09:41:18 zpool checkpoint tank (0.61s)
2026-07-29.06:00:00 zfs set compression=zstd tank/backups (0.04s)
2026-07-30.06:00:01 zpool scrub tank (14250.80s)
2026-08-01.06:00:02 zfs snapshot -r tank@easyzfs-auto-20260801-0600
... 12 earlier entries ...
`
	entries := parseHistory(out)
	if len(entries) != 5 {
		t.Fatalf("entradas = %d, esperaba 5 (%v)", len(entries), entries)
	}
	first := entries[0]
	if first.Command != "zpool create tank raidz sdb sdc sdd" || first.DurationSec != 2.10 {
		t.Errorf("primera = %+v", first)
	}
	// zpool history imprime en hora local; el parser convierte a UTC.
	lt := first.Ts.In(time.Local)
	if lt.Year() != 2026 || lt.Month() != 7 || lt.Day() != 1 || lt.Hour() != 3 {
		t.Errorf("ts = %v", first.Ts)
	}
	last := entries[len(entries)-1]
	if last.DurationSec != 0 || last.Command != "zfs snapshot -r tank@easyzfs-auto-20260801-0600" {
		t.Errorf("última (sin duración) = %+v", last)
	}
	if entries[3].DurationSec != 14250.80 {
		t.Errorf("duración scrub = %v", entries[3].DurationSec)
	}
}

// Regresión 2-Ago-2026: 'zpool history -i' de un pool grande (TheZBox:
// 2,7 M líneas / 275 MB) disparaba OOM al parsear en memoria. El parser
// streaming debe recortar a historyKeep sin importar el tamaño de entrada.
func TestParseHistoryStreamGrande(t *testing.T) {
	var sb strings.Builder
	for i := 0; i < 300000; i++ {
		fmt.Fprintf(&sb, "2026-07-01.03:%02d:%02d zpool scrub tank (10.0s)\n", i/60%60, i%60)
	}
	sb.WriteString("2026-08-02.22:00:00 zfs snapshot tank@final\n")
	entries := parseHistoryStream(strings.NewReader(sb.String()))
	if len(entries) != historyKeep {
		t.Fatalf("entradas = %d, esperaba historyKeep=%d", len(entries), historyKeep)
	}
	last := entries[len(entries)-1]
	if last.Command != "zfs snapshot tank@final" {
		t.Errorf("última = %+v (debía ser la más reciente del stream)", last)
	}
	// Orden cronológico conservado tras el ring.
	for i := 1; i < len(entries); i++ {
		if entries[i].Ts.Before(entries[i-1].Ts) {
			t.Fatalf("orden roto en %d: %v < %v", i, entries[i].Ts, entries[i-1].Ts)
		}
	}
}
