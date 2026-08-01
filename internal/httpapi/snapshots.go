// snapshots.go — endpoints de snapshots.
package httpapi

import (
	"net/http"
	"strings"
)

// listSnapshots — GET /api/snapshots?dataset= (agrupado por dataset).
func (s *Server) listSnapshots(w http.ResponseWriter, r *http.Request) {
	groups := s.pools.SnapshotGroups()
	if ds := r.URL.Query().Get("dataset"); ds != "" {
		filtered := groups[:0]
		for _, g := range groups {
			if g.Dataset == ds {
				filtered = append(filtered, g)
			}
		}
		writeJSON(w, http.StatusOK, filtered)
		return
	}
	writeJSON(w, http.StatusOK, groups)
}

// createSnapshot — POST /api/snapshots {dataset, name, recursive} → 201.
func (s *Server) createSnapshot(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Dataset   string `json:"dataset"`
		Name      string `json:"name"`
		Recursive bool   `json:"recursive"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Name == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "name requerido")
		return
	}
	if err := s.act.SnapshotCreate(r.Context(), actor(r), body.Dataset, body.Name, body.Recursive); err != nil {
		actionErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"full": body.Dataset + "@" + body.Name})
}

// deleteSnapshot — DELETE /api/snapshots/{full} {confirm} → 204.
// full = 'tank/docs@snap' URL-encoded (%2F se decodifica por segmento).
func (s *Server) deleteSnapshot(w http.ResponseWriter, r *http.Request) {
	full := r.PathValue("full")
	var body struct {
		Confirm string `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if !strings.Contains(full, "@") {
		writeErr(w, http.StatusBadRequest, "invalid_input", "se esperaba 'dataset@snapshot'")
		return
	}
	if !requireConfirm(w, body.Confirm, full) {
		return
	}
	if err := s.act.SnapshotDelete(r.Context(), actor(r), full); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// rollbackSnapshot — POST /api/snapshots/{full}/rollback {confirm} → 202.
func (s *Server) rollbackSnapshot(w http.ResponseWriter, r *http.Request) {
	full := r.PathValue("full")
	var body struct {
		Confirm string `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if !requireConfirm(w, body.Confirm, full) {
		return
	}
	if err := s.act.SnapshotRollback(r.Context(), actor(r), full); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}
