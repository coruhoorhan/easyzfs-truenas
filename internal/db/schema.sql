-- Esquema zfsctl v1 (basado en go-collector-stack). Migraciones aditivas: nunca DROP en producción.
-- Fechas en RFC3339 UTC escritas desde Go (el contrato API exige RFC3339).

CREATE TABLE IF NOT EXISTS migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Usuarios (multiusuario con roles admin/user; hash argon2id en formato PHC)
CREATE TABLE IF NOT EXISTS users (
  user       TEXT PRIMARY KEY,
  pass_hash  TEXT NOT NULL,
  role       TEXT NOT NULL CHECK(role IN ('admin','user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);

-- Sesiones (auth cookie token|HMAC-SHA256)
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user       TEXT NOT NULL REFERENCES users(user) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user);

-- Series temporales genéricas (temperaturas, uso de pool…). Toda serie tiene retención.
CREATE TABLE IF NOT EXISTS series (
  id     INTEGER PRIMARY KEY,
  source TEXT NOT NULL,        -- 'disk.sda.temp', 'pool.tank.used_pct'…
  ts     TEXT NOT NULL DEFAULT (datetime('now')),
  value  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_series_source_ts ON series(source, ts);

-- Tareas programadas (snapshots, scrubs, tests SMART…)
CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY,
  tipo        TEXT NOT NULL,     -- 'snapshot' | 'scrub' | 'smart_short' | 'smart_long'
  target      TEXT NOT NULL,     -- 'tank/documentos', 'tank', 'all'…
  schedule    TEXT NOT NULL,     -- formato propio: 'daily@06:00', 'weekly:sun@03:00'…
  retention   TEXT,              -- solo snapshots: '7d', '1m', '3m', '1y'
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run    TEXT,
  last_result TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historial de ejecuciones de jobs
CREATE TABLE IF NOT EXISTS job_history (
  id      INTEGER PRIMARY KEY,
  ts      TEXT NOT NULL,
  job_id  INTEGER,
  tipo    TEXT NOT NULL,
  target  TEXT NOT NULL,
  ok      INTEGER NOT NULL,
  detail  TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_history_ts ON job_history(ts);

-- Auditoría de acciones (OBLIGATORIA para destructivas: destroy, rollback, export…)
CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY,
  ts        TEXT NOT NULL,
  actor     TEXT NOT NULL DEFAULT '',
  action    TEXT NOT NULL,       -- 'pool.export', 'snapshot.rollback', 'dataset.delete'…
  target    TEXT NOT NULL,
  detail    TEXT,                -- JSON con parámetros
  confirmed INTEGER NOT NULL     -- 1 si llegó {"confirm":"<target>"} correcto
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);

-- Alertas generadas (umbrales, SMART, errores ZFS)
CREATE TABLE IF NOT EXISTS alerts (
  id       INTEGER PRIMARY KEY,
  ts       TEXT NOT NULL,
  level    TEXT NOT NULL,        -- 'info' | 'warn' | 'crit'
  source   TEXT NOT NULL,
  message  TEXT NOT NULL,
  acked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts);

-- Ajustes de la app: fila única con JSON (ver internal/settings)
CREATE TABLE IF NOT EXISTS settings (
  id   INTEGER PRIMARY KEY CHECK(id = 1),
  json TEXT NOT NULL
);
