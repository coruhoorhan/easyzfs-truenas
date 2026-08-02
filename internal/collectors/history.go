// history.go — historial de comandos de cada pool ('zpool history -i').
// Se cachea en el tick del colector zpool (los handlers nunca ejecutan CLI).
package collectors

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"easyzfs/internal/model"
)

// historyKeep — máximo de entradas cacheadas por pool.
const historyKeep = 100

// histRe — líneas 'YYYY-MM-DD.HH:MM:SS comando' (la fecha usa punto como
// separador fecha/hora, p.ej. '2026-08-01.06:12:33 zpool scrub tank').
var histRe = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})\.(\d{2}):(\d{2}):(\d{2})\s+(.*)$`)

// histDurRe — sufijo de duración de 'zpool history -i': '... (6.06s)'.
var histDurRe = regexp.MustCompile(`\((\d+(?:\.\d+)?)s\)\s*$`)

// parseHistory convierte la salida de 'zpool history -i <pool>' en entradas
// ordenadas cronológicamente (la salida ya lo está), recortadas a historyKeep.
// Líneas no reconocibles (huecos '...', continuaciones) se ignoran.
func parseHistory(out string) []model.HistoryEntry {
	entries := []model.HistoryEntry{}
	for _, line := range strings.Split(out, "\n") {
		m := histRe.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		y, _ := strconv.Atoi(m[1])
		mo, _ := strconv.Atoi(m[2])
		d, _ := strconv.Atoi(m[3])
		h, _ := strconv.Atoi(m[4])
		mi, _ := strconv.Atoi(m[5])
		s, _ := strconv.Atoi(m[6])
		cmd := strings.TrimSpace(m[7])
		var dur float64
		if dm := histDurRe.FindStringSubmatch(cmd); dm != nil {
			dur, _ = strconv.ParseFloat(dm[1], 64)
			cmd = strings.TrimSpace(histDurRe.ReplaceAllString(cmd, ""))
		}
		entries = append(entries, model.HistoryEntry{
			Ts:          time.Date(y, time.Month(mo), d, h, mi, s, 0, time.Local).UTC(),
			Command:     cmd,
			DurationSec: dur,
		})
	}
	if len(entries) > historyKeep {
		entries = entries[len(entries)-historyKeep:]
	}
	return entries
}
