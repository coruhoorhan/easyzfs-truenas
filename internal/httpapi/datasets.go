// datasets.go — endpoints de datasets y volúmenes.
package httpapi

import (
	"net/http"
)

// listDatasets — GET /api/datasets (caché del colector).
func (s *Server) listDatasets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.pools.Datasets())
}

// createDataset — POST /api/datasets {pool, name, type, compression, quota_bytes, volsize_bytes?} → 201.
func (s *Server) createDataset(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Pool         string `json:"pool"`
		Name         string `json:"name"`
		Type         string `json:"type"`
		Compression  string `json:"compression"`
		QuotaBytes   uint64 `json:"quota_bytes"`
		VolsizeBytes uint64 `json:"volsize_bytes"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Type == "" {
		body.Type = "fs"
	}
	if body.Compression == "" {
		body.Compression = "lz4"
	}
	if err := s.act.DatasetCreate(r.Context(), actor(r), body.Pool, body.Name,
		body.Type, body.Compression, body.QuotaBytes, body.VolsizeBytes); err != nil {
		actionErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"name": body.Pool + "/" + body.Name})
}

// patchDataset — PATCH /api/datasets/{name} {quota_bytes?, compression?} → 204.
// {name} puede venir URL-encoded con '/' (tank%2Fdocs): el mux lo decodifica por segmento.
func (s *Server) patchDataset(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var body struct {
		QuotaBytes  *uint64 `json:"quota_bytes"`
		Compression *string `json:"compression"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := s.act.DatasetPatch(r.Context(), actor(r), name, body.QuotaBytes, body.Compression); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// deleteDataset — DELETE /api/datasets/{name} {confirm, recursive} → 202.
func (s *Server) deleteDataset(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var body struct {
		Confirm   string `json:"confirm"`
		Recursive bool   `json:"recursive"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if !requireConfirm(w, body.Confirm, name) {
		return
	}
	if err := s.act.DatasetDelete(r.Context(), actor(r), name, body.Recursive); err != nil {
		actionErr(w, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}
