// pools.go — endpoints de pools. Los GET leen la caché del colector zpool.
package httpapi

import (
	"net/http"
	"strings"
)

// listPools — GET /api/pools (caché; vdevs con temp cruzada con discos).
func (s *Server) listPools(w http.ResponseWriter, r *http.Request) {
	pools := s.pools.Pools()
	temps := map[string]float64{}
	for _, d := range s.disks.Disks() {
		if d.TempC != nil {
			temps[d.Dev] = *d.TempC
		}
	}
	for i := range pools {
		for j := range pools[i].Vdevs {
			key := stripPart(strings.TrimPrefix(pools[i].Vdevs[j].Path, "/dev/"))
			if key == "" {
				key = stripPart(pools[i].Vdevs[j].Dev)
			}
			if t, ok := temps[key]; ok {
				pools[i].Vdevs[j].TempC = t
			}
		}
	}
	writeJSON(w, http.StatusOK, pools)
}

// createPool — POST /api/pools {name, topo, disks[], confirm} → 202.
func (s *Server) createPool(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string   `json:"name"`
		Topo    string   `json:"topo"`
		Disks   []string `json:"disks"`
		Confirm string   `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if !requireConfirm(w, body.Confirm, body.Name) {
		return
	}
	if err := s.act.PoolCreate(r.Context(), actor(r), body.Name, body.Topo, body.Disks, true); err != nil {
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

// addVdev — POST /api/pools/{name}/vdev {topo, disks[], confirm} → 202.
func (s *Server) addVdev(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var body struct {
		Topo    string   `json:"topo"`
		Disks   []string `json:"disks"`
		Confirm string   `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if !requireConfirm(w, body.Confirm, name) {
		return
	}
	if err := s.act.VdevAdd(r.Context(), actor(r), name, body.Topo, body.Disks, true); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// replaceDisk — POST /api/pools/{name}/replace {old_dev, new_dev, confirm} → 202.
func (s *Server) replaceDisk(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var body struct {
		OldDev  string `json:"old_dev"`
		NewDev  string `json:"new_dev"`
		Confirm string `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if !requireConfirm(w, body.Confirm, name) {
		return
	}
	if body.OldDev == body.NewDev {
		writeErr(w, http.StatusConflict, "same_dev", "el disco nuevo no puede ser el mismo que el sustituido")
		return
	}
	// Guarda: el disco nuevo no puede ser miembro de ningún pool (evita el
	// error críptico de zpool 'is part of active pool').
	newBase := stripPart(strings.TrimPrefix(body.NewDev, "/dev/"))
	for _, p := range s.pools.Pools() {
		for _, v := range p.Vdevs {
			key := stripPart(strings.TrimPrefix(v.Path, "/dev/"))
			if key == "" {
				key = stripPart(v.Dev)
			}
			if key != "" && key == newBase {
				writeErr(w, http.StatusConflict, "dev_in_use",
					"el disco nuevo ya pertenece al pool '"+p.Name+"'")
				return
			}
		}
	}
	// Guarda: el disco nuevo debe ser al menos tan grande como el sustituido.
	if oldSz, err := s.act.VdevSize(r.Context(), name, body.OldDev); err == nil && oldSz > 0 {
		for _, d := range s.disks.Disks() {
			if d.Dev == newBase && d.SizeBytes > 0 && d.SizeBytes < oldSz {
				writeErr(w, http.StatusConflict, "dev_too_small",
					"el disco nuevo es más pequeño que el sustituido")
				return
			}
		}
	}
	if err := s.act.Replace(r.Context(), actor(r), name, body.OldDev, body.NewDev, true); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// vdevAction — POST /api/pools/{name}/vdev/action {dev, action, confirm?} → 202.
// offline/online: sin confirmación. detach: exige confirm (destructivo).
func (s *Server) vdevAction(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var body struct {
		Dev     string `json:"dev"`
		Action  string `json:"action"`
		Confirm string `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Action == "detach" && !requireConfirm(w, body.Confirm, name) {
		return
	}
	if err := s.act.VdevAction(r.Context(), actor(r), name, body.Dev, body.Action, body.Action == "detach"); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// stripPart quita el sufijo de partición:
// 'sdb1'→'sdb' (solo estilo sdX/vdX/hdX), 'nvme0n1p2'→'nvme0n1', 'mmcblk0p1'→'mmcblk0'.
// OJO: 'nvme0n1' (disco entero) NO debe perder el '1' final.
func stripPart(dev string) string {
	// estilo <base>p<N> (nvme, mmcblk, loop…)
	if i := strings.LastIndex(dev, "p"); i > 0 && allDigits(dev[i+1:]) && !allDigits(dev[:i]) {
		return dev[:i]
	}
	// estilo sdX<N>/vdX<N>/hdX<N>: letra(s) + dígitos finales
	for _, pre := range []string{"xvd", "sd", "vd", "hd"} {
		if strings.HasPrefix(dev, pre) {
			rest := dev[len(pre):]
			j := len(rest)
			for j > 0 && rest[j-1] >= '0' && rest[j-1] <= '9' {
				j--
			}
			if j < len(rest) && j > 0 {
				return pre + rest[:j]
			}
			return dev
		}
	}
	return dev
}

// allDigits — true si s no está vacío y son todo dígitos.
func allDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// poolForDisk — pool al que pertenece un disco (por vdevs conocidos).
func poolForDisk(pools []string, vdevs map[string][]string, dev string) string {
	base := stripPart(dev)
	for _, p := range pools {
		for _, v := range vdevs[p] {
			if stripPart(strings.TrimPrefix(v, "/dev/")) == base || v == dev {
				return p
			}
		}
	}
	return ""
}
