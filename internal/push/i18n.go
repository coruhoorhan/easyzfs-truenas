// i18n.go — catálogo ES/EN de notificaciones push, compuesto server-side.
// El idioma se lee de push_subscriptions.lang (idioma del dispositivo al
// suscribirse). Las variables ({pool}, {pct}…) se interpolan con params.
package push

import (
	"fmt"
	"strings"
)

// textos — título corto + cuerpo con placeholders {param} por kind de alerta.
type textos struct {
	title string
	body  string
}

var catalogo = map[string]map[string]textos{
	"es": {
		"pool_capacity": {"Capacidad de pool", "El pool {pool} está al {pct}% de capacidad (umbral {threshold}%)."},
		"pool_status":   {"Estado de pool", "El pool {pool} está {status}."},
		"scrub_errors":  {"Scrub con errores", "El scrub de {pool} terminó con {errors} errores."},
		"disk_temp":     {"Disco caliente", "El disco {dev} está a {temp} °C (umbral {threshold} °C)."},
		"smart_status":  {"Aviso SMART", "{dev}: {detail}."},
		"generic":       {"EasyZFS", "Tienes una alerta nueva."},
	},
	"en": {
		"pool_capacity": {"Pool capacity", "Pool {pool} is at {pct}% capacity (threshold {threshold}%)."},
		"pool_status":   {"Pool status", "Pool {pool} is {status}."},
		"scrub_errors":  {"Scrub errors", "Scrub of {pool} finished with {errors} errors."},
		"disk_temp":     {"Hot disk", "Disk {dev} is at {temp} °C (threshold {threshold} °C)."},
		"smart_status":  {"SMART warning", "{dev}: {detail}."},
		"generic":       {"EasyZFS", "You have a new alert."},
	},
}

// estadosES — estados de pool traducidos en el catálogo ES. EN los deja tal
// cual (DEGRADED/FAULTED son los términos de zpool).
var estadosES = map[string]string{
	"DEGRADED": "degradado",
	"FAULTED":  "fallado",
}

// catalog devuelve título y cuerpo interpolados para (lang, kind). Idioma o
// kind desconocido → fallback ('es' / 'generic').
func catalog(lang, kind string, params map[string]any) (title, body string) {
	dict, ok := catalogo[lang]
	if !ok {
		dict = catalogo["es"]
	}
	tx, ok := dict[kind]
	if !ok {
		tx = dict["generic"]
	}
	// ES traduce los estados de pool (DEGRADED→degradado, FAULTED→fallado);
	// EN los deja tal cual. (lang≠"en" siempre resuelve al diccionario ES.)
	if lang != "en" && kind == "pool_status" {
		if traducido, ok2 := estadosES[fmt.Sprint(params["status"])]; ok2 {
			p := make(map[string]any, len(params))
			for k, v := range params {
				p[k] = v
			}
			p["status"] = traducido
			params = p
		}
	}
	return interp(tx.title, params), interp(tx.body, params)
}

// interp sustituye {clave} por el valor de params (fmt.Sprint).
func interp(s string, params map[string]any) string {
	for k, v := range params {
		s = strings.ReplaceAll(s, "{"+k+"}", fmt.Sprint(v))
	}
	return s
}
