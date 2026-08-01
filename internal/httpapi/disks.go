// disks.go — endpoints de discos. GET desde caché del colector smart.
package httpapi

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"easyzfs/internal/executil"
)

// listDisks — GET /api/disks (caché; pool cruzado con vdevs conocidos y
// "en uso" cruzado con puntos de montaje activos).
func (s *Server) listDisks(w http.ResponseWriter, r *http.Request) {
	disks := s.disks.Disks()
	pools := s.pools.Pools()
	names := make([]string, 0, len(pools))
	vdevs := map[string][]string{}
	for _, p := range pools {
		names = append(names, p.Name)
		for _, v := range p.Vdevs {
			vdevs[p.Name] = append(vdevs[p.Name], v.Dev)
			if v.Path != "" {
				vdevs[p.Name] = append(vdevs[p.Name], v.Path)
			}
		}
	}
	inUse := mountedDisks(r.Context())
	for i := range disks {
		if disks[i].Pool == "" {
			disks[i].Pool = poolForDisk(names, vdevs, disks[i].Dev)
		}
		disks[i].InUse = inUse[disks[i].Dev]
	}
	writeJSON(w, http.StatusOK, disks)
}

// --- discos "en uso": alguna partición montada o swap activo ---

var mountedCache = struct {
	sync.Mutex
	ts time.Time
	m  map[string]bool
}{}

// mountedDisks — mapa dev→true si el disco (o alguna partición) está montado
// o es swap activo. Caché de 15 s (lsblk es barato pero cada petición no).
func mountedDisks(ctx context.Context) map[string]bool {
	mountedCache.Lock()
	defer mountedCache.Unlock()
	if time.Since(mountedCache.ts) < 15*time.Second && mountedCache.m != nil {
		return mountedCache.m
	}
	m := map[string]bool{}
	out, err := executil.Run(ctx, 5*time.Second, "lsblk", "-rno", "NAME,MOUNTPOINTS")
	if err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			f := strings.Fields(line)
			if len(f) < 2 {
				continue // sin punto de montaje
			}
			m[stripPart(f[0])] = true
		}
	}
	mountedCache.ts = time.Now()
	mountedCache.m = m
	return m
}


// powerOff — POST /api/disks/{dev}/poweroff → 202.
// Solo discos libres: vetado si es miembro de un pool o tiene montajes activos.
func (s *Server) powerOff(w http.ResponseWriter, r *http.Request) {
	dev := r.PathValue("dev")
	pools := s.pools.Pools()
	names := make([]string, 0, len(pools))
	vdevs := map[string][]string{}
	for _, p := range pools {
		names = append(names, p.Name)
		for _, v := range p.Vdevs {
			vdevs[p.Name] = append(vdevs[p.Name], v.Dev)
			if v.Path != "" {
				vdevs[p.Name] = append(vdevs[p.Name], v.Path)
			}
		}
	}
	if p := poolForDisk(names, vdevs, dev); p != "" {
		writeErr(w, http.StatusConflict, "dev_in_use", "el disco pertenece al pool '"+p+"'")
		return
	}
	if mountedDisks(r.Context())[dev] {
		writeErr(w, http.StatusConflict, "dev_mounted", "el disco tiene particiones montadas o swap activo")
		return
	}
	if err := s.act.PowerOff(r.Context(), actor(r), dev); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// smartTest — POST /api/disks/{dev}/smart-test {type:short|long} → 202.
// Lanza el test; el resultado se observa en el colector smart.
func (s *Server) smartTest(w http.ResponseWriter, r *http.Request) {
	dev := r.PathValue("dev")
	var body struct {
		Type string `json:"type"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := s.act.SmartTest(r.Context(), actor(r), dev, body.Type); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}
