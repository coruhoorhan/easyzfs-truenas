package httpapi

import (
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"easyzfs/internal/actions"
	"easyzfs/internal/executil"
	"easyzfs/internal/veeam"
)

// veeamExplorer — GET /api/veeam/explorer?dataset={dataset}.
// Escaneo bajo demanda para la vista con caché de 60 s por dataset; las
// alertas de cadenas rotas las levanta VeeamCollector en segundo plano.
func (s *Server) veeamExplorer(w http.ResponseWriter, r *http.Request) {
	dataset := r.URL.Query().Get("dataset")
	if dataset == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "Dataset parameter is required")
		return
	}
	if res := s.veeamCacheGet(dataset); res != nil {
		writeJSON(w, http.StatusOK, res)
		return
	}
	res, err := veeam.Scan(r.Context(), dataset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "scan_error", err.Error())
		return
	}
	s.veeamCacheSet(dataset, res)
	writeJSON(w, http.StatusOK, res)
}

// veeamCacheTTL — ventana de validez del escaneo en memoria.
const veeamCacheTTL = 60 * time.Second

type veeamCacheEntry struct {
	res *veeam.Result
	ts  time.Time
}

func (s *Server) veeamCacheGet(dataset string) *veeam.Result {
	v, ok := s.veeamCache.Load(dataset)
	if !ok {
		return nil
	}
	e, ok := v.(veeamCacheEntry)
	if !ok || time.Since(e.ts) > veeamCacheTTL {
		s.veeamCache.Delete(dataset)
		return nil
	}
	return e.res
}

func (s *Server) veeamCacheSet(dataset string, res *veeam.Result) {
	s.veeamCache.Store(dataset, veeamCacheEntry{res: res, ts: time.Now()})
}

// veeamMounts — GET /api/veeam/mounts (admin).
// Lista los montajes activos leyendo el estado REAL de TrueNAS (shares
// VeeamClone + sus clones): no depende del localStorage del navegador.
func (s *Server) veeamMounts(w http.ResponseWriter, r *http.Request) {
	type mountInfo struct {
		ShareName string `json:"share_name"`
		CloneDS   string `json:"clone_ds"`
		Path      string `json:"path"`
		ReadOnly  bool   `json:"read_only"`
		CreatedTS int64  `json:"created_ts"`
	}
	shares, err := s.smbSharesList(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, []mountInfo{}) // sin SMB → sin montajes
		return
	}
	var mounts []mountInfo
	for _, sh := range shares {
		if !strings.HasPrefix(sh.Name, "VeeamClone_") {
			continue
		}
		cloneDS := strings.TrimPrefix(sh.Path, "/mnt/")
		createdTS := int64(0)
		if idx := strings.LastIndex(sh.Name, "_"); idx > 0 {
			createdTS, _ = strconv.ParseInt(sh.Name[idx+1:], 10, 64)
		}
		mounts = append(mounts, mountInfo{
			ShareName: sh.Name, CloneDS: cloneDS, Path: sh.Path,
			ReadOnly: sh.ReadOnly, CreatedTS: createdTS,
		})
	}
	if mounts == nil {
		mounts = []mountInfo{}
	}
	sort.Slice(mounts, func(i, j int) bool { return mounts[i].CreatedTS < mounts[j].CreatedTS })
	writeJSON(w, http.StatusOK, mounts)
}

