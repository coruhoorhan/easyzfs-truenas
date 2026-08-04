// Package veeam — exploración de respaldos Veeam (VBK/VIB/VBM) sobre
// datasets ZFS: escanea snapshots (.zfs/snapshot) y el directorio vivo,
// agrupa por máquina y construye cadenas VBK+VIB. Lo comparten el handler
// HTTP (GET /api/veeam/explorer) y el collector que detecta cadenas rotas.
package veeam

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"easyzfs/internal/executil"
)

var dateRe = regexp.MustCompile(`(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})`)

// File — un archivo de respaldo (VBK/VIB/VBM) localizado en vivo o en un
// snapshot ZFS.
type File struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	Size         int64  `json:"size"`
	Type         string `json:"type"` // "VBK" | "VIB" | "VBM"
	DateStr      string `json:"date_str"`
	TimeStr      string `json:"time_str"`
	IsZFSArchive bool   `json:"is_zfs_archive"`
	SnapshotName string `json:"snapshot_name,omitempty"`
}

// Chain — cadena de respaldo: un VBK (tam yedek) y sus VIB incrementales.
// Sin VBK la cadena está rota (is_broken) y los VIB no sirven para restaurar.
type Chain struct {
	VBK      *File  `json:"vbk"`
	VIBs     []*File `json:"vibs"`
	IsBroken bool   `json:"is_broken"`
}

// Machine — máquina con todos sus archivos y cadenas.
type Machine struct {
	Name      string   `json:"name"`
	TotalSize int64    `json:"total_size"`
	Files     []*File  `json:"files"`
	Chains    []*Chain `json:"chains"`
}

// Result — respuesta de un escaneo completo de un dataset.
type Result struct {
	Machines      []*Machine `json:"machines"`
	TotalVMs      int        `json:"total_vms"`
	TotalCapacity int64      `json:"total_capacity"`
	LogicalUsed   int64      `json:"logical_used"`
	PhysicalUsed  int64      `json:"physical_used"`
	CompressRatio string     `json:"compress_ratio"`
}

func parseName(filename string) (machine, dateStr, timeStr, ftype string) {
	if strings.HasSuffix(filename, ".vbk") {
		ftype = "VBK"
	} else if strings.HasSuffix(filename, ".vib") {
		ftype = "VIB"
	} else if strings.HasSuffix(filename, ".vbm") {
		ftype = "VBM"
	} else {
		return "", "", "", ""
	}

	parts := strings.Split(filename, "/")
	base := parts[len(parts)-1]

	if m := dateRe.FindStringSubmatch(base); len(m) == 5 {
		dateStr = m[1]
		timeStr = m[2] + ":" + m[3] + ":" + m[4]
		machine = strings.Split(base, ".vm-")[0]
	} else if ftype == "VBM" {
		if idx := strings.LastIndex(base, "_"); idx > 0 {
			machine = base[:idx]
		} else {
			machine = strings.TrimSuffix(base, ".vbm")
		}
	}
	return machine, dateStr, timeStr, ftype
}

// BuildChains ordena los archivos de una máquina por fecha y los agrupa en
// cadenas VBK+VIB. Un VIB sin VBK previo en la lista abre una cadena rota.
func BuildChains(files []*File) []*Chain {
	sorted := make([]*File, len(files))
	copy(sorted, files)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].DateStr+sorted[i].TimeStr < sorted[j].DateStr+sorted[j].TimeStr
	})

	var chains []*Chain
	var cur *Chain
	for _, f := range sorted {
		switch f.Type {
		case "VBK":
			cur = &Chain{VBK: f, VIBs: []*File{}}
			chains = append(chains, cur)
		case "VIB":
			if cur != nil {
				cur.VIBs = append(cur.VIBs, f)
				continue
			}
			// VIB huérfano: si la última cadena ya está rota, se anexa a ella;
			// si no, abre una cadena rota nueva.
			if n := len(chains); n > 0 && chains[n-1].IsBroken {
				chains[n-1].VIBs = append(chains[n-1].VIBs, f)
			} else {
				chains = append(chains, &Chain{VBK: nil, VIBs: []*File{f}, IsBroken: true})
			}
		}
	}
	return chains
}

// Scan explora un dataset: primero sus snapshots (.zfs/snapshot/*), después
// el directorio vivo. Los archivos presentes en un snapshot quedan marcados
// como IsZFSArchive; si el mismo archivo también existe en vivo, se prioriza
// la copia viva (no es un archivo solo de snapshot).
func Scan(ctx context.Context, dataset string) (*Result, error) {
	livePath := "/mnt/" + dataset
	snapDir := livePath + "/.zfs/snapshot"

	fileMap := make(map[string]*File)

	processDir := func(baseDir string, isSnapshot bool, snapName string) {
		_ = filepath.WalkDir(baseDir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(baseDir, path)
			if err != nil {
				return nil
			}
			_, dateStr, timeStr, ftype := parseName(rel)
			if ftype == "" {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			if ex, ok := fileMap[rel]; ok {
				if !isSnapshot {
					ex.IsZFSArchive = false
					ex.Path = path
					ex.SnapshotName = ""
				}
				return nil
			}
			fileMap[rel] = &File{
				Name: rel, Path: path, Size: info.Size(),
				Type: ftype, DateStr: dateStr, TimeStr: timeStr,
				IsZFSArchive: isSnapshot, SnapshotName: snapName,
			}
			return nil
		})
	}

	if snaps, err := os.ReadDir(snapDir); err == nil {
		for _, snap := range snaps {
			if snap.IsDir() {
				processDir(filepath.Join(snapDir, snap.Name()), true, snap.Name())
			}
		}
	}
	processDir(livePath, false, "")

	machineMap := make(map[string]*Machine)
	var totalCap int64
	for _, f := range fileMap {
		mName := f.Name
		if m, _, _, _ := parseName(f.Name); m != "" {
			mName = m
		}
		m, ok := machineMap[mName]
		if !ok {
			m = &Machine{Name: mName, Files: []*File{}}
			machineMap[mName] = m
		}
		m.Files = append(m.Files, f)
		m.TotalSize += f.Size
		totalCap += f.Size
	}

	machines := make([]*Machine, 0, len(machineMap))
	for _, m := range machineMap {
		m.Chains = BuildChains(m.Files)
		machines = append(machines, m)
	}
	sort.Slice(machines, func(i, j int) bool {
		return machines[i].TotalSize > machines[j].TotalSize
	})

	res := &Result{Machines: machines, TotalVMs: len(machines), TotalCapacity: totalCap}

	if out, err := executil.Run(ctx, 15*time.Second, "zfs", "get", "-Hp", "-o", "value", "logicalused,used,compressratio", dataset); err == nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		if len(lines) >= 3 {
			if lu, err := strconv.ParseInt(lines[0], 10, 64); err == nil {
				res.LogicalUsed = lu
			}
			if pu, err := strconv.ParseInt(lines[1], 10, 64); err == nil {
				res.PhysicalUsed = pu
			}
			res.CompressRatio = lines[2]
		}
	}
	return res, nil
}

// BrokenChains devuelve las cadenas rotas de un resultado, por máquina.
func BrokenChains(res *Result) []BrokenChain {
	var out []BrokenChain
	for _, m := range res.Machines {
		for i, c := range m.Chains {
			if c.IsBroken {
				out = append(out, BrokenChain{Machine: m.Name, Chain: i + 1})
			}
		}
	}
	return out
}

// BrokenChain — una cadena rota localizada (máquina + índice).
type BrokenChain struct {
	Machine string
	Chain   int
}
