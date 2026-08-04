# EasyZFS — Auditoría técnica y hoja de ruta
Fecha: 4-Ago-2026 · commit base: v2.2.6-6 (rama feat/demo-gate-activity-settings)
Autor: Hermes Agent (auditoría encargada por nacho)

## 1. Resumen ejecutivo

EasyZFS es un monolito Go bien construido (~11.000 LOC de Go + ~8.300 de
TS/TSX) con una base de código sana: pocas dependencias, tests en todos los
paquetes críticos (~3.800 LOC de tests), i18n completo ES/EN, y decisiones de
arquitectura deliberadas y documentadas. No hay deuda estructural grave. Los
hallazgos principales son: dos bugs reales encontrados y corregidos en esta
auditoría (sección 4), un frontend con bundle mejorable, y un gap funcional
claro en notificaciones (email) y en la skill de webhooks/API.

## 2. Auditoría de stack y librerías

### Backend (Go)
| Componente | Versión | Valoración |
|---|---|---|
| Go | 1.23 (toolchain 1.23.10) | Actualizable a 1.26.x — el toolchain ya está disponible; sin prisa, 1.23 sigue soportado |
| modernc.org/sqlite | v1.34.5 | Decisión excelente: binario 100% estático (CGO_ENABLED=0), cero libc del sistema. Es la opción correcta para self-hosted |
| golang.org/x/crypto | v0.36.0 | argon2id (m=64MiB, t=3, p=2) — parámetros razonables para un LXC modesto; el semáforo de 2 verificaciones acota memoria |
| SherClockHolmes/webpush-go | v1.4.0 | Fork comunitario de webpush-go. Riesgo moderado: fork mantenido por un solo autor. Mitigación: es código pequeño y estable; alternativa: volver a github.com/SherClockHolmes si se abandona |
| Indirectas | 8 | Todas arrastradas por modernc.org/sqlite — inevitables con ese driver |

Total: 3 dependencias directas. Excelente para la superficie de ataque.
go.sum tiene 115 líneas (mayormente modernc). Sin dependencias muertas.

### Frontend (web/)
| Componente | Versión | Valoración |
|---|---|---|
| React | 19.1 | Al día. React 19 es estable desde dic-2024 |
| Vite | 6.3.5 | Al día (Vite 7 existe, migración opcional) |
| TypeScript | 5.8.3 | Al día |
| tailwindcss | 3.4.17 | Instalado como devDep pero el CSS es a mano (index.css) — verificar si realmente se usa; si no, es peso muerto en el build |
| Fontsource | space-grotesk + jetbrains-mono | Self-hosted: correcto para offline/LAN |

Sin router (SPA con estado), sin librería de estado (context propio), sin
fetcher externo (fetch plano con ApiError). Decisiones acertadas para el
tamaño: cero lock-in, bundle contenido.

### Peso del bundle
index.js sale en 369 KB (112 KB gzip) y Vite avisa (>320 KB). Es el único
aviso del build. Causa probable: React 19 + fuentes + todo el estado de la
app en el chunk raíz. Se puede partir con manualChunks (react-dom separado)
sin cambiar nada de código. Ver roadmap P2.

## 3. Decisiones técnicas — valoración

| Decisión | Veredicto |
|---|---|
| Monolito Go + SQLite embebido + dist embebido (go:embed) | Correcta. Un solo binario, despliegue trivial, coherente con la filosofía AGPL/anti-cloud |
| modernc.org/sqlite (pure Go) | Correcta. CGO_ENABLED=0 = binario estático portable |
| Auth propia con cookies HttpOnly + argon2id + rate limiter por IP+usuario | Correcta y bien implementada (dummy hash anti-timing, semáforo argon) |
| SSE para tiempo real + Web Push para app cerrada | Correcta. La separación (push solo sin sesión SSE activa, crit siempre) está bien pensada |
| Datos por env, nada en el repo | Correcta (config.go: 15 variables, todas con default sensato) |
| Sin ORM (SQL directo) | Correcta para este tamaño; las queries son simples y están acotadas |
| i18n ES/EN desde el día 1, también en push | Correcta y poco habitual — se mantiene bien (dicts paralelos) |
| UI sin framework CSS | Correcta (control total, ~70KB CSS total), pero exige disciplina — la tiene |
| dist/ versionado en git | Aceptable (permite clonar y compilar sin npm) pero genera ruido en commits; alternativa: release con binario + dist, y dist fuera de git |

