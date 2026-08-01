# EasyZFS

ZFS management app that lives **on the NAS itself**: a single static Go binary that
wraps the system commands (`zpool`, `zfs`, `smartctl`, hwmon sensors), exposes a
REST + SSE API (`/api/*`) and serves an embedded PWA. Runs 24/7 with a minimal
footprint and deploys on a Debian LXC + systemd, no Docker.

[🇪🇸 Versión en castellano](README.es.md) · License: [AGPL-3.0](LICENSE)

## Features

- Pools, datasets, snapshots, disks (SMART), temperatures — live over SSE
- Scheduled jobs: snapshots, scrubs, SMART tests (`easyzfs-auto-*` with per-job retention)
- System tasks view: systemd timers + cron (read-only)
- Physical-disk inventory filter: zvols, loop, eMMC boot partitions and other
  pseudo-devices are hidden; eMMC/USB without SAT report SMART as "unknown"
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
  collectors/           zpool / smart / sensors / schedsys / maintenance / mock (in-memory cache)
  actions/              real ZFS operations (whitelists, confirm, audit_log)
  scheduler/            snapshot/scrub/smart jobs with custom schedule format
  alerts/               thresholds (capacity, temp, SMART, scrub) → alerts table + SSE
  hub/                  SSE broker (25s heartbeat, X-Accel-Buffering: no)
  httpapi/              REST handlers (read cache, NEVER run CLI)
  model/                API contract types
  executil/             defensive exec.CommandContext with timeout (auto sudo -n if not root)
```

HTTP handlers **read the collectors' cache**; they never run system commands.
Long operations (scrub, resilver, SMART tests) are launched as actions and their
progress is observed via the corresponding collector, which publishes SSE events.

## API contract

See [`docs/api-contract.md`](docs/api-contract.md). Summary: `easyzfs_session`
cookie auth; errors `{"error","message"}`; destructive ops need
`{"confirm":"<name>"}` and are recorded in `audit_log`; under `DEMO=1` mutations
return 403 `demo_mode`.

## Build

Requirements: Go 1.23+, Node 20+ (only if rebuilding the front).

```bash
go mod tidy        # go.sum is committed; tidy only if deps change
make build         # = web (vite) + CGO_ENABLED=0 go build -o easyzfs .
```

Go dependencies (kept to 2 on purpose):

- `modernc.org/sqlite` — pure-Go SQLite driver: enables `CGO_ENABLED=0` (static
  binary, no C toolchain needed on the NAS).
- `golang.org/x/crypto` — `argon2.IDKey` for password hashes (stdlib has no argon2).

## Deployment (Debian LXC + systemd)

### Interactive installer (recommended)

`deploy/install.sh` automates everything: detects the distro, installs ZFS +
smartmontools if missing, creates the service account (or root mode with
`--root-mode`), writes `/etc/easyzfs/env` and the systemd unit, and verifies
startup. Supports `--binary`, `--source`, `--port`, `--yes` (non-interactive),
`--uninstall` and `DRY_RUN=1` for a no-changes rehearsal.

```bash
bash deploy/install.sh --binary ./easyzfs --yes
```

### Manual

```bash
install -m 0755 easyzfs /usr/local/bin/easyzfs
useradd -r -s /usr/sbin/nologin easyzfs || true
install -d -o easyzfs -g easyzfs /var/lib/easyzfs
install -m 0644 deploy/easyzfs.service /etc/systemd/system/easyzfs.service
install -m 0440 -o root -g root deploy/easyzfs.sudoers /etc/sudoers.d/easyzfs
visudo -cf /etc/sudoers.d/easyzfs   # validate syntax

# /etc/easyzfs/env (chmod 600, root:easyzfs 640):
#   SESSION_SECRET=<long-random-string>
#   ADMIN_PASSWORD=<first boot only; if unset, one is generated and logged once>
#   LISTEN_ADDR=127.0.0.1:8080   # recommended if Nginx Proxy Manager lives on the same host
#   DB_PATH=/var/lib/easyzfs/app.db
#   COOKIE_SECURE=1        # once NPM serves SSL (Secure cookie)

systemctl daemon-reload && systemctl enable --now easyzfs
journalctl -u easyzfs -f   # first boot: note the bootstrap password if generated
```

### Privileges: limited sudoers (recommended) or conscious root

The backend needs to run a handful of binaries as root (`zpool`, `zfs`,
`smartctl`, `lsblk`, `crontab` — the last one only to read root's crontab for
the Tasks view). `executil` decides automatically: if the process does **not**
run as root, it prepends `sudo -n` to every command; as root it runs them
directly. Override with `EASYZFS_SUDO=0|1` (default: auto). Two deployment
options:

**Option A — `easyzfs` user + limited sudoers (recommended).** The service
runs unprivileged and can only elevate those binaries. This is the bundled
`easyzfs.service` setup (which is why it does **not** set
`NoNewPrivileges=yes`: sudo needs the setuid bit). Install
`deploy/easyzfs.sudoers`:

```
easyzfs ALL=(root) NOPASSWD: /usr/sbin/zpool, /usr/sbin/zfs, /usr/sbin/smartctl, /usr/sbin/lsblk, /usr/bin/crontab
```

**Option B — conscious root.** Change `User=easyzfs`/`Group=easyzfs` to
`User=root` in the unit (or set `EASYZFS_SUDO=0` with another sufficiently
privileged user). A conscious, documented choice for an appliance whose purpose
is administering the system, but it grants far more than option A.

If a proxy sits in front (NPM/Caddy), SSE already sends `X-Accel-Buffering: no`;
in nginx also add `proxy_buffering off` for `/api/events`.

> **Nginx Proxy Manager on the same host**: use `LISTEN_ADDR=127.0.0.1:8080` so
> the backend is only reachable through NPM, and `COOKIE_SECURE=1` once NPM
> serves SSL (the session cookie will travel over HTTPS only).

## Demo and mock modes

- `DEMO=1` — realistic mock data (pools `tank`/`ssd`, 7 disks, a live-progressing
  scrub over SSE) and **all mutations return 403 `demo_mode`**.
- `MOCK=1` — same mock data but mutations try to run the real commands (they will
  fail without ZFS). For frontend development without a ZFS host.

## Configuration (env)

| Var | Default | Description |
|---|---|---|
| `LISTEN_ADDR` | `:8080` | Listen address |
| `DB_PATH` | `/var/lib/easyzfs/app.db` | SQLite DB path |
| `SESSION_SECRET` | *(ephemeral)* | HMAC secret for sessions (set it in production) |
| `ADMIN_PASSWORD` | *(generated)* | First admin password (bootstrap) |
| `DEMO` | — | `1` = demo mode (mock + mutations blocked) |
| `MOCK` | — | `1` = mock collectors |
| `COOKIE_SECURE` | — | `1` = Secure cookie (behind TLS proxy) |
| `EASYZFS_SUDO` | auto | `1`/`0` forces or disables `sudo -n` on zpool/zfs/smartctl/lsblk/crontab |
| `RETENTION_DAYS` | `30` | Series retention (daily purge 03:30) |

## Job schedule format

`hourly@:15` · `daily@06:00` · `weekly:sun@03:00` · `monthly:1@02:00`
(NAS local time; monthly accepts days 1-28).