// veeamMountClone — POST /api/veeam/mount-clone.
// Clona el snapshot (COW, instantáneo) y lo expone como share SMB de solo
// lectura vía el middleware de TrueNAS (midclt). Nombres validados con las
// mismas whitelists que actions y ejecución directa sin shell (nada de
// concatenar argumentos en bash -c).
func (s *Server) veeamMountClone(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Snapshot string `json:"snapshot"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	ds, snap, ok := strings.Cut(body.Snapshot, "@")
	if !ok || !actions.ValidDatasetName(ds) || !actions.ValidSnapshotName(snap) {
		writeErr(w, http.StatusBadRequest, "invalid_snapshot", "Geçersiz snapshot formatı")
		return
	}
	pool := strings.Split(ds, "/")[0]
	if !actions.ValidPoolName(pool) {
		writeErr(w, http.StatusBadRequest, "invalid_snapshot", "Geçersiz pool")
		return
	}
	cleanSnap := fmt.Sprintf("%s_%d", strings.ReplaceAll(snap, ":", "_"), time.Now().Unix())
	cloneDS := pool + "/clone_" + cleanSnap
	shareName := "VeeamClone_" + cleanSnap

	// 1. ZFS clone directo (sin shell). La raíz del clone nace con el
	//    mountpoint por defecto del pool; los subdirectorios conservan los
	//    permisos world-readable del dataset original.
	if _, err := executil.Run(r.Context(), 30*time.Second, "zfs", "clone", body.Snapshot, cloneDS); err != nil {
		writeErr(w, http.StatusInternalServerError, "zfs_error", err.Error())
		return
	}
	// 2. Permisos de solo lectura en la raíz (755, nunca 777): el share ya
	//    será ro a nivel SMB, así que nadie escribe.
	if _, err := executil.Run(r.Context(), 15*time.Second, "chmod", "755", "/mnt/"+cloneDS); err != nil {
		log.Printf("veeam: chmod del clone %s: %v", cloneDS, err)
	}

	// 3. Share SMB de solo lectura vía la capa portátil (TrueNAS midclt o
	//    Samba net conf en Debian/Proxmox).
	if err := s.smbShareCreate(r.Context(), shareName, "/mnt/"+cloneDS, true); err != nil {
		executil.Run(r.Context(), 15*time.Second, "zfs", "destroy", cloneDS) // rollback del clone
		writeErr(w, http.StatusInternalServerError, "smb_error", err.Error())
		return
	}
	// 4. Auditoría de la mutación (la recarga SMB la hace la capa portátil).
	s.act.AuditOnly(r.Context(), actor(r), "veeam.mount_clone", body.Snapshot,
		map[string]any{"clone_ds": cloneDS, "share_name": shareName})

	writeJSON(w, http.StatusOK, map[string]string{
		"share_name": shareName,
		"clone_ds":   cloneDS,
	})
}

// veeamUnmountClone — POST /api/veeam/unmount-clone.
// Elimina el share SMB (por id, vía midclt) y destruye el clone.
func (s *Server) veeamUnmountClone(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ShareName string `json:"share_name"`
		CloneDS   string `json:"clone_ds"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	// Validación antes de tocar el sistema: clone_ds debe ser un dataset
	// válido cuyo último segmento empiece por 'clone_' (evita destruir
	// datasets arbitrarios) y share_name solo alfanumérico/guiones.
	base := body.CloneDS
	if idx := strings.LastIndex(body.CloneDS, "/"); idx >= 0 {
		base = body.CloneDS[idx+1:]
	}
	if !actions.ValidDatasetName(body.CloneDS) ||
		!strings.HasPrefix(base, "clone_") ||
		!regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`).MatchString(body.ShareName) {
		writeErr(w, http.StatusBadRequest, "invalid_input", "Parámetros de desmontaje inválidos")
		return
	}

	// 1. Localizar y borrar el share SMB por nombre (midclt sharing.smb.query).
	// 1. Borrar el share SMB (mejor esfuerzo: un share huérfano se limpia
	//    desde el panel de montajes; un clone sin share quedaría inaccesible).
	if err := s.smbShareDelete(r.Context(), body.ShareName); err != nil {
		log.Printf("veeam: no se pudo borrar el share %s: %v", body.ShareName, err)
	}

	// 2. Destruir el clone (destructivo, confirmado por quien llama).
	if _, err := executil.Run(r.Context(), 30*time.Second, "zfs", "destroy", body.CloneDS); err != nil {
		writeErr(w, http.StatusInternalServerError, "zfs_error", err.Error())
		return
	}

	// 3. Auditoría.
	s.act.AuditOnly(r.Context(), actor(r), "veeam.unmount_clone", body.CloneDS,
		map[string]any{"share_name": body.ShareName})

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
