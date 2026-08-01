// Package config — env → struct validada. Fallo aquí = exit 1 con mensaje claro.
package config

import (
	"crypto/rand"
	"crypto/sha256"
	"log"
	"os"
	"strconv"
)

// Config — configuración de la app (todo por variables de entorno).
type Config struct {
	ListenAddr    string // LISTEN_ADDR (def ":8080")
	DBPath        string // DB_PATH (def "/var/lib/easyzfs/app.db")
	SessionSecret []byte // SESSION_SECRET (sha256 del valor; si falta, efímero + aviso)
	Demo          bool   // DEMO=1 → datos mock + mutaciones 403 demo_mode
	Mock          bool   // MOCK=1 → colectores mock (datos reales mutan y fallarán)
	AdminPassword string // ADMIN_PASSWORD para bootstrap del primer admin
	CookieSecure  bool   // COOKIE_SECURE=1 → atributo Secure (tras proxy TLS)
	RetentionDays int    // RETENTION_DAYS series (def 30)
}

// Load lee y valida la configuración. No falla: valores por defecto sensatos + avisos.
func Load() *Config {
	cfg := &Config{
		ListenAddr:    env("LISTEN_ADDR", ":8080"),
		DBPath:        env("DB_PATH", "/var/lib/easyzfs/app.db"),
		Demo:          envBool("DEMO"),
		Mock:          envBool("MOCK"),
		AdminPassword: os.Getenv("ADMIN_PASSWORD"),
		CookieSecure:  envBool("COOKIE_SECURE"),
		RetentionDays: envInt("RETENTION_DAYS", 30),
	}
	if cfg.Demo {
		cfg.Mock = true // demo implica colectores mock
	}
	secret := os.Getenv("SESSION_SECRET")
	if secret == "" {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			log.Fatalf("no se pudo generar SESSION_SECRET efímero: %v", err)
		}
		cfg.SessionSecret = b
		log.Println("aviso: SESSION_SECRET no definido; usando secreto efímero (las sesiones no sobreviven a reinicios)")
	} else {
		sum := sha256.Sum256([]byte(secret))
		cfg.SessionSecret = sum[:]
	}
	return cfg
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envBool(key string) bool {
	v := os.Getenv(key)
	return v == "1" || v == "true" || v == "yes"
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}
