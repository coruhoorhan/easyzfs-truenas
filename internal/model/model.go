// Package model — tipos de dominio compartidos (contrato JSON del API).
// Paquete neutro: lo importan collectors, alerts, actions, scheduler y httpapi
// para evitar ciclos de dependencias.
package model

import "time"

// ScrubInfo — estado del scrub de un pool (contrato: pools[].scrub).
type ScrubInfo struct {
	State  string    `json:"state"` // "none" | "running" | "done"
	Pct    float64   `json:"pct"`
	EtaSec int64     `json:"eta_sec"`
	Ts     time.Time `json:"ts"`
	Errors int64     `json:"errors"`
}

// Vdev — dispositivo de un pool (contrato: pools[].vdevs[]).
type Vdev struct {
	Dev    string  `json:"dev"`
	Role   string  `json:"role"` // "stripe" | "mirror" | "raidz1" | "raidz2" | "raidz3" | "spare" | "log" | "cache"
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
	Dev         string  `json:"dev"`
	Model       string  `json:"model"`
	Serial      string  `json:"serial"`
	SizeBytes   uint64  `json:"size_bytes"`
	TempC       float64 `json:"temp_c"`
	Smart       string  `json:"smart"` // "ok" | "warn" | "crit"
	SmartDetail string  `json:"smart_detail"`
	Pool        string  `json:"pool"`
	Hours       uint64  `json:"hours"`
}

// Alert — contrato GET /api/alerts y evento SSE alert.new.
type Alert struct {
	ID      int64     `json:"id"`
	Ts      time.Time `json:"ts"`
	Level   string    `json:"level"` // "info" | "warn" | "crit"
	Source  string    `json:"source"`
	Message string    `json:"message"`
	Acked   bool      `json:"acked"`
}

// AutoSnapPrefix — prefijo de los snapshots creados por el scheduler.
const AutoSnapPrefix = "zfsctl-auto-"
