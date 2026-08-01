// Package db — apertura SQLite (modernc.org/sqlite), migraciones embebidas y purgas.
package db

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"os"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaV1 string

// migrations — SQL por versión, en orden. Aditivas siempre.
var migrations = []string{
	schemaV1,
	// v2: alertas con objetivo navegable (la UI enlaza a la vista afectada).
	`ALTER TABLE alerts ADD COLUMN target TEXT NOT NULL DEFAULT '';`,
}

// Open abre la BD con WAL, busy_timeout y una sola conexión escritora.
func Open(path string) (*sql.DB, error) {
	dsn := "file:" + path +
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)" +
		"&_pragma=synchronous(NORMAL)&_pragma=cache_size(-8192)"
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	d.SetMaxOpenConns(1) // escrituras serializadas; lecturas rápidas en WAL
	if err := d.Ping(); err != nil {
		d.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	return d, nil
}

// Migrate aplica las migraciones pendientes en orden (cada una en su tx).
func Migrate(ctx context.Context, d *sql.DB) error {
	var version int
	err := d.QueryRowContext(ctx,
		"SELECT COALESCE(MAX(version),0) FROM migrations").Scan(&version)
	if err != nil {
		// La tabla migrations puede no existir todavía: la crea la migración 1.
		version = 0
	}
	for i, m := range migrations {
		v := i + 1
		if v <= version {
			continue
		}
		tx, err := d.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, m); err != nil {
			tx.Rollback()
			return fmt.Errorf("migración %d: %w", v, err)
		}
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO migrations(version) VALUES (?)", v); err != nil {
			tx.Rollback()
			return fmt.Errorf("migración %d (registro): %w", v, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("migración %d (commit): %w", v, err)
		}
	}
	return nil
}

// SizeBytes devuelve el tamaño total de la BD (main + WAL + SHM) para /api/version.
func SizeBytes(path string) int64 {
	var total int64
	for _, p := range []string{path, path + "-wal", path + "-shm"} {
		if st, err := os.Stat(p); err == nil {
			total += st.Size()
		}
	}
	return total
}

// PurgeSeries borra series más viejas que retentionDays.
func PurgeSeries(ctx context.Context, d *sql.DB, retentionDays int) (int64, error) {
	res, err := d.ExecContext(ctx,
		"DELETE FROM series WHERE ts < datetime('now', '-' || ? || ' days')", retentionDays)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// PurgeSessions borra sesiones expiradas.
func PurgeSessions(ctx context.Context, d *sql.DB) error {
	_, err := d.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at < datetime('now')")
	return err
}

// PurgeAlerts borra alertas reconocidas más viejas que days días.
func PurgeAlerts(ctx context.Context, d *sql.DB, days int) error {
	_, err := d.ExecContext(ctx,
		"DELETE FROM alerts WHERE acked_at IS NOT NULL AND ts < datetime('now', '-' || ? || ' days')", days)
	return err
}

// PurgeJobHistory borra historial de jobs más viejo que days días.
func PurgeJobHistory(ctx context.Context, d *sql.DB, days int) error {
	_, err := d.ExecContext(ctx,
		"DELETE FROM job_history WHERE ts < datetime('now', '-' || ? || ' days')", days)
	return err
}

// Checkpoint hace wal_checkpoint(TRUNCATE) (mantenimiento semanal).
func Checkpoint(ctx context.Context, d *sql.DB) error {
	_, err := d.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}
