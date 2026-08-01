// zpool_test.go — parseo de status y resolución de vdevs UUID→dispositivo.
package collectors

import (
	"context"
	"strings"
	"testing"

	"easyzfs/internal/model"
)

func TestParseStatusJSONVdevs(t *testing.T) {
	out := []byte(`{"pools":{"tank":{"name":"tank","state":"DEGRADED","vdevs":{
		"tank":{"name":"tank","vdev_type":"root","state":"DEGRADED","vdevs":{
			"raidz1-0":{"name":"raidz1-0","vdev_type":"raidz1","state":"DEGRADED","vdevs":{
				"sdb1":{"name":"sdb1","vdev_type":"disk","state":"ONLINE"},
				"8ab95469-2ae7-411a-af39-47b1d4f39d3c":{"name":"8ab95469-2ae7-411a-af39-47b1d4f39d3c","vdev_type":"disk","state":"FAULTED"}
			}}
		}}
	}}}}`)
	p := &model.Pool{Name: "tank", Vdevs: []model.Vdev{}}
	c := &ZpoolCollector{}
	if !c.parseStatusJSON(out, p) {
		t.Fatal("parseStatusJSON devolvió false")
	}
	if len(p.Vdevs) != 2 {
		t.Fatalf("vdevs=%d, esperaba 2", len(p.Vdevs))
	}
	if p.Topo != "raidz1" {
		t.Fatalf("topo=%q, esperaba raidz1", p.Topo)
	}
	if p.Status != "DEGRADED" {
		t.Fatalf("status=%q, esperaba DEGRADED", p.Status)
	}
}

func TestResolveVdevPaths(t *testing.T) {
	c := &ZpoolCollector{}
	p := &model.Pool{Name: "tank", Vdevs: []model.Vdev{
		{Dev: "sdb1", Status: "ONLINE"},
		{Dev: "nvme0n1p2", Status: "ONLINE"},
		{Dev: "8ab95469-2ae7-411a-af39-47b1d4f39d3c", Status: "FAULTED"},
		{Dev: "nvme-ORICO_FAKE_123", Status: "ONLINE"},
	}}
	c.resolveVdevPaths(context.Background(), p)
	for _, v := range p.Vdevs {
		// Path es "" (no existe en este equipo) o una ruta real bajo /dev;
		// nunca una ruta inventada con el nombre crudo (uuid / by-id).
		if v.Path == "" {
			continue
		}
		if !strings.HasPrefix(v.Path, "/dev/") {
			t.Fatalf("path inesperado %q para %q", v.Path, v.Dev)
		}
		if strings.Contains(v.Path, "ORICO_FAKE") || reUUID.MatchString(v.Path[5:]) {
			t.Fatalf("path sin resolver: %q", v.Path)
		}
	}
}

func TestReUUID(t *testing.T) {
	if !reUUID.MatchString("8ab95469-2ae7-411a-af39-47b1d4f39d3c") {
		t.Fatal("UUID no reconocido")
	}
	for _, no := range []string{"sdb1", "ata-ST12000-part1", "gptid/abcd"} {
		if reUUID.MatchString(no) {
			t.Fatalf("falso positivo UUID: %q", no)
		}
	}
}
