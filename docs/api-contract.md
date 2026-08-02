# EasyZFS — Contrato API (front ↔ back)

Base: `/api`. Auth: cookie de sesión HttpOnly (`easyzfs_session`), login devuelve el usuario.
Todas las respuestas de error: `{"error":"código","message":"texto legible"}` con HTTP 4xx/5xx.
Acciones destructivas exigen `{"confirm":"<nombre exacto del objetivo>"}` en el body → si falta o no coincide: 400 `confirm_required`.

**Modo demo**: es una sesión mock 100% en cliente (botón "Entrar en modo demo" en el login, sin llamada al backend). Las credenciales reales autenticadas muestran SIEMPRE datos reales: no existe fallback a mock. Opcionalmente, el backend acepta `DEMO=1` para desplegar una instancia pública de demostración completa (colectores mock + mutaciones 403 `{"error":"demo_mode"}`), pero es un modo de despliegue, no de sesión.
Números: bytes en enteros (el front formatea a TiB/GiB con coma es-ES). Fechas: RFC3339 UTC.

## Auth y sesión
- `POST /api/login` `{user, password}` → `{user:"admin", role:"admin"}` + cookie. 401 si credenciales mal. 429 `rate_limited` si se supera el límite (5 intentos/min por IP+usuario; bloqueo 15 min tras 10 fallos consecutivos).
- `POST /api/logout` → 204. Invalida la sesión.
- `GET /api/me` → `{user, role}` o 401.
- `POST /api/me/password` `{current, new}` → 204. Cierra el resto de sesiones del usuario.

## Usuarios (solo admin)
- `GET /api/users` → `[{user, role:"admin"|"user", last_login, sessions}]`
- `POST /api/users` `{user, password, role}` → 201. 409 si existe.
- `DELETE /api/users/{name}` `{confirm}` → 204. No puede borrarse a sí mismo ni al último admin.
- `POST /api/users/{name}/password` `{new, close_sessions?}` → 204 (admin). `close_sessions` por defecto `true` si no se envía.

## Sistema
- `GET /api/version` → `{name:"EasyZFS", version, build, go, os_arch, uptime_sec, rss_bytes, db_bytes, db_path, zfs_version, demo}`
- `GET /api/settings` → `{lang:"auto"|"es"|"en", cap_warn_pct, cap_crit_pct, disk_temp_c, webhook, notify_scrub_errors, notify_smart_change}`
- `PUT /api/settings` (admin) mismo body → 204. 400 `invalid_input` si `cap_warn_pct`/`cap_crit_pct` fuera de 1-100, `warn >= crit` o `disk_temp_c` fuera de 20-90.
- `GET /api/alerts` → `[{id, ts, level:"info"|"warn"|"crit", source, target, message, acked}]`
  - `target` — destino navegable en la UI según la fuente de la alerta: `"pools:<pool>"` (capacidad, DEGRADED/FAULTED, scrub con errores), `"disks:<dev>"` (temperatura, SMART), `"tasks"`, `"settings"`; `""` = sin destino.
- `POST /api/alerts/{id}/ack` → 204.

## Tareas del sistema (cron + systemd timers, solo lectura)
- `GET /api/system-timers` → `{timers:[{source:"systemd"|"cron", name, schedule, next_run, last_run, command, origin}], systemd_available:bool}`
  - Lo que YA existe en el sistema (colector `schedsys`, refresco 5 min; sin systemd/cron devuelve `[]`, nunca error). `systemd_available` = systemctl en PATH + `/run/systemd/system` (la UI oculta el cambio cron→systemd si es false; `POST /api/system-timers/migrate` responde 400 `systemd_unavailable`).
  - systemd: `name` = unidad `.timer`, `command` = unidad activada, `next_run`/`last_run` tal como los devuelve `systemctl list-timers`, `schedule` = `""` (list-timers no expone OnCalendar), `origin` = `"systemctl list-timers"`.
  - cron: `schedule` = expresión cron (`"30 3 * * *"`) o `"@daily"`/`"@hourly"`/… (entradas de `/etc/cron.{hourly,daily,…}`), `command` = comando, `next_run`/`last_run` = `""`, `origin` = `"crontab"`, `"crontab (root)"`, `"/etc/crontab"`, `"/etc/cron.d/<fichero>"`, `"/etc/cron.daily"`…

## Overview (dashboard)
- `GET /api/overview` → `{pools_total, pools_online, cap_used_bytes, cap_total_bytes, snapshots_total, jobs_active, last_scrub:{pool, ts, errors}, alerts:[…últimas 3], activity:[{ts, text, detail}…últimas 10]}`

## Pools
- `GET /api/pools` → `[{name, status:"ONLINE"|"DEGRADED"|"FAULTED", topo, used_bytes, total_bytes, frag_pct, comp_ratio, scrub:{state:"none"|"running"|"done", pct, eta_sec, ts, errors}, vdevs:[{dev, role, status, temp_c}]}]`
- `POST /api/pools` `{name, topo:"stripe"|"mirror"|"raidz1"|"raidz2"|"raidz3", disks:[…], confirm}` → 202 (job). `confirm` = nombre del pool.
- `POST /api/pools/import` `{name?}` → lista importables si sin name; con name importa.
- `POST /api/pools/{name}/scrub` `{action:"start"|"pause"|"stop"}` → 202
- `POST /api/pools/{name}/export` `{confirm, force, destroy}` → 202
- `POST /api/pools/{name}/vdev` `{topo, disks:[…], confirm}` → 202 (añadir vdev). `confirm` = nombre del pool.
- `POST /api/pools/{name}/replace` `{old_dev, new_dev, confirm}` → 202. `confirm` = nombre del pool.

