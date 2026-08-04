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

// gapThresholdDays — si entre dos respaldos consecutivos de una cadena pasan
// más de estos días, se marca la cadena con un hueco (datos de esos días no
// restaurables desde esta cadena). El patrón Veeam normal es diario (1 día).
const gapThresholdDays = 2

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
// has_gap indica huecos de ≥ gapThresholdDays entre respaldos consecutivos.
type Chain struct {
	VBK      *File  `json:"vbk"`
	VIBs     []*File `json:"vibs"`
	IsBroken bool   `json:"is_broken"`
	HasGap   bool   `json:"has_gap"`
	GapDays  int    `json:"gap_days"`
}

// Machine — máquina con todos sus archivos y cadenas. LastBackup es la fecha
// del respaldo más reciente (de cualquier cadena) en formato "YYYY-MM-DD HH:MM".
type Machine struct {
	Name         string   `json:"name"`
	TotalSize    int64    `json:"total_size"`
	Files        []*File  `json:"files"`
	Chains       []*Chain `json:"chains"`
	LastBackup   string   `json:"last_backup"`
	LastBackupTS int64    `json:"last_backup_ts"`
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
// También calcula huecos (gap) dentro de cada cadena.
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
	for _, c := range chains {
		c.HasGap, c.GapDays = chainGap(c)
	}
	return chains
}

// chainGap devuelve si hay un hueco ≥ gapThresholdDays entre INCREMENTOS
// consecutivos (VIB) de una cadena y el mayor hueco. El tramo VBK→primer VIB
// NO se considera hueco: el VBK es una copia completa y cubre ese intervalo
// (restaurar al VBK no pierde nada).
func chainGap(c *Chain) (bool, int) {
	dates := make([]time.Time, 0, len(c.VIBs))
	for _, f := range c.VIBs {
		if f.DateStr == "" {
			continue
		}
		if d, err := time.Parse("2006-01-02", f.DateStr); err == nil {
			dates = append(dates, d)
		}
	}
	hasGap, maxGap := false, 0
	for i := 1; i < len(dates); i++ {
		days := int(dates[i].Sub(dates[i-1]).Hours() / 24)
		if days > gapThresholdDays {
			hasGap = true
			if days > maxGap {
				maxGap = days
			}
		}
	}
	return hasGap, maxGap
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
		m.LastBackup, m.LastBackupTS = machineLastBackup(m.Files)
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

// machineLastBackup devuelve el respaldo más reciente de la máquina como
// "YYYY-MM-DD HH:MM:SS" (para mostrar) y como epoch (para calcular edad).
func machineLastBackup(files []*File) (string, int64) {
	best, ts := "", int64(0)
	for _, f := range files {
		if f.DateStr == "" {
			continue
		}
		key := f.DateStr + " " + f.TimeStr
		if key > best {
			best = key
			if t, err := time.Parse("2006-01-02 15:04:05", key); err == nil {
				ts = t.Unix()
			}
		}
	}
	return best, ts
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
