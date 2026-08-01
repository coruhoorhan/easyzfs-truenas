# zfsctl

ZFS management app that lives **on the NAS itself**: a single static Go binary that
wraps the system commands (`zpool`, `zfs`, `smartctl`, hwmon sensors), exposes a
REST + SSE API (`/api/*`) and serves an embedded PWA. Runs 24/7 with a minimal
footprint (target: <30 MB RSS at rest) and deploys on a Debian LXC + systemd, no
Docker.

[🇪🇸 Versión en castellano](README.es.md) · License: [AGPL-3.0](LICENSE)

## Features

- Pools, datasets, snapshots, disks (SMART), temperatures — live over SSE
- Scheduled jobs: snapshots, scrubs, SMART tests (`zfsctl-auto-*` with per-job retention)
- Multi-user auth (argon2id, roles admin/viewer), session cookies HMAC-SHA256
- Audit log for every mutating action; destructive ops require `{"confirm":"<name>"}`
- Demo mode (`DEMO=1`): realistic mock data, all mutations return 403 — safe to show off
- PWA: installable, dark/light theme, i18n es/en/auto
- Embedded SQLite (WAL) for users, sessions, settings, alerts, series and job history

## Architecture

```
main.go                 wiring: config → db → collectors → scheduler → hub → HTTP
internal/
  config/               env → validated struct
  db/                   SQLite (modernc.org/sqlite, WAL, busy_timeout) + migrations
  settings/             settings (single JSON row) and alert thresholds
  users/                multi-user, argon2id passwords, admin bootstrap
  auth/                 HttpOnly cookie sessions token|HMAC-SHA256 + role middleware
  collectors/           zpool / smart / sensors / maintenance / mock (in-memory cache)
  actions/              real ZFS operations (whitelists, confirm, audit_log)
  scheduler/            snapshot/scrub/smart jobs with custom schedule format
  alerts/               thresholds (capacity, temp, SMART, scrub) → alerts table + SSE
  hub/                  SSE broker (25s heartbeat, X-Accel-Buffering: no)
  httpapi/              REST handlers (read cache, NEVER run CLI)
  model/                API contract types
  executil/             defensive exec.CommandContext with timeout
```

HTTP handlers **read the collectors' cache**; they never run system commands.
Long operations (scrub, resilver, SMART tests) are launched as actions and their
progress is observed via the corresponding collector, which publishes SSE events.

## API contract

See [`docs/api-contract.md`](docs/api-contract.md). Summary: `zfsctl_session`
cookie auth; errors `{"error","message"}`; destructive ops need
`{"confirm":"<name>"}` and are recorded in `audit_log`; under `DEMO=1` mutations
return 403 `demo_mode`.

## Build

Requirements: Go 1.23+, Node 20+ (only if rebuilding the front).

```bash
go mod tidy        # no go.sum in the repo history: generate it here
make build         # = web (vite) + CGO_ENABLED=0 go build -o zfsctl .
```

Go dependencies (kept to 2 on purpose):

- `modernc.org/sqlite` — pure-Go SQLite driver: enables `CGO_ENABLED=0` (static
  binary, no C toolchain needed on the NAS).
- `golang.org/x/crypto` — `argon2.IDKey` for password hashes (stdlib has no argon2).

## Deployment (Debian LXC + systemd)

```bash
install -m 0755 zfsctl /usr/local/bin/zfsctl
useradd -r -s /usr/sbin/nologin zfsctl || true
install -d -o zfsctl -g zfsctl /var/lib/zfsctl
install -m 0644 deploy/zfsctl.service /etc/systemd/system/zfsctl.service

# /etc/zfsctl/env (chmod 640, root:zfsctl):
#   SESSION_SECRET=<long-random-string>
#   ADMIN_PASSWORD=<first boot only; if unset, one is generated and logged once>
#   LISTEN_ADDR=:8080
#   DB_PATH=/var/lib/zfsctl/app.db
#   COOKIE_SECURE=1        # if behind a TLS proxy

systemctl daemon-reload && systemctl enable --now zfsctl
journalctl -u zfsctl -f   # first boot: note the bootstrap password if generated
```

### Privileges: limited sudoers

The service runs as user `zfsctl` (not root) but needs exactly three commands as
root. `/etc/sudoers.d/zfsctl`:

```
zfsctl ALL=(root) NOPASSWD: /usr/sbin/zpool, /usr/sbin/zfs, /usr/sbin/smartctl
```

If a proxy sits in front (NPM/Caddy), SSE already sends `X-Accel-Buffering: no`;
in nginx also add `proxy_buffering off` for `/api/events`.

## Demo and mock modes

- `DEMO=1` — realistic mock data (pools `tank`/`ssd`, 5 disks, a live-progressing
  scrub over SSE) and **all mutations return 403 `demo_mode`**.
- `MOCK=1` — same mock data but mutations try to run the real commands (they will
  fail without ZFS). For frontend development without a ZFS host.

## Configuration (env)

| Var | Default | Description |
|---|---|---|
| `LISTEN_ADDR` | `:8080` | Listen address |
| `DB_PATH` | `/var/lib/zfsctl/app.db` | SQLite DB path |
| `SESSION_SECRET` | *(ephemeral)* | HMAC secret for sessions (set it in production) |
| `ADMIN_PASSWORD` | *(generated)* | First admin password (bootstrap) |
| `DEMO` | — | `1` = demo mode (mock + mutations blocked) |
| `MOCK` | — | `1` = mock collectors |
| `COOKIE_SECURE` | — | `1` = Secure cookie (behind TLS proxy) |
| `RETENTION_DAYS` | `30` | Series retention (daily purge 03:30) |

## Job schedule format

`hourly@:15` · `daily@06:00` · `weekly:sun@03:00` · `monthly:1@02:00`
(NAS local time; monthly accepts days 1-28).
