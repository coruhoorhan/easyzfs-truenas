// sensors.go — temperaturas desde /sys/class/hwmon (drivetemp, nvme).
// Intervalo 30 s. Publica disk.temp solo cuando cambia ≥1 °C.
package collectors

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gnacho/zfsctl/internal/hub"
)

const sensorsInterval = 30 * time.Second

// SensorsCollector — mapa dev → °C leído de hwmon.
type SensorsCollector struct {
	h *hub.Hub

	mu      sync.RWMutex
	temps   map[string]float64
	lastPub map[string]int // última temp publicada (enteros, para dedupe)
	fails   int
}

// NewSensorsCollector crea el colector de sensores.
func NewSensorsCollector(h *hub.Hub) *SensorsCollector {
	return &SensorsCollector{
		h:       h,
		temps:   map[string]float64{},
		lastPub: map[string]int{},
	}
}

// Name implementa Collector.
func (c *SensorsCollector) Name() string { return "sensors" }

// Run — bucle con ticker; un fallo de lectura degrada, no tumba.
func (c *SensorsCollector) Run(ctx context.Context) {
	t := time.NewTicker(sensorsInterval)
	defer t.Stop()
	c.collectOnce()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.collectOnce()
		}
	}
}

// Temp devuelve la temperatura conocida de un dev (por nombre base o parcial).
func (c *SensorsCollector) Temp(dev string) (float64, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if t, ok := c.temps[dev]; ok {
		return t, true
	}
	// los vdevs pueden venir como 'sdb1' y el sensor como 'sdb'
	for k, t := range c.temps {
		if strings.HasPrefix(dev, k) || strings.HasPrefix(k, dev) {
			return t, true
		}
	}
	return 0, false
}

// collectOnce recorre /sys/class/hwmon buscando sensores de disco.
func (c *SensorsCollector) collectOnce() {
	entries, err := os.ReadDir("/sys/class/hwmon")
	if err != nil {
		c.fails++
		if c.fails == 3 {
			log.Printf("sensors: /sys/class/hwmon: %v (fuente stale)", err)
		}
		return
	}
	c.fails = 0
	temps := map[string]float64{}
	for _, e := range entries {
		dir := filepath.Join("/sys/class/hwmon", e.Name())
		nameRaw, err := os.ReadFile(filepath.Join(dir, "name"))
		if err != nil {
			continue
		}
		name := strings.TrimSpace(string(nameRaw))
		if name != "drivetemp" && name != "nvme" {
			continue
		}
		dev := hwmonDevice(dir)
		if dev == "" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, "temp1_input"))
		if err != nil {
			continue
		}
		milli, err := strconv.ParseFloat(strings.TrimSpace(string(raw)), 64)
		if err != nil {
			continue
		}
		temps[dev] = milli / 1000
	}
	c.mu.Lock()
	c.temps = temps
	c.mu.Unlock()
	c.publish(temps)
}

// hwmonDevice resuelve el dispositivo de bloque asociado al hwmon
// (…/hwmonX/device → …/block/sdX o …/nvmeXn1).
func hwmonDevice(dir string) string {
	link, err := os.Readlink(filepath.Join(dir, "device"))
	if err != nil {
		return ""
	}
	parts := strings.Split(filepath.Clean(link), "/")
	for i := len(parts) - 1; i >= 0; i-- {
		p := parts[i]
		if p == "block" && i+1 < len(parts) {
			return parts[i+1]
		}
		if strings.HasPrefix(p, "sd") || strings.HasPrefix(p, "hd") || strings.HasPrefix(p, "vd") {
			return p
		}
		// nvme: solo namespaces ('nvme0n1'), no controladores ('nvme0')
		if strings.HasPrefix(p, "nvme") && strings.Contains(p[4:], "n") {
			return p
		}
	}
	return ""
}

// publish emite disk.temp cuando cambia el valor entero.
func (c *SensorsCollector) publish(temps map[string]float64) {
	for dev, t := range temps {
		ti := int(t)
		if last, ok := c.lastPub[dev]; !ok || last != ti {
			c.h.Publish("disk.temp", map[string]any{"dev": dev, "temp_c": t})
			c.lastPub[dev] = ti
		}
	}
}
