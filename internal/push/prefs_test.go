// prefs_test.go — preferencias por tipo, quiet hours (encolar + vaciar cola),
// navigate absoluto con origin y estados traducidos en el catálogo ES.
package push

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// Preferencia deshabilitada → el sender omite ese tipo para ese usuario.
func TestPreferenciaDeshabilitadaNoEnvia(t *testing.T) {
	var recibidas atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recibidas.Add(1)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	d := nuevaBD(t)
	s := New(cfgConClaves(t), d, hubFalso{})
	ctx := context.Background()
	p256dh, auth := clavesSub(t)
	if err := s.Subscribe(ctx, "admin", srv.URL+"/push/prefs", p256dh, auth, "es", "", "test"); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if err := s.SetPreference(ctx, "admin", "disk_temp", false); err != nil {
		t.Fatalf("set preference: %v", err)
	}

	// Tipo deshabilitado: no envía.
	s.Notify(ctx, Alert{Level: "warn", Source: "disk.sda", Target: "disks:sda",
		Kind: "disk_temp", Params: map[string]any{"dev": "sda", "temp": 55, "threshold": 50}})
	if recibidas.Load() != 0 {
		t.Fatalf("tipo deshabilitado: envíos = %d, esperado 0", recibidas.Load())
	}
	// Tipo habilitado (default): envía.
	s.Notify(ctx, alertaPrueba())
	if recibidas.Load() != 1 {
		t.Fatalf("tipo habilitado: envíos = %d, esperado 1", recibidas.Load())
	}

	// GET de preferencias refleja lo guardado y los defaults.
	prefs, err := s.Preferences(ctx, "admin")
	if err != nil {
		t.Fatalf("preferences: %v", err)
	}
	if len(prefs) != len(Tipos) {
		t.Fatalf("preferencias = %d, esperado %d", len(prefs), len(Tipos))
	}
	for _, p := range prefs {
		want := p.Tipo != "disk_temp"
		if p.Enabled != want {
			t.Errorf("preferences[%s].Enabled = %v, esperado %v", p.Tipo, p.Enabled, want)
		}
	}
}

// Quiet hours: warn/info dentro de la ventana se encolan; el tick (drainQueue)
// los envía cuando la ventana termina. Las críticas atraviesan el silencio.
func TestQuietHoursEncolaYElTickEnvia(t *testing.T) {
	var recibidas atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recibidas.Add(1)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	d := nuevaBD(t)
	s := New(cfgConClaves(t), d, hubFalso{})
	ctx := context.Background()
	p256dh, auth := clavesSub(t)
	if err := s.Subscribe(ctx, "admin", srv.URL+"/push/quiet", p256dh, auth, "es", "", "test"); err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	// Ventana activa AHORA MISMO en la tz por defecto (Europe/Madrid).
	loc, err := time.LoadLocation(QuietHoursDefaultTZ)
	if err != nil {
		t.Fatalf("tz: %v", err)
	}
	h := time.Now().In(loc).Hour()
	if err := s.SetQuietHours(ctx, "admin", true, h, (h+1)%24); err != nil {
		t.Fatalf("set quiet hours: %v", err)
	}

	// warn dentro de la ventana → encola, no envía.
	s.Notify(ctx, alertaPrueba())
	if recibidas.Load() != 0 {
		t.Fatalf("warn en quiet hours: envíos = %d, esperado 0 (encolado)", recibidas.Load())
	}
	var n int
	if err := d.QueryRow("SELECT COUNT(*) FROM notification_queue WHERE user_id='admin'").Scan(&n); err != nil {
		t.Fatalf("count cola: %v", err)
	}
	if n != 1 {
		t.Fatalf("elementos en cola = %d, esperado 1", n)
	}

	// crit dentro de la ventana → envía SIEMPRE.
	s.Notify(ctx, Alert{Level: "crit", Source: "pool.tank", Target: "pools:tank",
		Kind: "pool_status", Params: map[string]any{"pool": "tank", "status": "DEGRADED"}})
	if recibidas.Load() != 1 {
		t.Fatalf("crit en quiet hours: envíos = %d, esperado 1", recibidas.Load())
	}

	// Termina la ventana → el tick envía lo encolado y vacía la cola.
	if err := s.SetQuietHours(ctx, "admin", false, 0, 0); err != nil {
		t.Fatalf("quiet hours off: %v", err)
	}
	s.drainQueue(ctx)
	if recibidas.Load() != 2 {
		t.Fatalf("tras terminar la ventana: envíos = %d, esperado 2 (cola vaciada)", recibidas.Load())
	}
	if err := d.QueryRow("SELECT COUNT(*) FROM notification_queue WHERE user_id='admin'").Scan(&n); err != nil {
		t.Fatalf("count cola 2: %v", err)
	}
	if n != 0 {
		t.Fatalf("elementos en cola tras el tick = %d, esperado 0", n)
	}
}

