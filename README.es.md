# EasyZFS

[🇬🇧 English version](README.md) · Licencia: [AGPL-3.0](LICENSE)

App de gestión ZFS que vive **en el propio NAS**: un único binario estático en Go que
envuelve los comandos del sistema (`zpool`, `zfs`, `smartctl`, sensores hwmon), expone
una API REST + SSE (`/api/*`) y sirve la PWA embebida. Corre 24/7 con huella mínima
(objetivo: <30 MB RSS en reposo) y se despliega en LXC Debian + systemd, sin Docker.

Arquitectura (skill `go-collector-stack`):

```
main.go                 wiring: config → db → colectores → scheduler → hub → HTTP
internal/
  config/               env → struct validada
  db/                   SQLite (modernc.org/sqlite, WAL, busy_timeout) + migraciones
  settings/             ajustes (fila JSON única) y umbrales de alertas
  users/                multiusuario, contraseñas argon2id, bootstrap del admin
  auth/                 sesiones cookie HttpOnly token|HMAC-SHA256 + middleware por rol
  collectors/           zpool / smart / sensors / schedsys / mantenimiento / mock (caché en memoria)
  actions/              operaciones ZFS reales (whitelists, confirm, audit_log)
  scheduler/            jobs snapshot/scrub/smart con formato de schedule propio
  alerts/               umbrales (capacidad, temp, SMART, scrub) → tabla alerts + SSE
  hub/                  broker SSE (heartbeat 25 s, X-Accel-Buffering: no)
  httpapi/              handlers REST (leen caché, NUNCA ejecutan CLI)
  model/                tipos del contrato API
  executil/             exec.CommandContext defensivo con timeout
```

Los handlers HTTP **leen la caché de los colectores**; jamás lanzan comandos del
sistema. Las operaciones largas (scrub, resilver, tests SMART) se lanzan como acción
y su progreso se observa en el colector correspondiente, que publica eventos SSE.

## Contrato API

Ver [`docs/api-contract.md`](docs/api-contract.md). Resumen: auth por cookie
`easyzfs_session`; errores `{"error","message"}`; destructivas con
`{"confirm":"<nombre>"}` + registro en `audit_log`; en `DEMO=1` las mutaciones
devuelven 403 `demo_mode`.

## Build (en tu máquina)

Requisitos: Go 1.23+, Node 20+ (solo si compilas el front).

```bash
# 1. Dependencias Go (go.sum ya viene en el repo; tidy solo si cambian deps)
go mod tidy

# 2. Front (opcional: si existe web/, Vite+React → dist/; si no, placeholder)
#    cd web && npm ci && npm run build && cd .. && rm -rf dist && cp -r web/dist dist

# 3. Binario estático (todo en uno: front embebido + backend)
make build           # = web + CGO_ENABLED=0 go build -o easyzfs .
```

Dependencias Go (justificación, regla del skill: 1-3 deps):

- `modernc.org/sqlite` — driver SQLite puro Go: permite `CGO_ENABLED=0` (binario
  estático sin toolchain C en el NAS).
- `golang.org/x/crypto` — `argon2.IDKey` para hashes de contraseña (la stdlib no
  incluye argon2).

## Despliegue (LXC Debian + systemd)

### Instalador interactivo (recomendado)

`deploy/install.sh` automatiza todo: detecta la distro, instala ZFS +
smartmontools si faltan, crea la cuenta de servicio (o modo root con
`--root-mode`), escribe `/etc/easyzfs/env` y la unit de systemd, y verifica el
arranque. Soporta `--binary`, `--source`, `--port`, `--yes` (no interactivo),
`--uninstall` y `DRY_RUN=1` para ensayo sin cambios.

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
visudo -cf /etc/sudoers.d/easyzfs   # validar sintaxis

# /etc/easyzfs/env (chmod 600, root:easyzfs 640):
#   SESSION_SECRET=<cadena-larga-aleatoria>
#   ADMIN_PASSWORD=<solo primer arranque; si falta, se genera y se loguea una vez>
#   LISTEN_ADDR=127.0.0.1:8080   # recomendable si Nginx Proxy Manager vive en el mismo host
#   DB_PATH=/var/lib/easyzfs/app.db
#   COOKIE_SECURE=1        # tras NPM con SSL (cookie Secure)

