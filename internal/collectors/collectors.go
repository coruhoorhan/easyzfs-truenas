// Package collectors — un colector por fuente de datos, con caché en memoria.
// Los handlers HTTP leen la caché (Snapshot), NUNCA ejecutan comandos.
package collectors

import (
	"context"
	"database/sql"

	"easyzfs/internal/alerts"
	"easyzfs/internal/config"
	"easyzfs/internal/hub"
	"easyzfs/internal/model"
)

// Collector — patrón del skill: bucle con ticker que sale al cancelar ctx.
type Collector interface {
	Name() string
	Run(ctx context.Context)
}

// PoolProvider — caché de pools/datasets/snapshots (lo que leen los handlers).
type PoolProvider interface {
	Pools() []model.Pool
	Datasets() []model.Dataset
	SnapshotGroups() []model.SnapGroup
}

// DiskProvider — caché de discos.
type DiskProvider interface {
	Disks() []model.Disk
}

// SysTimerProvider — caché de tareas del sistema (cron + systemd timers).
type SysTimerProvider interface {
	SysTimers() []model.SysTimer
}

// Providers agrupa las cachés que consume httpapi.
type Providers struct {
	Pools     PoolProvider
	Disks     DiskProvider
	SysTimers SysTimerProvider
}

// Build construye colectores reales o el mock (MOCK=1 / DEMO=1).
func Build(cfg *config.Config, d *sql.DB, h *hub.Hub, al *alerts.Alerter) (*Providers, []Collector) {
	mant := NewMantenimiento(d, cfg.RetentionDays)
	if cfg.Mock {
		m := NewMock(h, al)
		return &Providers{Pools: m, Disks: m, SysTimers: m}, []Collector{m, mant}
	}
	zc := NewZpoolCollector(d, h, al)
	sc := NewSensorsCollector(h)
	smc := NewSmartCollector(d, h, al, sc)
	ssc := NewSchedSysCollector()
	return &Providers{Pools: zc, Disks: smc, SysTimers: ssc}, []Collector{zc, sc, smc, ssc, mant}
}

// baseName normaliza un dev de vdev ('/dev/sdb1', 'sdb1', 'ata-XXX-part1') a
// nombre base comparable con lsblk ('sdb', 'nvme0n1'). Mejor esfuerzo.
func baseName(dev string) string {
	// quita prefijo /dev/
	for len(dev) > 0 && dev[0] == '/' {
		dev = dev[1:]
		if len(dev) >= 4 && dev[:3] == "dev" {
			dev = dev[3:]
		}
	}
	return dev
}