## 4. Fallos encontrados (y su estado)

### Corregidos en esta auditoría
1. **PUT /api/settings descartaba la configuración de backups.** `settingsBody`
   no tenía backup_enabled/freq/retention: el switch "Respaldos automáticos"
   de la UI se veía activado pero nunca se persistía (silencioso). FIX:
   campos añadidos al body y aplicados en putSettings. Commit df720ba.
2. **Las alertas críticas podían silenciarse por preferencia de tipo.** La UI
   promete "las críticas siempre llegan", pero `prefEnabled` omitía por tipo
   incluso las crit (p. ej. preset "Ninguna" silenciaba un pool FAULTED).
   FIX: las crit atraviesan siempre las preferencias por tipo. Commit 67f4d94.
3. **El modo demo no era gestionable.** Era un flag de build (DEMO=1). Ahora
   es un ajuste del admin (demo_enabled, default true) con endpoint público
   GET /api/public/demo que el login consulta para mostrar u ocultar el
   botón. Commits df720ba + 992e976.

### Pendientes (no bloqueantes)
4. **sw.js no cachea la app.** Solo gestiona push. Al actualizar el servidor,
   el navegador se entera al recargar (index.html y sw.js son no-cache, main.go
   lo hace bien), pero no hay update proactivo del SW. Con un SW de caché
   (skipWaiting + clientsClaim) la actualización sería transparente. Ver P2.
5. **activityEntry mezcla actor y target en un string.** El audit_log guarda
   columnas separadas pero el endpoint las concatena ("admin · settings"); el
   frontend no puede filtrar por actor. Menor.
6. **getOverview y listActivity devuelven la misma actividad** (overview solo
   da 10, /api/activity hasta 500). Bien, pero sin cursor de paginación: con
   audit_log grande, limit=500 sin offset es un techo. Menor.

## 5. Seguridad

- Contraseñas: argon2id con parámetros documentados, dummy hash para usuarios
  inexantes (anti-timing), semáforo de memoria. Bien.
- Sesiones: cookie HttpOnly, SameSite=Lax, expiración en BD, purge periódico.
  Bien. Falta menor: SESSION_SECRET efímero si no se define (aviso en log,
  correcto, pero el instalador debería generarlo siempre).
- Rate limiting en login por IP+usuario. Bien. Falta: no hay límite en el
  resto de mutaciones (un cliente malicioso autenticado puede martillear
  POST /api/pools). Riesgo bajo (requiere credenciales válidas).
- CSRF: SameSite=Lax protege razonablemente; sin token CSRF explícito. Para
  una app LAN self-hosted es aceptable; si algún día se expone a internet,
  añadir Origin check.
- audit_log cubre todas las mutaciones. Bien.
- Sin secretos en el repo (verificado: VAPID y SESSION_SECRET vienen de env).

## 6. Auditoría de skills (webhooks, API, email)

Las skills de opencode relevantes para el stack de nacho:

| Skill | Estado | Nota |
|---|---|---|
| api-stack | Desfasada para EasyZFS | Asume Hono 4 + better-sqlite3 + zod (stack Node). EasyZFS es Go puro: la skill no le aplica. Sirve para NetPulse/Deltos/etc |
| web-push-alerts | Aprovechada | EasyZFS la implementa bien (VAPID, quiet hours, i18n, modo demo). La skill asume Node pero los conceptos se portaron |
| webhooks | NO EXISTE | No hay skill de webhooks. EasyZFS tiene un webhook saliente básico (POST JSON a una URL) en alerts.go. Falta: reintentos, firma HMAC, plantillas, destinos múltiples |
| email | NO EXISTE | No hay skill de email/SMTP. Es el gap funcional más pedido en self-hosted ("avísame por correo"). Falta todo: SMTP config, plantillas, rate-limit de envío |

