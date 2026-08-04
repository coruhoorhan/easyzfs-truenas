package collectors

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"easyzfs/internal/alerts"
	"easyzfs/internal/settings"
	"easyzfs/internal/veeam"
)

// veeamScanInterval — cada cuánto se escanean los datasets Veeam en busca de
// cadenas de respaldo rotas. 10 minutos es suficiente: un VBK perdido no es
// un evento de segundos.
const veeamScanInterval = 10 * time.Minute

// VeeamCollector detecta cadenas de respaldo Veeam rotas (VIB sin su VBK) en
// los datasets configurados (settings.veeam_datasets) y levanta una alerta
// por máquina. A diferencia del handler HTTP (que solo escanea cuando se
// abre la vista), esto vigila en segundo plano y avisa aunque nadie mire.
type VeeamCollector struct {
	settings *settings.Store
	alerter  *alerts.Alerter
}

// NewVeeamCollector crea el colector de cadenas rotas.
func NewVeeamCollector(st *settings.Store, al *alerts.Alerter) *VeeamCollector {
	return &VeeamCollector{settings: st, alerter: al}
}

// Name — identidad para logs.
func (c *VeeamCollector) Name() string { return "veeam" }

// Run escanea en bucle hasta que ctx se cancela.
func (c *VeeamCollector) Run(ctx context.Context) {
	t := time.NewTicker(veeamScanInterval)
	defer t.Stop()
	// Primer escaneo a los 30 s del arranque (no al instante: da tiempo a que
	// los otros colectores y la BD estén listos).
	select {
	case <-time.After(30 * time.Second):
	case <-ctx.Done():
		return
	}
	c.scanOnce(ctx)
	for {
		select {
		case <-t.C:
			c.scanOnce(ctx)
		case <-ctx.Done():
			return
		}
	}
}

func (c *VeeamCollector) scanOnce(ctx context.Context) {
	st, err := c.settings.Load(ctx)
	if err != nil {
		log.Printf("veeam: no se pudieron leer ajustes: %v", err)
		return
	}
	for _, ds := range strings.Split(st.VeeamDatasets, ",") {
		ds = strings.TrimSpace(ds)
		if ds == "" {
			continue
		}
		res, err := veeam.Scan(ctx, ds)
		if err != nil {
			log.Printf("veeam: escaneo de %s: %v", ds, err)
			continue
		}
		for _, bc := range veeam.BrokenChains(res) {
			c.alerter.RaiseKind(ctx, "critical", "veeam:"+bc.Machine, bc.Machine,
				fmt.Sprintf("Zincir de respaldo %d rota en %s: falta el VBK principal de %s. No se puede restablecer desde los VIB posteriores.", bc.Chain, ds, bc.Machine),
				"broken_chain", map[string]any{"dataset": ds, "machine": bc.Machine, "chain": bc.Chain})
		}
		now := time.Now()
		for _, m := range res.Machines {
			if m.LastBackupTS > 0 {
				ageDays := int64(now.Unix()-m.LastBackupTS) / 86400
				if ageDays >= int64(st.VeeamStaleDays) {
					c.alerter.RaiseKind(ctx, "warn", "veeam:"+m.Name, m.Name,
						fmt.Sprintf("Respaldo obsoleto: último respaldo de %s el %s (hace %d días).", m.Name, m.LastBackup, ageDays),
						"stale_backup", map[string]any{"dataset": ds, "machine": m.Name, "last": m.LastBackup, "days": ageDays})
				}
			}
			for _, ch := range m.Chains {
				if ch.HasGap {
					c.alerter.RaiseKind(ctx, "warn", "veeam:"+m.Name, m.Name,
						fmt.Sprintf("Cadena de %s con hueco: %d días sin respaldo (datos de ese intervalo no restaurables en esta cadena).", m.Name, ch.GapDays),
						"chain_gap", map[string]any{"dataset": ds, "machine": m.Name, "days": ch.GapDays})
				}
			}
		}
	}
}
