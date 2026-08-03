package collectors

import (
	"os"
	"strings"
	"testing"

	"easyzfs/internal/model"
)

// Caso real reportado: la lista cruda de lsblk incluía zd0 (zvol) y
// mmcblk0boot0/boot1 (particiones hardware eMMC), que no deben mostrarse.
func TestIsPhysicalDisk(t *testing.T) {
	yes := []string{
		"sda", "sdaa", "hdb", "vda", "xvdc",
		"nvme0n1", "nvme1n1", "nvme2n1", "nvme3n1",
		"mmcblk0", "mmcblk1",
	}
	no := []string{
		"zd0", "zd16", // zvols ZFS
		"loop0", "loop7", "ram0", "dm-0", "dm-1", "sr0", "fd0",
		"mmcblk0boot0", "mmcblk0boot1", "mmcblk0rpmb", // particiones hardware eMMC
		"sda1", "nvme0n1p1", "mmcblk0p1", // particiones (lsblk type=part, doble seguro)
		"", "md0", "nbd0", "zram0",
	}
	for _, n := range yes {
		if !isPhysicalDisk(n) {
			t.Errorf("%s debería ser disco físico", n)
		}
	}
	for _, n := range no {
		if isPhysicalDisk(n) {
			t.Errorf("%s NO debería ser disco físico", n)
		}
	}
}

// Regresión del bug "disco muriendo aparece como SMART no disponible":
// smartctl sale con exit 192 (self-test log con errores) pero emite JSON
// válido; antes se descartaba la salida y el disco quedaba "unknown".
// Fixture = salida real de /dev/sdb (ZJV3K043, 2528 realloc + 184 pending)
// de citadel-01 el 3-Ago-2026.
func TestParseSmartJSON_DiscoMuriendoExit192(t *testing.T) {
	out, err := os.ReadFile("testdata/smart_sdb_exit192.json")
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	d := model.Disk{Dev: "sdb", Smart: "unknown", SmartDetail: "no disponible"}
	if err := parseSmartJSON(out, &d); err != nil {
		t.Fatalf("parseSmartJSON: %v", err)
	}
	if d.Smart != "warn" {
		t.Errorf("Smart = %q, esperado warn", d.Smart)
	}
	if d.ReallocSectors != 2528 || d.PendingSectors != 184 || d.OfflineUncorr != 184 {
		t.Errorf("contadores = realloc:%d pending:%d offunc:%d, esperados 2528/184/184",
			d.ReallocSectors, d.PendingSectors, d.OfflineUncorr)
	}
	if d.Hours == 0 {
		t.Errorf("horas de uso no parseadas")
	}
}

// Tormenta de link SATA (caso real sdc ZJV47B0J: >1,1M UDMA CRC): el disco
// tiene pocos realloc pero el CRC disparado debe elevar a warn.
func TestParseSmartJSON_TormentaCRC(t *testing.T) {
	out := []byte(`{
		"model_name": "ST12000NM0127", "serial_number": "ZJV47B0J",
		"smart_status": {"passed": true},
		"power_on_time": {"hours": 9194},
		"ata_smart_attributes": {"table": [
			{"name": "Reallocated_Sector_Ct", "raw": {"value": 48}},
			{"name": "Current_Pending_Sector", "raw": {"value": 0}},
			{"name": "Offline_Uncorrectable", "raw": {"value": 0}},
			{"name": "UDMA_CRC_Error_Count", "raw": {"value": 1184752}}
		]}
	}`)
	d := model.Disk{Dev: "sdc", Smart: "unknown", SmartDetail: "no disponible"}
	if err := parseSmartJSON(out, &d); err != nil {
		t.Fatalf("parseSmartJSON: %v", err)
	}
	if d.Smart != "warn" {
		t.Errorf("Smart = %q, esperado warn", d.Smart)
	}
	if d.CrcErrors != 1184752 {
		t.Errorf("CrcErrors = %d, esperado 1184752", d.CrcErrors)
	}
	if !strings.Contains(d.SmartDetail, "crc=") {
		t.Errorf("SmartDetail %q sin detalle crc", d.SmartDetail)
	}
}

// Disco sano con un CRC histórico suelto: no debe avisar por CRC.
func TestParseSmartJSON_SanoConCRCHistorico(t *testing.T) {
	out := []byte(`{
		"model_name": "ST12000NM0127", "serial_number": "ZJV28A7R",
		"smart_status": {"passed": true},
		"power_on_time": {"hours": 9519},
		"ata_smart_attributes": {"table": [
			{"name": "Reallocated_Sector_Ct", "raw": {"value": 0}},
			{"name": "Current_Pending_Sector", "raw": {"value": 0}},
			{"name": "Offline_Uncorrectable", "raw": {"value": 0}},
			{"name": "UDMA_CRC_Error_Count", "raw": {"value": 3}}
		]}
	}`)
	d := model.Disk{Dev: "sdd", Smart: "unknown", SmartDetail: "no disponible"}
	if err := parseSmartJSON(out, &d); err != nil {
		t.Fatalf("parseSmartJSON: %v", err)
	}
	if d.Smart != "ok" {
		t.Errorf("Smart = %q, esperado ok", d.Smart)
	}
}
