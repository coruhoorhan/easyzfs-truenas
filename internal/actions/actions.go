// Package actions — operaciones ZFS/SMART reales: exec.CommandContext con
// whitelists de nombres, validación de confirm y registro en audit_log.
// Las operaciones largas (scrub, resilver) se LANZAN aquí y se OBSERVAN
// en el colector correspondiente (patrón del skill).
package actions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gnacho/zfsctl/internal/executil"
	"github.com/gnacho/zfsctl/internal/model"
)

// Errores de dominio mapeados a códigos HTTP en httpapi.
var (
	ErrInvalidName   = errors.New("nombre inválido (solo [a-zA-Z0-9_.-/])")
	ErrInvalidDev    = errors.New("dispositivo inválido")
	ErrInvalidTopo   = errors.New("topología inválida")
	ErrInvalidAction = errors.New("acción inválida")
)

// Whitelists de nombres (lección 6 + ejecución segura del skill).
var (
	rePool     = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,64}$`)
	reDataset  = regexp.MustCompile(`^[a-zA-Z0-9_.-]+(/[a-zA-Z0-9_.-]+)*$`)
	reSnapName = regexp.MustCompile(`^[a-zA-Z0-9_.:-]{1,128}$`)
	reDev      = regexp.MustCompile(`^[a-zA-Z0-9_.:-]{1,64}$`) // sdb, nvme0n1, ata-XXX…
)

// ValidTopos — topologías admitidas al crear/añadir vdevs.
var ValidTopos = map[string]bool{
	"stripe": true, "mirror": true, "raidz1": true, "raidz2": true, "raidz3": true,
}

// Service ejecuta operaciones contra el sistema y las audita.
type Service struct {
	db *sql.DB
}

// NewService crea el servicio de acciones.
func NewService(d *sql.DB) *Service {
	return &Service{db: d}
}

// audit registra la acción en audit_log (obligatorio en destructivas).
func (s *Service) audit(ctx context.Context, actor, action, target string, params any, confirmed bool) {
	detail, _ := json.Marshal(params)
	conf := 0
	if confirmed {
		conf = 1
	}
	if _, err := s.db.ExecContext(ctx,
		"INSERT INTO audit_log(ts, actor, action, target, detail, confirmed) VALUES (?,?,?,?,?,?)",
		time.Now().UTC().Format(time.RFC3339), actor, action, target, string(detail), conf); err != nil {
		log.Printf("audit: %v", err)
	}
}

// AuditOnly registra en audit_log acciones administrativas que no ejecutan CLI
// (gestión de usuarios, cambios de ajustes…).
func (s *Service) AuditOnly(ctx context.Context, actor, action, target string, params any) {
	s.audit(ctx, actor, action, target, params, false)
}

// --- Pools ---

// PoolCreate — 'zpool create <name> [topo] <disks...>'.
func (s *Service) PoolCreate(ctx context.Context, actor, name, topo string, disks []string) error {
	if !rePool.MatchString(name) {
		return ErrInvalidName
	}
	if !ValidTopos[topo] {
		return ErrInvalidTopo
	}
	args, err := vdevArgs(topo, disks)
	if err != nil {
		return err
	}
	params := map[string]any{"topo": topo, "disks": disks}
	s.audit(ctx, actor, "pool.create", name, params, true)
	_, err = executil.Run(ctx, 60*time.Second, "zpool",
		append([]string{"create", name}, args...)...)
	if err != nil {
		return fmt.Errorf("crear pool: %w", err)
	}
	return nil
}

// PoolImportList — pools importables ('zpool import' sin args, parseo mejor esfuerzo).
func (s *Service) PoolImportList(ctx context.Context) ([]string, error) {
	out, err := executil.Run(ctx, 15*time.Second, "zpool", "import")
	if err != nil && len(out) == 0 {
		return nil, err
	}
	names := []string{}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "pool:") {
			names = append(names, strings.TrimSpace(strings.TrimPrefix(line, "pool:")))
		}
	}
	return names, nil
}

// PoolImport — 'zpool import <name>'.
func (s *Service) PoolImport(ctx context.Context, actor, name string) error {
	if !rePool.MatchString(name) {
		return ErrInvalidName
	}
	s.audit(ctx, actor, "pool.import", name, nil, false)
	if _, err := executil.Run(ctx, 60*time.Second, "zpool", "import", name); err != nil {
		return fmt.Errorf("importar pool: %w", err)
	}
	return nil
}

// PoolExport — 'zpool export [-f] <name>'; destroy=true → 'zpool destroy' (requiere confirm).
func (s *Service) PoolExport(ctx context.Context, actor, name string, force, destroy bool) error {
	if !rePool.MatchString(name) {
		return ErrInvalidName
	}
	s.audit(ctx, actor, "pool.export", name,
		map[string]any{"force": force, "destroy": destroy}, true)
	if destroy {
		if _, err := executil.Run(ctx, 60*time.Second, "zpool", "destroy", name); err != nil {
			return fmt.Errorf("destruir pool: %w", err)
		}
		return nil
	}
	args := []string{"export"}
	if force {
		args = append(args, "-f")
	}
	args = append(args, name)
	if _, err := executil.Run(ctx, 60*time.Second, "zpool", args...); err != nil {
		return fmt.Errorf("exportar pool: %w", err)
	}
	return nil
}

// Scrub — 'zpool scrub [-p|-s] <pool>'; se observa en el colector zpool.
func (s *Service) Scrub(ctx context.Context, actor, pool, action string) error {
	if !rePool.MatchString(pool) {
		return ErrInvalidName
	}
	args := []string{"scrub"}
	switch action {
	case "start":
	case "pause":
		args = append(args, "-p")
	case "stop":
		args = append(args, "-s")
	default:
		return ErrInvalidAction
	}
	args = append(args, pool)
	s.audit(ctx, actor, "pool.scrub."+action, pool, nil, false)
	if _, err := executil.Run(ctx, 15*time.Second, "zpool", args...); err != nil {
		return fmt.Errorf("scrub %s: %w", action, err)
	}
	return nil
}

// VdevAdd — 'zpool add <pool> [topo] <disks...>'.
func (s *Service) VdevAdd(ctx context.Context, actor, pool, topo string, disks []string) error {
	if !rePool.MatchString(pool) {
		return ErrInvalidName
	}
	if !ValidTopos[topo] {
		return ErrInvalidTopo
	}
	args, err := vdevArgs(topo, disks)
	if err != nil {
		return err
	}
	s.audit(ctx, actor, "pool.vdev.add", pool,
		map[string]any{"topo": topo, "disks": disks}, true)
	_, err = executil.Run(ctx, 60*time.Second, "zpool",
		append([]string{"add", pool}, args...)...)
	if err != nil {
		return fmt.Errorf("añadir vdev: %w", err)
	}
	return nil
}

// Replace — 'zpool replace <pool> <old> <new>'; el resilver se observa en el colector.
func (s *Service) Replace(ctx context.Context, actor, pool, oldDev, newDev string) error {
	if !rePool.MatchString(pool) {
		return ErrInvalidName
	}
	if !reDev.MatchString(oldDev) || !reDev.MatchString(newDev) {
		return ErrInvalidDev
	}
	s.audit(ctx, actor, "pool.replace", pool,
		map[string]any{"old_dev": oldDev, "new_dev": newDev}, true)
	if _, err := executil.Run(ctx, 60*time.Second, "zpool", "replace",
		pool, oldDev, newDev); err != nil {
		return fmt.Errorf("replace: %w", err)
	}
	return nil
}

// vdevArgs traduce topología + lista de discos a argumentos de zpool.
// stripe: discos sueltos; mirror/raidzN: palabra clave + discos.
func vdevArgs(topo string, disks []string) ([]string, error) {
	if len(disks) == 0 {
		return nil, fmt.Errorf("%w: se requiere al menos 1 disco", ErrInvalidDev)
	}
	args := []string{}
	if topo != "stripe" {
		// mirror|raidz1|raidz2|raidz3 son palabras clave válidas de zpool
		args = append(args, topo)
	}
	for _, d := range disks {
		if !reDev.MatchString(d) {
			return nil, ErrInvalidDev
		}
		args = append(args, d)
	}
	return args, nil
}

// --- Datasets ---

// DatasetCreate — 'zfs create [-p] [-o compression=..] [-o quota=..] [-V size] <pool/name>'.
func (s *Service) DatasetCreate(ctx context.Context, actor, pool, name, typ, compression string,
	quota, volsize uint64) error {
	if !rePool.MatchString(pool) || !reDataset.MatchString(name) {
		return ErrInvalidName
	}
	full := pool + "/" + name
	if !reDataset.MatchString(full) {
		return ErrInvalidName
	}
	if compression != "lz4" && compression != "zstd" && compression != "off" {
		return fmt.Errorf("compresión inválida (lz4|zstd|off)")
	}
	args := []string{"create", "-p", "-o", "compression=" + compression}
	if quota > 0 {
		args = append(args, "-o", "quota=" + strconv.FormatUint(quota, 10))
	}
	if typ == "volume" {
		if volsize == 0 {
			return fmt.Errorf("volsize_bytes requerido para type=volume")
		}
		args = append(args, "-V", strconv.FormatUint(volsize, 10))
	} else if typ != "fs" {
		return fmt.Errorf("type inválido (fs|volume)")
	}
	args = append(args, full)
	s.audit(ctx, actor, "dataset.create", full, map[string]any{
		"type": typ, "compression": compression, "quota_bytes": quota, "volsize_bytes": volsize,
	}, false)
	if _, err := executil.Run(ctx, 30*time.Second, "zfs", args...); err != nil {
		return fmt.Errorf("crear dataset: %w", err)
	}
	return nil
}

// DatasetPatch — 'zfs set quota=.. compression=.. <name>'.
func (s *Service) DatasetPatch(ctx context.Context, actor, name string,
	quota *uint64, compression *string) error {
	if !reDataset.MatchString(name) {
		return ErrInvalidName
	}
	props := []string{}
	if quota != nil {
		props = append(props, "quota="+strconv.FormatUint(*quota, 10))
	}
	if compression != nil {
		if *compression != "lz4" && *compression != "zstd" && *compression != "off" {
			return fmt.Errorf("compresión inválida (lz4|zstd|off)")
		}
		props = append(props, "compression="+*compression)
	}
	if len(props) == 0 {
		return nil
	}
	s.audit(ctx, actor, "dataset.patch", name, map[string]any{"props": props}, false)
	for _, p := range props {
		if _, err := executil.Run(ctx, 15*time.Second, "zfs", "set", p, name); err != nil {
			return fmt.Errorf("set %s: %w", p, err)
		}
	}
	return nil
}

// DatasetDelete — 'zfs destroy [-r] <name>' (destructiva: confirm obligatorio fuera).
func (s *Service) DatasetDelete(ctx context.Context, actor, name string, recursive bool) error {
	if !reDataset.MatchString(name) {
		return ErrInvalidName
	}
	s.audit(ctx, actor, "dataset.delete", name,
		map[string]any{"recursive": recursive}, true)
	args := []string{"destroy"}
	if recursive {
		args = append(args, "-r")
	}
	args = append(args, name)
	if _, err := executil.Run(ctx, 60*time.Second, "zfs", args...); err != nil {
		return fmt.Errorf("borrar dataset: %w", err)
	}
	return nil
}

// --- Snapshots ---

// SnapshotCreate — 'zfs snapshot [-r] <dataset>@<name>'.
func (s *Service) SnapshotCreate(ctx context.Context, actor, dataset, name string, recursive bool) error {
	if !reDataset.MatchString(dataset) || !reSnapName.MatchString(name) {
		return ErrInvalidName
	}
	full := dataset + "@" + name
	args := []string{"snapshot"}
	if recursive {
		args = append(args, "-r")
	}
	args = append(args, full)
	s.audit(ctx, actor, "snapshot.create", full, map[string]any{"recursive": recursive}, false)
	if _, err := executil.Run(ctx, 30*time.Second, "zfs", args...); err != nil {
		return fmt.Errorf("crear snapshot: %w", err)
	}
	return nil
}

// SnapshotDelete — 'zfs destroy <dataset>@<snap>' (destructiva).
func (s *Service) SnapshotDelete(ctx context.Context, actor, full string) error {
	ds, snap, ok := strings.Cut(full, "@")
	if !ok || !reDataset.MatchString(ds) || !reSnapName.MatchString(snap) {
		return ErrInvalidName
	}
	s.audit(ctx, actor, "snapshot.delete", full, nil, true)
	if _, err := executil.Run(ctx, 30*time.Second, "zfs", "destroy", full); err != nil {
		return fmt.Errorf("borrar snapshot: %w", err)
	}
	return nil
}

// SnapshotRollback — 'zfs rollback -r <dataset>@<snap>' (destructiva).
func (s *Service) SnapshotRollback(ctx context.Context, actor, full string) error {
	ds, snap, ok := strings.Cut(full, "@")
	if !ok || !reDataset.MatchString(ds) || !reSnapName.MatchString(snap) {
		return ErrInvalidName
	}
	s.audit(ctx, actor, "snapshot.rollback", full, nil, true)
	if _, err := executil.Run(ctx, 60*time.Second, "zfs", "rollback", "-r", full); err != nil {
		return fmt.Errorf("rollback: %w", err)
	}
	return nil
}

// SnapshotPrune — borra snapshots automáticos del dataset más viejos que cutoff.
// Devuelve cuántos se han borrado. Usado por el scheduler (retención).
func (s *Service) SnapshotPrune(ctx context.Context, actor, dataset string, cutoff time.Time) (int, error) {
	out, err := executil.Run(ctx, 15*time.Second, "zfs", "list", "-Hp", "-r",
		"-t", "snapshot", "-o", "name,creation", dataset)
	if err != nil {
		return 0, err
	}
	deleted := 0
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		f := strings.Split(line, "\t")
		if len(f) < 2 {
			continue
		}
		ds, snap, ok := strings.Cut(f[0], "@")
		// El scheduler crea con -r: podar el dataset y todo su árbol.
		inTree := ds == dataset || strings.HasPrefix(ds, dataset+"/")
		if !ok || !inTree || !strings.HasPrefix(snap, model.AutoSnapPrefix) {
			continue
		}
		epoch, _ := strconv.ParseInt(f[1], 10, 64)
		if time.Unix(epoch, 0).After(cutoff) {
			continue
		}
		if _, err := executil.Run(ctx, 30*time.Second, "zfs", "destroy", f[0]); err != nil {
			log.Printf("prune %s: %v", f[0], err)
			continue
		}
		deleted++
	}
	if deleted > 0 {
		s.audit(ctx, actor, "snapshot.prune", dataset,
			map[string]any{"deleted": deleted, "cutoff": cutoff.Format(time.RFC3339)}, false)
	}
	return deleted, nil
}

// --- SMART ---

// SmartTest — 'smartctl -t short|long /dev/<dev>'; el resultado se observa en el colector.
func (s *Service) SmartTest(ctx context.Context, actor, dev, testType string) error {
	if !reDev.MatchString(dev) {
		return ErrInvalidDev
	}
	if testType != "short" && testType != "long" {
		return fmt.Errorf("type inválido (short|long)")
	}
	s.audit(ctx, actor, "disk.smart_test."+testType, dev, nil, false)
	if _, err := executil.Run(ctx, 15*time.Second, "smartctl",
		"-t", testType, "/dev/"+dev); err != nil {
		return fmt.Errorf("smart test: %w", err)
	}
	return nil
}
