// history.go — historial de comandos de cada pool ('zpool history -i').
// Se cachea en el tick del colector zpool (los handlers nunca ejecutan CLI).
//
// OJO (incidente 2-Ago-2026): la salida de 'zpool history -i' puede ser
// ENORME (bigtank: 2,7 M líneas / 275 MB). Parsearla en memoria con
// strings.Split disparó un OOM-loop (MemoryMax=256M y luego 1G). Por eso el
// parseo es en STREAMING línea a línea con un ring buffer de historyKeep:
// la memoria usada no depende del tamaño del historial.
package collectors

import (
	"bufio"
	"io"
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

// parseHistoryLine convierte una línea de 'zpool history -i' en entrada.
// Líneas no reconocibles (huecos '...', continuaciones) devuelven ok=false.
func parseHistoryLine(line string) (model.HistoryEntry, bool) {
	m := histRe.FindStringSubmatch(strings.TrimSpace(line))
	if m == nil {
		return model.HistoryEntry{}, false
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
	return model.HistoryEntry{
		Ts:          time.Date(y, time.Month(mo), d, h, mi, s, 0, time.Local).UTC(),
		Command:     cmd,
		DurationSec: dur,
	}, true
}

// parseHistoryStream lee la salida de 'zpool history -i' línea a línea y
// devuelve las últimas historyKeep entradas en orden cronológico. Memoria
// acotada (ring buffer), independiente del tamaño del historial.
func parseHistoryStream(r io.Reader) []model.HistoryEntry {
	ring := make([]model.HistoryEntry, historyKeep)
	n := 0
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		if e, ok := parseHistoryLine(sc.Text()); ok {
			ring[n%historyKeep] = e
			n++
		}
	}
	if n == 0 {
		return []model.HistoryEntry{}
	}
	count := min(n, historyKeep)
	out := make([]model.HistoryEntry, 0, count)
	start := n - count
	for i := start; i < n; i++ {
		out = append(out, ring[i%historyKeep])
	}
	return out
}

// parseHistory convierte la salida completa en string (para tests y salidas
// pequeñas). Recortada a historyKeep, orden cronológico.
func parseHistory(out string) []model.HistoryEntry {
	return parseHistoryStream(strings.NewReader(out))
}