// (A5) notification.navigate y url absolutas con el origin guardado; relativo
// como fallback si el origin está vacío o es inválido.
func TestNavigateAbsolutoConOrigin(t *testing.T) {
	a := alertaPrueba()

	p := composePayload("es", "https://zfs.example.com:8443", a)
	if p.URL != "https://zfs.example.com:8443/#/pools" {
		t.Errorf("url = %q, esperada absoluta con origin", p.URL)
	}
	if p.Notification["navigate"] != "https://zfs.example.com:8443/#/pools" {
		t.Errorf("navigate = %v, esperado absoluto con origin", p.Notification["navigate"])
	}

	p = composePayload("es", "", a)
	if p.URL != "/#/pools" || p.Notification["navigate"] != "/#/pools" {
		t.Errorf("sin origin: url=%q navigate=%v, esperado relativo", p.URL, p.Notification["navigate"])
	}
	p = composePayload("en", "javascript:alert(1)", a)
	if p.URL != "/#/pools" {
		t.Errorf("origin inválido: url = %q, esperado fallback relativo", p.URL)
	}

	// El origin viaja por Subscribe: se guarda, el upsert lo actualiza y un
	// re-POST sin origin (pushsubscriptionchange) NO lo pisa.
	d := nuevaBD(t)
	s := New(cfgConClaves(t), d, hubFalso{})
	ctx := context.Background()
	ep := "https://push.example.com/origin"
	if err := s.Subscribe(ctx, "admin", ep, "k1", "a1", "es", "https://zfs.example.com", "ua"); err != nil {
		t.Fatalf("subscribe 1: %v", err)
	}
	var origin string
	if err := d.QueryRow("SELECT origin FROM push_subscriptions WHERE endpoint=?", ep).Scan(&origin); err != nil {
		t.Fatalf("select origin: %v", err)
	}
	if origin != "https://zfs.example.com" {
		t.Errorf("origin guardado = %q", origin)
	}
	// Upsert con otro origin: actualiza.
	if err := s.Subscribe(ctx, "admin", ep, "k1", "a1", "en", "https://nuevo.example.com", "ua"); err != nil {
		t.Fatalf("subscribe 2: %v", err)
	}
	if err := d.QueryRow("SELECT origin FROM push_subscriptions WHERE endpoint=?", ep).Scan(&origin); err != nil {
		t.Fatalf("select origin 2: %v", err)
	}
	if origin != "https://nuevo.example.com" {
		t.Errorf("origin tras upsert = %q, esperado https://nuevo.example.com", origin)
	}
	// Re-POST espontáneo (sin lang ni origin): conserva el guardado.
	if err := s.Subscribe(ctx, "admin", ep, "k1", "a1", "", "", "ua"); err != nil {
		t.Fatalf("subscribe 3: %v", err)
	}
	if err := d.QueryRow("SELECT origin FROM push_subscriptions WHERE endpoint=?", ep).Scan(&origin); err != nil {
		t.Fatalf("select origin 3: %v", err)
	}
	if origin != "https://nuevo.example.com" {
		t.Errorf("origin tras re-POST sin origin = %q, esperado conservado", origin)
	}
}

// (A8) ES traduce los estados de pool; EN los deja tal cual.
func TestEstadosTraducidosES(t *testing.T) {
	params := func(status string) map[string]any {
		return map[string]any{"pool": "tank", "status": status}
	}
	if _, body := catalog("es", "pool_status", params("DEGRADED")); body != "El pool tank está degradado." {
		t.Errorf("ES DEGRADED = %q", body)
	}
	if _, body := catalog("es", "pool_status", params("FAULTED")); body != "El pool tank está fallado." {
		t.Errorf("ES FAULTED = %q", body)
	}
	if _, body := catalog("en", "pool_status", params("DEGRADED")); body != "Pool tank is DEGRADED." {
		t.Errorf("EN DEGRADED = %q", body)
	}
	// Los params del llamador no se mutan.
	p := params("DEGRADED")
	catalog("es", "pool_status", p)
	if p["status"] != "DEGRADED" {
		t.Errorf("params mutados: %v", p)
	}
}
