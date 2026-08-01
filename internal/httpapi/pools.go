// pools.go — endpoints de pools. Los GET leen la caché del colector zpool.
package httpapi

import (
	"net/http"
)

// listPools — GET /api/pools (caché; vdevs con temp cruzada con discos).
func (s *Server) listPools(w http.ResponseWriter, r *http.Request) {
	pools := s.pools.Pools()
	temps := map[string]float64{}
	for _, d := range s.disks.Disks() {
		temps[d.Dev] = d.TempC
	}
	for i := range pools {
		for j := range pools[i].Vdevs {
			if t, ok := temps[stripPart(pools[i].Vdevs[j].Dev)]; ok {
				pools[i].Vdevs[j].TempC = t
			}
		}
	}
	writeJSON(w, http.StatusOK, pools)
}

// createPool — POST /api/pools {name, topo, disks[]} → 202.
func (s *Server) createPool(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name  string   `json:"name"`
		Topo  string   `json:"topo"`
		Disks []string `json:"disks"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := s.act.PoolCreate(r.Context(), actor(r), body.Name, body.Topo, body.Disks); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// importPool — POST /api/pools/import {name?} → lista importables o importa.
func (s *Server) importPool(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Name == "" {
		names, err := s.act.PoolImportList(r.Context())
		if err != nil {
			actionErr(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"importable": names})
		return
	}
	if err := s.act.PoolImport(r.Context(), actor(r), body.Name); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// scrubPool — POST /api/pools/{name}/scrub {action:start|pause|stop} → 202.
func (s *Server) scrubPool(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var body struct {
		Action string `json:"action"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := s.act.Scrub(r.Context(), actor(r), name, body.Action); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// exportPool — POST /api/pools/{name}/export {confirm, force, destroy} → 202.
func (s *Server) exportPool(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var body struct {
		Confirm string `json:"confirm"`
		Force   bool   `json:"force"`
		Destroy bool   `json:"destroy"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if !requireConfirm(w, body.Confirm, name) {
		return
	}
	if err := s.act.PoolExport(r.Context(), actor(r), name, body.Force, body.Destroy); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// addVdev — POST /api/pools/{name}/vdev {topo, disks[]} → 202.
func (s *Server) addVdev(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var body struct {
		Topo  string   `json:"topo"`
		Disks []string `json:"disks"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := s.act.VdevAdd(r.Context(), actor(r), name, body.Topo, body.Disks); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// replaceDisk — POST /api/pools/{name}/replace {old_dev, new_dev} → 202.
func (s *Server) replaceDisk(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var body struct {
		OldDev string `json:"old_dev"`
		NewDev string `json:"new_dev"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := s.act.Replace(r.Context(), actor(r), name, body.OldDev, body.NewDev); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// stripPart quita el sufijo de partición ('sdb1'→'sdb', 'nvme0n1p2'→'nvme0n1').
func stripPart(dev string) string {
	n := len(dev)
	// nvme/loop con sufijo 'pN'
	for n > 0 && dev[n-1] >= '0' && dev[n-1] <= '9' {
		n--
	}
	if n < len(dev) && n > 0 && dev[n-1] == 'p' {
		return dev[:n-1]
	}
	// sdX1 → sdX (solo si la base termina en letra)
	if n < len(dev) && n > 0 && dev[n-1] >= 'a' && dev[n-1] <= 'z' {
		return dev[:n]
	}
	return dev
}

// poolForDisk — pool al que pertenece un disco (por vdevs conocidos).
func poolForDisk(pools []string, vdevs map[string][]string, dev string) string {
	base := stripPart(dev)
	for _, p := range pools {
		for _, v := range vdevs[p] {
			if stripPart(v) == base || v == dev {
				return p
			}
		}
	}
	return ""
}
