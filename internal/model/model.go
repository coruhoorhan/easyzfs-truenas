// Package model — tipos de dominio compartidos (contrato JSON del API).
// Paquete neutro: lo importan collectors, alerts, actions, scheduler y httpapi
// para evitar ciclos de dependencias.
package model

import "time"

// ScrubInfo — estado del scrub/resilver de un pool (contrato: pools[].scrub).
type ScrubInfo struct {
	State  string    `json:"state"` // "none" | "running" | "done"
	Kind   string    `json:"kind"`  // "scrub" | "resilver" (vacío si none)
	Pct    float64   `json:"pct"`
	EtaSec int64     `json:"eta_sec"`
	Ts     time.Time `json:"ts"`
	Errors int64     `json:"errors"`
}

// Vdev — dispositivo de un pool (contrato: pools[].vdevs[]).
type Vdev struct {
	Dev    string  `json:"dev"`
	Path   string  `json:"path,omitempty"` // ruta real resuelta ('/dev/sda1'); "" si no resoluble (p.ej. disco retirado)
	Role   string  `json:"role"`           // "stripe" | "mirror" | "raidz1" | "raidz2" | "raidz3" | "spare" | "log" | "cache"
	Status string  `json:"status"`
	TempC  float64 `json:"temp_c"`
}

// Pool — contrato GET /api/pools.
type Pool struct {
	Name       string    `json:"name"`
	Status     string    `json:"status"` // "ONLINE" | "DEGRADED" | "FAULTED"
	Topo       string    `json:"topo"`   // "stripe" | "mirror" | "raidz1" | "raidz2" | "raidz3"
	UsedBytes  uint64    `json:"used_bytes"`
	TotalBytes uint64    `json:"total_bytes"`
	FragPct    float64   `json:"frag_pct"`
	CompRatio  float64   `json:"comp_ratio"`
	Scrub      ScrubInfo `json:"scrub"`
	Vdevs      []Vdev    `json:"vdevs"`
}

// Dataset — contrato GET /api/datasets.
type Dataset struct {
	Name        string `json:"name"`
	Type        string `json:"type"` // "fs" | "volume"
	Compression string `json:"compression"`
	UsedBytes   uint64 `json:"used_bytes"`
	AvailBytes  uint64 `json:"avail_bytes"`
	QuotaBytes  uint64 `json:"quota_bytes"`
	Mountpoint  string `json:"mountpoint"`
}

// Snapshot — contrato GET /api/snapshots (dentro de SnapGroup).
type Snapshot struct {
	Name      string    `json:"name"`
	Full      string    `json:"full"` // "tank/docs@snap"
	Ts        time.Time `json:"ts"`
	UsedBytes uint64    `json:"used_bytes"`
	Kind      string    `json:"kind"` // "auto" | "manual"
}

// SnapGroup — snapshots agrupados por dataset.
type SnapGroup struct {
	Dataset string     `json:"dataset"`
	Snaps   []Snapshot `json:"snaps"`
}

// Disk — contrato GET /api/disks.
type Disk struct {
	Dev       string `json:"dev"`
	Model     string `json:"model"`
	Serial    string `json:"serial"`
	SizeBytes uint64 `json:"size_bytes"`
	// TempC es nil (JSON null) cuando no hay lectura (eMMC, USB sin SAT,
	// smartctl no disponible): "sin dato" no es lo mismo que 0 °C.
	TempC       *float64 `json:"temp_c"`
	Smart       string   `json:"smart"` // "ok" | "warn" | "crit" | "unknown" (sin smartctl: eMMC, USB sin SAT)
	SmartDetail string   `json:"smart_detail"`
	Pool        string   `json:"pool"`
	InUse       bool     `json:"in_use,omitempty"` // particiones montadas o swap activo (no elegible como "libre")
	Hours       uint64   `json:"hours"`
}

// SysTimer — contrato GET /api/system-timers: temporizadores que YA existen
// en el sistema (systemd timers y cron), solo lectura. next_run/last_run son
// cadenas de visualización ("" si el sistema no las conoce: cron no las tiene).
type SysTimer struct {
	Source   string `json:"source"`   // "systemd" | "cron"
	Name     string `json:"name"`     // unidad .timer o nombre derivado del comando
	Schedule string `json:"schedule"` // expr. cron ("0 2 * * *", "@daily") o "" si no se conoce
	NextRun  string `json:"next_run"` // systemd: NEXT; cron: ""
	LastRun  string `json:"last_run"` // systemd: LAST; cron: ""
	Command  string `json:"command"`  // unidad activada (systemd) o comando (cron)
	Origin   string `json:"origin"`   // "systemctl list-timers", "crontab", "/etc/crontab", "/etc/cron.d/<f>", "/etc/cron.daily"…
}

// Alert — contrato GET /api/alerts y evento SSE alert.new.
type Alert struct {
	ID      int64     `json:"id"`
	Ts      time.Time `json:"ts"`
	Level   string    `json:"level"`  // "info" | "warn" | "crit"
	Source  string    `json:"source"` // origen lógico: "pool.tank", "disk.sda", "smart.sda", "scrub.tank"…
	Target  string    `json:"target"` // destino navegable en la UI: "pools:<name>", "disks:<dev>", "tasks", "settings" ("" = sin destino)
	Message string    `json:"message"`
	Acked   bool      `json:"acked"`
}

// AutoSnapPrefix — prefijo de los snapshots creados por el scheduler.
const AutoSnapPrefix = "easyzfs-auto-"