Recomendación: crear dos skills nuevas — `webhook-out` (entrega fiable de
webhooks con HMAC + reintentos, aplicable a todas las apps del stack) y
`email-notifications` (SMTP + plantillas i18n ES/EN). Ambas encajan con la
filosofía del stack (sin SaaS, configurable por env, i18n desde el día 1).

## 7. Hoja de ruta propuesta

### P1 — próximas versiones (valor alto, esfuerzo bajo)
1. **Notificaciones por email (SMTP).** El campo webhook ya acepta
   "correo@dominio.es" como placeholder pero no envía correo. Implementar:
   SMTP_HOST/PORT/USER/PASS/FROM por env, plantillas ES/EN, un correo por
   alerta (o digest horario), rate-limit. Es la funcionalidad más demandada
   en self-hosted.
2. **Webhooks robustos.** Firma HMAC-SHA256 (secret por env), reintentos con
   backoff (3 intentos), timeout configurable, log de entregas fallidas.
3. **Update-check del SW.** Cache de assets con skipWaiting+clientsClaim para
   que el despliegue nuevo se active sin refresh manual (la petición original
   lo pedía: "que se actualice bien sin necesidad de refrescar").
4. **Check semanal de releases ya implementado** (esta auditoría): el ribbon
   muestra info + Actualizar + Cerrar, y hay botón manual en Acerca de.

### P2 — medio plazo
5. **Partir el bundle** (manualChunks: react-dom, i18n, vistas). El warning
   de Vite (>320KB) se quita sin tocar lógica.
6. **Activity con paginación real** (cursor keyset) y agrupación por día
   (el mockup de ajustes-shell ya lo dibuja con acordeones "Hoy/Ayer").
7. **Quitar tailwindcss** de devDeps si no se usa (peso muerto).
8. **CSRF: doble check de Origin/Referer** en mutaciones, por si algún día
   se expone fuera de LAN.
9. **Migrar a Go 1.26** cuando se quiera; ganar 2 años de soporte.

### P3 — ideas
10. **OIDC/LDAP opcional** para integrarse con SSO doméstico (Authentik).
11. **Exportar alertas a Loki/Prometheus** (métricas de salud).
12. **Multi-pool remoto:** gestionar varios hosts desde una sola instancia
    (agentes ligeros que reportan por SSH/tunnel), el siguiente paso lógico
    para escalar de "mi servidor" a "mi granja".

## 8. Cambios entregados en esta sesión (rama feat/demo-gate-activity-settings)

- df720ba feat(api): modo demo gestionable + /api/activity + fix persistencia backups
- 67f4d94 fix(push): las críticas siempre atraviesan las preferencias por tipo
- 992e976 feat(settings): puerta del modo demo, tarjeta actividad, rediseño ajustes, check manual
- ba2f469 style(settings): títulos de fila 2 según spec (Mi sesión / Alertas push)
- Más: zona admin en 2 filas (demo+backup+notif / usuarios+actividad con Ver más),
  Acerca de con Comprobar actualizaciones junto a Instalar PWA, ribbon con
  Actualizar/Cerrar/info, presets push Todas/Importante/Ninguna.

Verificado: `go build ./...`, `go test ./...` (todos verdes), `tsc --noEmit`,
`vite build`, y QA visual contra servidor real (mock=1): el switch de modo
demo se refleja en /api/public/demo, la actividad registra los cambios, y las
filas de Ajustes quedan a la misma altura (412/412 y 387/387 px medidas).
