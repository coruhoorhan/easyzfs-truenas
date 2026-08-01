// disks.go — endpoints de discos. GET desde caché del colector smart.
package httpapi

import (
	"net/http"
)

// listDisks — GET /api/disks (caché; pool cruzado con vdevs conocidos).
func (s *Server) listDisks(w http.ResponseWriter, r *http.Request) {
	disks := s.disks.Disks()
	pools := s.pools.Pools()
	names := make([]string, 0, len(pools))
	vdevs := map[string][]string{}
	for _, p := range pools {
		names = append(names, p.Name)
		for _, v := range p.Vdevs {
			vdevs[p.Name] = append(vdevs[p.Name], v.Dev)
		}
	}
	for i := range disks {
		if disks[i].Pool == "" {
			disks[i].Pool = poolForDisk(names, vdevs, disks[i].Dev)
		}
	}
	writeJSON(w, http.StatusOK, disks)
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
