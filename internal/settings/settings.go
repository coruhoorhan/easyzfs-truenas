// Package settings — ajustes de la app (fila única JSON en SQLite).
package settings

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
)

// reDataset — mismo whitelist que actions, para validar cada dataset de Veeam.
var reDataset = regexp.MustCompile(`^[a-zA-Z0-9_.-]+(/[a-zA-Z0-9_.-]+)*$`)

// Settings — contrato GET/PUT /api/settings.
type Settings struct {
	Lang              string `json:"lang"` // "auto" | "es" | "en"
	CapWarnPct        int    `json:"cap_warn_pct"`
	CapCritPct        int    `json:"cap_crit_pct"`
	DiskTempC         int    `json:"disk_temp_c"`
	Webhook           string `json:"webhook"`
	NotifyScrubErrors bool   `json:"notify_scrub_errors"`
	NotifySmartChange bool   `json:"notify_smart_change"`
	// Modo demo (regla webapp-stack): permite o no entrar como demo desde el
	// login. El admin lo gestiona en Ajustes → Administración.
	DemoEnabled bool `json:"demo_enabled"`
	// Copia de seguridad automática de la BD (VACUUM INTO en <datadir>/backups)
	BackupEnabled       bool `json:"backup_enabled"`
	BackupFreqHours     int  `json:"backup_freq_hours"`     // 1/6/12/24/48/72
	BackupRetentionDays int  `json:"backup_retention_days"` // 1-30
	// Datasets Veeam que monitoriza el collector (cadenas rotas), separados
	// por coma. 'tank/vmware,tank/backups'
	VeeamDatasets string `json:"veeam_datasets"`
	// Días sin respaldo de una máquina antes de considerar su yedek bayat.
	VeeamStaleDays int `json:"veeam_stale_days"`
	// Máquinas excluidas del aviso de respaldo obsoleto (separadas por coma):
	// p. ej. un equipo que se respalda una sola vez a propósito.
	VeeamIgnore string `json:"veeam_ignore"`
}

// Defaults — ajustes de fábrica.
func Defaults() Settings {
	return Settings{
		Lang:              "auto",
		CapWarnPct:        80,
		CapCritPct:        90,
		DiskTempC:         50,
		Webhook:           "",
		NotifyScrubErrors: true,
		NotifySmartChange: true,
		DemoEnabled:       true,
		BackupEnabled:       true,
		BackupFreqHours:     24,
		BackupRetentionDays: 3,
		VeeamStaleDays:      2,
	}
}

// Store persiste los ajustes en la tabla settings (id=1, JSON).
type Store struct {
	db *sql.DB
}

// NewStore crea el store y asegura la fila de defaults si no existe.
func NewStore(d *sql.DB) (*Store, error) {
	s := &Store{db: d}
	_, err := s.Load(context.Background())
	return s, err
}

// Load lee los ajustes; si no hay fila, inserta y devuelve defaults.
func (s *Store) Load(ctx context.Context) (Settings, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT json FROM settings WHERE id=1").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		st := Defaults()
		if err := s.Save(ctx, st); err != nil {
			return st, err
		}
		return st, nil
	}
	if err != nil {
		return Settings{}, err
	}
	st := Defaults()
	if err := json.Unmarshal([]byte(raw), &st); err != nil {
		return Settings{}, err
	}
	return st, nil
}

// Save valida y persiste los ajustes.
func (s *Store) Save(ctx context.Context, st Settings) error {
	if st.Lang != "auto" && st.Lang != "es" && st.Lang != "en" && st.Lang != "tr" {
		st.Lang = "auto"
	}
	if st.CapWarnPct < 1 || st.CapWarnPct > 100 {
		st.CapWarnPct = 80
	}
	if st.CapCritPct < 1 || st.CapCritPct > 100 {
		st.CapCritPct = 90
	}
	if st.CapWarnPct > st.CapCritPct {
		st.CapWarnPct = st.CapCritPct
	}
	if st.DiskTempC < 20 || st.DiskTempC > 90 {
		st.DiskTempC = 50
	}
	switch st.BackupFreqHours {
	case 1, 6, 12, 24, 48, 72:
	default:
		st.BackupFreqHours = 24
	}
	if st.BackupRetentionDays < 1 || st.BackupRetentionDays > 30 {
		st.BackupRetentionDays = 3
	}
if st.VeeamStaleDays < 1 || st.VeeamStaleDays > 30 {
		st.VeeamStaleDays = 2
	}
	// VeeamDatasets: separados por coma, valida cada uno (mismo whitelist de
	// dataset) y descarta entradas inválidas.
	var cleaned []string
	for _, d := range strings.Split(st.VeeamDatasets, ",") {
		d = strings.TrimSpace(d)
		if d != "" && reDataset.MatchString(d) {
			cleaned = append(cleaned, d)
		}
	}
	st.VeeamDatasets = strings.Join(cleaned, ",")
	// VeeamIgnore: nombres de máquina separados por coma, sin espacios.
	var ig []string
	for _, n := range strings.Split(st.VeeamIgnore, ",") {
		if n = strings.TrimSpace(n); n != "" {
			ig = append(ig, n)
		}
	}
	st.VeeamIgnore = strings.Join(ig, ",")
	raw, err := json.Marshal(st)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		"INSERT INTO settings(id, json) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
		string(raw))
	return err
}
