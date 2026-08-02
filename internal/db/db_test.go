// db_test.go — las migraciones nuevas (push origin, preferencias, quiet hours
// y cola) aplican limpio sobre una BD creada con versiones anteriores.
package db

import (
	"context"
	"testing"
)

// Una BD que se quedó en la v5 (antes de push origin/preferencias/quiet hours)
// debe migrar a la versión actual sin errores y con todas las tablas/columnas.
func TestMigrateDesdeVersionesAnteriores(t *testing.T) {
	ctx := context.Background()
	d, err := Open(t.TempDir() + "/vieja.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()

	// Simula una instalación antigua: solo las 5 primeras migraciones.
	for i, m := range migrations[:5] {
		if _, err := d.ExecContext(ctx, m); err != nil {
			t.Fatalf("migración inicial %d: %v", i+1, err)
		}
		if _, err := d.ExecContext(ctx, "INSERT INTO migrations(version) VALUES (?)", i+1); err != nil {
			t.Fatalf("registro versión %d: %v", i+1, err)
		}
	}
	// Y con datos preexistentes (la migración no debe romperlos).
	if _, err := d.ExecContext(ctx,
		"INSERT INTO users(user, pass_hash, role) VALUES ('admin','x','admin')"); err != nil {
		t.Fatalf("usuario: %v", err)
	}
	if _, err := d.ExecContext(ctx,
		"INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth) VALUES ('admin','https://push.example.com/x','k','a')"); err != nil {
		t.Fatalf("suscripción previa: %v", err)
	}

	if err := Migrate(ctx, d); err != nil {
		t.Fatalf("Migrate desde v5: %v", err)
	}

	for _, tabla := range []string{"notification_preferences", "notification_quiet_hours", "notification_queue"} {
		var n int
		if err := d.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", tabla).Scan(&n); err != nil {
			t.Fatalf("sqlite_master %s: %v", tabla, err)
		}
		if n != 1 {
			t.Errorf("tabla %s no existe tras migrar", tabla)
		}
	}
	var n int
	if err := d.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM pragma_table_info('push_subscriptions') WHERE name='origin'").Scan(&n); err != nil {
		t.Fatalf("pragma origin: %v", err)
	}
	if n != 1 {
		t.Error("columna push_subscriptions.origin no existe tras migrar")
	}
	// La fila preexistente conserva sus datos y cae al default de origin.
	var origin, endpoint string
	if err := d.QueryRowContext(ctx,
		"SELECT origin, endpoint FROM push_subscriptions").Scan(&origin, &endpoint); err != nil {
		t.Fatalf("select suscripción: %v", err)
	}
	if origin != "" || endpoint != "https://push.example.com/x" {
		t.Errorf("fila previa = (%q,%q), esperado ('',endpoint intacto)", origin, endpoint)
	}
	// Todas las versiones registradas; una segunda pasada no reaplica nada.
	var version int
	if err := d.QueryRowContext(ctx, "SELECT MAX(version) FROM migrations").Scan(&version); err != nil {
		t.Fatalf("max version: %v", err)
	}
	if version != len(migrations) {
		t.Errorf("versión = %d, esperado %d", version, len(migrations))
	}
	if err := Migrate(ctx, d); err != nil {
		t.Fatalf("segunda pasada de Migrate: %v", err)
	}
}

// Desde cero, las FK de las tablas nuevas referencian users(user) con cascada.
func TestTablasNuevasDesdeCero(t *testing.T) {
	ctx := context.Background()
	d, err := Open(t.TempDir() + "/nueva.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	if err := Migrate(ctx, d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := d.ExecContext(ctx,
		"INSERT INTO users(user, pass_hash, role) VALUES ('admin','x','admin')"); err != nil {
		t.Fatalf("usuario: %v", err)
	}
	if _, err := d.ExecContext(ctx,
		"INSERT INTO notification_preferences(user_id, tipo) VALUES ('admin','disk_temp')"); err != nil {
		t.Fatalf("insert preference: %v", err)
	}
	if _, err := d.ExecContext(ctx,
		"INSERT INTO notification_quiet_hours(user_id, quiet_start, quiet_end) VALUES ('admin',22,8)"); err != nil {
		t.Fatalf("insert quiet hours: %v", err)
	}
	if _, err := d.ExecContext(ctx,
		"INSERT INTO notification_queue(user_id, tipo, severity, datos_json) VALUES ('admin','disk_temp','warn','{}')"); err != nil {
		t.Fatalf("insert queue: %v", err)
	}
	// FK con cascada: borrar el usuario limpia sus filas.
	if _, err := d.ExecContext(ctx, "DELETE FROM users WHERE user='admin'"); err != nil {
		t.Fatalf("delete usuario: %v", err)
	}
	for _, tabla := range []string{"notification_preferences", "notification_quiet_hours", "notification_queue"} {
		var n int
		if err := d.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+tabla).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", tabla, err)
		}
		if n != 0 {
			t.Errorf("%s: %d filas huérfanas tras borrar el usuario", tabla, n)
		}
	}
}
