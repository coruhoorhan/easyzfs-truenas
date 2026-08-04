package veeam

import (
	"testing"
)

func TestBuildChains_healthy(t *testing.T) {
	files := []*File{
		{Name: "SRV.vm-1001D2026-07-17T135245_1.vbk", Type: "VBK", DateStr: "2026-07-17", TimeStr: "13:52:45"},
		{Name: "SRV.vm-1001D2026-07-18T183100_2.vib", Type: "VIB", DateStr: "2026-07-18", TimeStr: "18:31:00"},
		{Name: "SRV.vm-1001D2026-07-19T183100_3.vib", Type: "VIB", DateStr: "2026-07-19", TimeStr: "18:31:00"},
		{Name: "SRV.vm-1001D2026-07-25T100000_4.vbk", Type: "VBK", DateStr: "2026-07-25", TimeStr: "10:00:00"},
	}
	chains := BuildChains(files)
	if len(chains) != 2 {
		t.Fatalf("esperadas 2 cadenas, got %d", len(chains))
	}
	if chains[0].IsBroken || chains[0].VBK == nil {
		t.Fatalf("cadena 1 debería ser sana con VBK")
	}
	if len(chains[0].VIBs) != 2 {
		t.Fatalf("cadena 1 debería tener 2 VIB, got %d", len(chains[0].VIBs))
	}
	if chains[1].IsBroken || len(chains[1].VIBs) != 0 {
		t.Fatalf("cadena 2 debería ser sana sin VIB")
	}
}

func TestBuildChains_broken(t *testing.T) {
	// VIB antes de cualquier VBK → cadena rota (falta el archivo completo).
	files := []*File{
		{Name: "SRV.vm-1001D2026-07-18T183100_1.vib", Type: "VIB", DateStr: "2026-07-18", TimeStr: "18:31:00"},
		{Name: "SRV.vm-1001D2026-07-19T183100_2.vib", Type: "VIB", DateStr: "2026-07-19", TimeStr: "18:31:00"},
		{Name: "SRV.vm-1001D2026-07-20T100000_3.vbk", Type: "VBK", DateStr: "2026-07-20", TimeStr: "10:00:00"},
		{Name: "SRV.vm-1001D2026-07-21T183100_4.vib", Type: "VIB", DateStr: "2026-07-21", TimeStr: "18:31:00"},
	}
	chains := BuildChains(files)
	if len(chains) != 2 {
		t.Fatalf("esperadas 2 cadenas, got %d", len(chains))
	}
	if !chains[0].IsBroken || chains[0].VBK != nil {
		t.Fatalf("cadena 1 debería estar rota sin VBK")
	}
	if len(chains[0].VIBs) != 2 {
		t.Fatalf("cadena rota debería acumular los VIB huérfanos, got %d", len(chains[0].VIBs))
	}
	if chains[1].IsBroken || len(chains[1].VIBs) != 1 {
		t.Fatalf("cadena 2 debería ser sana con 1 VIB")
	}
}

func TestBrokenChains(t *testing.T) {
	res := &Result{Machines: []*Machine{
		{Name: "A", Chains: []*Chain{{VBK: &File{}, VIBs: []*File{}}}},
		{Name: "B", Chains: []*Chain{{VBK: nil, VIBs: []*File{{}}, IsBroken: true}}},
	}}
	broken := BrokenChains(res)
	if len(broken) != 1 || broken[0].Machine != "B" || broken[0].Chain != 1 {
		t.Fatalf("esperada 1 cadena rota (B, cadena 1), got %+v", broken)
	}
}

func TestChainGap(t *testing.T) {
	// VIBs diarios consecutivos → sin hueco.
	ok := &Chain{VBK: &File{DateStr: "2026-07-17"},
		VIBs: []*File{{DateStr: "2026-07-18"}, {DateStr: "2026-07-19"}}}
	hasGap, maxGap := chainGap(ok)
	if hasGap || maxGap != 0 {
		t.Fatalf("cadena diaria no debería tener hueco, got hasGap=%v maxGap=%d", hasGap, maxGap)
	}
	// VBK→primer VIB separado 3 días NO es hueco (el VBK cubre ese intervalo).
	noGap := &Chain{VBK: &File{DateStr: "2026-07-17"},
		VIBs: []*File{{DateStr: "2026-07-20"}, {DateStr: "2026-07-21"}}}
	if h, _ := chainGap(noGap); h {
		t.Fatalf("VBK→primer VIB no debería marcar hueco")
	}
	// Falta un incremento en medio (20 → 23) → hueco de 3 días.
	gap := &Chain{VBK: &File{DateStr: "2026-07-17"},
		VIBs: []*File{{DateStr: "2026-07-20"}, {DateStr: "2026-07-23"}, {DateStr: "2026-07-24"}}}
	hasGap, maxGap = chainGap(gap)
	if !hasGap || maxGap != 3 {
		t.Fatalf("esperado hueco de 3 días, got hasGap=%v maxGap=%d", hasGap, maxGap)
	}
	// Sin fechas → nunca hueco.
	empty := &Chain{VBK: &File{}, VIBs: []*File{{}}}
	if h, _ := chainGap(empty); h {
		t.Fatalf("cadena sin fechas no debería marcar hueco")
	}
}

func TestMachineLastBackup(t *testing.T) {
	files := []*File{
		{DateStr: "2026-07-17", TimeStr: "13:52:45"},
		{DateStr: "2026-07-25", TimeStr: "18:37:08"},
		{DateStr: "2026-07-21", TimeStr: "00:00:01"},
	}
	str, ts := machineLastBackup(files)
	if str != "2026-07-25 18:37:08" {
		t.Fatalf("esperado 2026-07-25 18:37:08, got %q", str)
	}
	if ts != 1785004628 { // 2026-07-25T18:37:08 epoch
		t.Fatalf("epoch inesperado: %d", ts)
	}
}
