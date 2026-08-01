package collectors

import "testing"

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
