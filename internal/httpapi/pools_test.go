// pools_test.go — normalización de nombres de dispositivo y cruce disco↔pool.
package httpapi

import "testing"

func TestStripPart(t *testing.T) {
	cases := map[string]string{
		"sda":                                  "sda",
		"sda1":                                 "sda",
		"sdb9":                                 "sdb",
		"nvme0n1":                              "nvme0n1", // disco entero: NO perder el 1
		"nvme0n1p3":                            "nvme0n1",
		"nvme1n1":                              "nvme1n1",
		"mmcblk0":                              "mmcblk0",
		"mmcblk0p1":                            "mmcblk0",
		"loop0p1":                              "loop0",
		"nvme-eui.002538839107fd40-part3":      "nvme-eui.002538839107fd40-part3",
		"11111111-2222-3333-4444-555555555555": "11111111-2222-3333-4444-555555555555",
	}
	for in, want := range cases {
		if got := stripPart(in); got != want {
			t.Errorf("stripPart(%q)=%q, esperaba %q", in, got, want)
		}
	}
}

func TestPoolForDisk(t *testing.T) {
	pools := []string{"bigtank", "rpool"}
	vdevs := map[string][]string{
		"bigtank": {"11111111-2222-3333-4444-555555555555", "/dev/sda1", "/dev/sdb1"},
		"rpool":   {"nvme-eui.002538839107fd40-part3", "/dev/nvme0n1p3"},
	}
	cases := map[string]string{
		"sda":     "bigtank",
		"sdb":     "bigtank",
		"nvme0n1": "rpool",
		"nvme1n1": "",
		"sdd":     "",
	}
	for dev, want := range cases {
		if got := poolForDisk(pools, vdevs, dev); got != want {
			t.Errorf("poolForDisk(%q)=%q, esperaba %q", dev, got, want)
		}
	}
}