## Datasets
- `GET /api/datasets` → `[{name, type:"fs"|"volume", compression, used_bytes, avail_bytes, quota_bytes, mountpoint}]`
- `POST /api/datasets` `{pool, name, type:"fs"|"volume", compression:"lz4"|"zstd"|"off", quota_bytes, volsize_bytes?}` → 201
- `PATCH /api/datasets/{name}` `{quota_bytes?, compression?}` → 204
- `DELETE /api/datasets/{name}` `{confirm, recursive}` → 202

## Snapshots
- `GET /api/snapshots?dataset=` → agrupado: `[{dataset, snaps:[{name, full, ts, used_bytes, kind:"auto"|"manual"}]}]`
- `POST /api/snapshots` `{dataset, name, recursive}` → 201
- `DELETE /api/snapshots/{full}` `{confirm}` → 204 (`full` = `tank/docs@snap`, URL-encoded)
- `POST /api/snapshots/{full}/rollback` `{confirm}` → 202

## Jobs (tareas programadas)
- `GET /api/jobs` → `[{id, tipo:"snapshot"|"scrub"|"trim"|"smart_short"|"smart_long", target, schedule, retention, enabled, last_run, last_result, next_run}]`
  - `schedule` formato propio: `hourly@:15`, `daily@06:00`, `weekly:sun@03:00`, `monthly:1@02:00`
- `POST /api/jobs` `{tipo, target, schedule, retention?}` → 201
- `PATCH /api/jobs/{id}` `{enabled?, schedule?, retention?}` → 204
- `DELETE /api/jobs/{id}` `{confirm}` → 204
- `POST /api/jobs/{id}/run` → 202
- `GET /api/jobs/history` → `[{ts, tipo, target, ok, detail}]`

## Discos
- `GET /api/disks` → `[{dev, model, serial, size_bytes, temp_c:number|null, smart:"ok"|"warn"|"crit"|"unknown", smart_detail, pool, hours}]`
  - Solo dispositivos físicos: whitelist `sd[a-z]+`, `hd[a-z]+`, `vd[a-z]+`, `xvd[a-z]+`, `nvmeNnM`, `mmcblkN`. Excluidos siempre: `zd*` (zvols), `loop*`, `ram*`, `dm-*`, `sr*`, `fd*`, `mmcblk*boot*`, `mmcblk*rpmb`.
  - `temp_c: null` = sin lectura (eMMC, USB sin SAT, smartctl no disponible); `null` no es lo mismo que `0`. El front muestra "—".
  - `smart:"unknown"` + `smart_detail:"no disponible"` cuando el disco no habla smartctl: no es un error.
- `POST /api/disks/{dev}/smart-test` `{type:"short"|"long"}` → 202

## Notificaciones push (Web Push)
Los endpoints de suscripción devuelven 503 `push_not_configured` si el servidor no tiene claves VAPID. El texto de las notificaciones se compone server-side (ES/EN) según el `lang` guardado en la suscripción.
- `GET /api/push/vapid-public-key` → `{publicKey}` para `pushManager.subscribe()`.
- `POST /api/push/subscribe` `{endpoint, keys:{p256dh, auth}, lang?, origin?}` → 204. Upsert por `endpoint` (re-suscripciones y rotaciones actualizan la fila y reasignan `user_id`).
  - `lang` — `"es"|"en"`; ausente/desconocido no pisa el guardado.
  - `origin` — `window.location.origin` del navegador (p. ej. `https://zfs.example.com`). El servidor compone con él `url` y `notification.navigate` ABSOLUTAS en el payload (Declarative Web Push las exige); vacío = fallback a relativa. El upsert lo actualiza.
  - 400 `invalid_endpoint` (no https://), 400 `invalid_keys` (p256dh debe ser base64url de 65 bytes y auth base64url de 16 bytes), 400 `invalid_origin` (no http(s)://).
- `DELETE /api/push/unsubscribe` `{endpoint}` → 204. Solo borra suscripciones del propio usuario.
- `GET /api/push/preferences` → `{preferences:[{tipo, enabled}]}`. Los 5 tipos del catálogo (`pool_capacity`, `pool_status`, `scrub_errors`, `disk_temp`, `smart_status`), siempre presentes; `enabled` por defecto `true` si no hay fila guardada.
- `PUT /api/push/preferences` `{tipo, enabled}` → 204. Upsert por `(usuario, tipo)`. 400 `invalid_tipo` si el tipo es desconocido.
- `GET /api/push/quiet-hours` → `{enabled, start, end, tz}`. `start`/`end` son `null` cuando `enabled:false`. `tz` fija de momento: `Europe/Madrid`.
- `PUT /api/push/quiet-hours` `{enabled, start, end}` → 204. `start`/`end`: hora local 0-23; la ventana puede cruzar medianoche (22 → 8). 400 `invalid_hours` si fuera de 0-23 o `start == end`.
  - Efecto en el envío: las críticas atraviesan el horario silencioso SIEMPRE; warn/info dentro de la ventana se encolan (`notification_queue`) y se entregan al terminar (ticker de 60 s).

## SSE (tiempo real)
- `GET /api/events` — stream `text/event-stream`, heartbeat `:ping` cada 25 s, cabecera `X-Accel-Buffering: no`.
  Eventos (`event:` / `data:` JSON):
  - `pool.status` `{name, status}` · `scrub.progress` `{pool, pct, eta_sec}`
  - `disk.temp` `{dev, temp_c}` · `alert.new` `{alert}` · `job.finished` `{id, ok, detail}`
  - `overview` (cambios agregados para refrescar KPIs)