systemctl daemon-reload && systemctl enable --now easyzfs
journalctl -u easyzfs -f   # primer arranque: anota la contraseña de bootstrap si procede
```

### Privilegios: sudoers limitado (recomendado) o root consciente

El backend necesita ejecutar como root unos pocos binarios (`zpool`, `zfs`,
`smartctl`, `lsblk`, `crontab` — este último solo para leer el crontab de root
en la vista Tareas). `executil` decide automáticamente: si el proceso **no**
corre como root, antepone `sudo -n` a cada comando; si corre como root, los
ejecuta directamente. Override con `EASYZFS_SUDO=0|1` (defecto: auto). Hay dos
opciones de despliegue:

**Opción A — usuario `easyzfs` + sudoers limitado (recomendada).** El servicio
corre sin root y solo puede elevar esos binarios. Es la configuración del
`easyzfs.service` incluido (por eso **no** lleva `NoNewPrivileges=yes`: sudo
necesita el bit setuid). Instala el fichero `deploy/easyzfs.sudoers`:

```bash
install -m 0440 -o root -g root deploy/easyzfs.sudoers /etc/sudoers.d/easyzfs
visudo -cf /etc/sudoers.d/easyzfs
```

Contenido:

```
easyzfs ALL=(root) NOPASSWD: /usr/sbin/zpool, /usr/sbin/zfs, /usr/sbin/smartctl, /usr/sbin/lsblk, /usr/bin/crontab
```

**Opción B — root consciente.** Cambia `User=easyzfs`/`Group=easyzfs` por
`User=root` en el unit (o define `EASYZFS_SUDO=0` si mantienes otro usuario con
permisos suficientes). Es una decisión consciente y documentada para un
appliance cuyo propósito es administrar el sistema, pero cede mucho más que la
opción A.

Si hay proxy delante (NPM/Caddy), SSE ya envía `X-Accel-Buffering: no`; en nginx
añade además `proxy_buffering off` para `/api/events`.

> **Nginx Proxy Manager en el mismo host**: usa `LISTEN_ADDR=127.0.0.1:8080`
> para que el backend solo sea alcanzable a través de NPM, y `COOKIE_SECURE=1`
> en cuanto NPM sirva SSL (la cookie de sesión viajará solo por HTTPS).

## Modo demo y mock

- `DEMO=1` — datos mock realistas (pools `tank`/`ssd`, 7 discos, scrub de `ssd` en
  curso que avanza en vivo por SSE) y **todas las mutaciones devuelven 403
  `demo_mode`**. Ideal para enseñar la app sin riesgo.
- `MOCK=1` — mismos datos mock pero las mutaciones intentan ejecutar los comandos
  reales (fallarán si no hay ZFS). Para desarrollo del front sin host ZFS.

## Configuración (env)

| Var | Defecto | Descripción |
|---|---|---|
| `LISTEN_ADDR` | `:8080` | Dirección de escucha |
| `DB_PATH` | `/var/lib/easyzfs/app.db` | Ruta de la BD SQLite |
| `SESSION_SECRET` | *(efímero)* | Secreto HMAC de sesiones (defínelo en producción) |
| `ADMIN_PASSWORD` | *(generada)* | Contraseña del primer admin (bootstrap) |
| `DEMO` | — | `1` = modo demo (mock + mutaciones bloqueadas) |
| `MOCK` | — | `1` = colectores mock |
| `COOKIE_SECURE` | — | `1` = cookie Secure (tras proxy TLS) |
| `EASYZFS_SUDO` | auto | `1`/`0` fuerza o desactiva `sudo -n` en zpool/zfs/smartctl/lsblk/crontab |
| `RETENTION_DAYS` | `30` | Retención de series (purga diaria 03:30) |

## Retención y mantenimiento

Purga diaria (03:30): series fuera de retención, sesiones expiradas, alertas
reconocidas >90 días, historial de jobs >180 días; checkpoint WAL los domingos.
Los snapshots automáticos del scheduler (`easyzfs-auto-*`) se podan según la
retención de cada job (`7d`, `1m`, `3m`, `1y`).

## Formato de schedule de los jobs

`hourly@:15` · `daily@06:00` · `weekly:sun@03:00` · `monthly:1@02:00`
(horario local del NAS; monthly admite días 1-28).
