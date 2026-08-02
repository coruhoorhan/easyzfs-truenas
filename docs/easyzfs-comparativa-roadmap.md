# EasyZFS — ¿defrag? + comparativa con OMV y TrueNAS (agosto 2026)

## 1. ¿"Defrag" en ZFS?

**No existe un desfragmentador online en OpenZFS** (a agosto 2026). ZFS es CoW: no hay
fragmentación de ficheros tipo ext4, pero sí fragmentación del *espacio libre* (metaslabs).
Se mide con `zpool list -o fragmentation`.

Lo más parecido que existe es **`zfs rewrite`** (⚠️ `zfs`, no `zpool`; OpenZFS **2.3.4+** en
Linux, 2.4+ en FreeBSD):

```
zfs rewrite [-Prvx] file|directory…
```

- Reescribe bloques vivos de los ficheros/dirs indicados aplicando las **propiedades
  actuales** del dataset (compression, checksum, dedup, copies). NO cambia recordsize.
- Casos de uso reales: aplicar nueva compresión a datos antiguos sin send/recv;
  **rebalancear tras RAID-Z expansion** (los bloques viejos conservan el stripe antiguo);
  mover ficheros pequeños a special vdev.
- **No compacta el espacio libre** ni reordena el pool. No es un defrag global.
- Coste: reescritura completa del objetivo (I/O intensivo); con snapshots previos el espacio
  CRECE hasta destruirlos. Sin barra de progreso nativa (solo `-v`), sin reanudación.
- Disponibilidad: Debian 13 estable trae 2.3.2 (**no**, sí en backports 2.3.5); Ubuntu 24.04
  (2.2.2) **no**; Ubuntu 26.04/TrueNAS 25.10/Proxmox 9.2/Unraid 7.3 sí.

**Veredicto**: tiene sentido como **acción puntual version-gated** (detectar `zfs rewrite`
en el sistema y ofrecerla solo si existe), con aviso de coste y de snapshots. No como tarea
programada rutinaria. La "defragmentación" real en ZFS se gestiona mejor con: pool <80-90%
de ocupación, autotrim en SSD, y el allocation throttling de OpenZFS 2.4 (automático).

## 2. Otras funcionalidades ZFS útiles (priorizadas para EasyZFS)

| Prioridad | Funcionalidad | Comando / vía | Min. OpenZFS | Notas |
|---|---|---|---|---|
| 🔴 Alta | **Eventos zed → alertas en tiempo real** | `zpool events -f` o ZEDLET que llame al webhook/API de EasyZFS | ≤0.6 | El bus canónico: `ereport.fs.zfs.*` (checksum, io, deadman, delay, resilver/scrub start/finish, trim, sitout 2.4). Sustituye/complementa el polling de umbrales |
| 🔴 Alta | **Progreso de operaciones largas** | `zpool wait -t scrub,resilver,trim,raidz_expand pool <interval>` | 2.0 | Imprime bytes restantes periódicamente → barras de progreso reales en UI |
| 🔴 Alta | **Detección de feature flags / versión** | `zpool upgrade -v`, `zfs version` | 0.8+ | Gate de features por versión (rewrite, expansión, JSON). EasyZFS ya usa `zpool status --json` con fallback |
| 🔴 Alta | **Replicación zfs send/recv** | local + SSH, incremental con bookmarks/holds | ≤0.8 | EL hueco grande vs OMV-plugin y TrueNAS. Raw send para datasets cifrados |
| 🟡 Media-alta | **RAID-Z expansion** | `zpool attach pool raidzN-X sdY` | 2.3 | Producción desde TrueNAS 24.10 con caveats (un disco cada vez, stripe antiguo hasta rewrite, scrub post-expansión). No RAIDZ1→Z2 online (no existe) |
| 🟡 Media-alta | **Checkpoint de pool** | `zpool checkpoint` / `import --rewind-to-checkpoint` | 0.8 | Red de seguridad antes de upgrade/operaciones destructivas |
| 🟡 Media | **ARC stats + iostat por vdev** | `zarcstat`/`zarcsummary` (renombrados en 2.4; fallback a arcstat), `zpool iostat -v` | ≤0.8 | Vista de rendimiento/salud de caché |
| 🟡 Media | **Historial del pool en UI** | `zpool history -i` (con duraciones) | 2.1 | Auditoría ZFS nativa, complementa audit_log |
| 🟡 Media | **autotrim toggle por pool** | `zpool set autotrim=on pool` | 0.8 | Complementa el TRIM programado ya existente |
| 🟡 Media | **`zfs rewrite` (acción)** | ver §1 | 2.3.4 | Version-gated, con avisos |
| 🟡 Media | **Scrub todos los pools / por rango** | `zpool scrub -a`, `-S/-E` | 2.4 | Menor |
| ⚪ Baja | Fast dedup | `zpool ddtprune`, quota DDT | 2.3 | iX lo marcó experimental; nicho |
| ⚪ Baja | Direct/Uncached I/O | `zfs set direct=…` | 2.3/2.4 | NVMe/HPC, no home-lab típico |
| ⚪ Baja | dRAID | — | 2.1 | Pools muy grandes |

Mitos descartados: "AnyRaid" (no aparece en release notes 2.4 ni feature flags — no
verificado/probable error de prensa); "block pointer rewrite" (defrag total: sigue sin
existir, issue abierta); cambio online RAIDZ1→Z2 (no existe).

## 3. Comparativa: EasyZFS vs OMV 8 vs TrueNAS CE

Contexto verificado: **OMV 8 "Synchrony"** (estable dic-2025, Debian 13; OMV 7 EOL jun-2026)
y **TrueNAS Community Edition 25.10 "Goldeye"** (estable oct-2025, OpenZFS 2.3.4; TrueNAS 26
"Halfmoon" en beta con OpenZFS 2.4). CORE/FreeBSD está **muerto** (13.3-U1.2 fue la última).

| Área | **EasyZFS** | **OMV 8 + plugin ZFS** | **TrueNAS CE 25.10** |
|---|---|---|---|
| Enfoque | Gestor ZFS ligero | NAS OS generalista; ZFS vía plugin (omv-extras) | NAS OS de referencia ZFS |
| Huella | **Binario estático ~11 MB, decenas de MB RAM** | ~1 GB RAM mín, 4 GB disco | **8 GB RAM mín (16 rec.)**, ISO 2,2 GB |
| Instalación | One-liner curl\|bash multi-distro | ISO o script sobre Debian | ISO dedicada |
| Pools/datasets/zvols | ✅ | ✅ (plugin, reescrito y muy completo en OMV 8) | ✅ |
| Snapshots + programación | ✅ | ✅ (Snapshot Jobs con retención) | ✅ (Periodic Snapshot Tasks) |
| Scrub programado | ✅ | ✅ | ✅ |
| SMART + discos físicos | ✅ (whitelist físicos) | ✅ (4 tipos de test, email) | ✅ (en 25.10 migrado a cron; recomiendan Scrutiny) |
| TRIM | ✅ manual + programado | ✅ | ✅ + autotrim toggle |
| `zfs rewrite` | ❌ (propuesto) | ❌ | ✅ (25.10, vía CLI preview) |
| RAID-Z expansion | ❌ | ❌ | ✅ (desde 24.10) |
| Replicación send/recv | ❌ **(el hueco)** | ✅ (Replication Jobs, SSH, raw send, bookmarks) | ✅ (Replication Tasks + Cloud Sync + TrueCloud) |
| Encriptación ZFS | ❌ | ✅ (AES-CCM/GCM, keyfile local/HTTPS) | ✅ (por dataset, UI completa) |
| Shares SMB/NFS/iSCSI | ❌ | ✅ (+FTP plugin) | ✅ (+NVMe-oF, presets SMB) |
| Apps/Docker | ❌ | ✅ (compose plugin) | ✅ (Docker+Compose desde 24.10) |
| VMs | ❌ | ✅ (plugin kvm) | ✅ (KVM en 25.10; LXC/Incus experimental) |
| Alertas | ✅ umbrales + webhook + **Web Push al móvil** | ✅ email (Postfix) | ✅ 7 niveles + email/Slack/Telegram/PagerDuty/SNMP… |
| Multiusuario/RBAC | ✅ admin/normal (argon2id) | ✅ usuarios POSIX + 2FA (plugins 2026) | ✅ RBAC granular + 2FA + API keys |
| Eventos zed tiempo real | ❌ (polling umbrales) | Parcial (logs ZED en UI) | ✅ (middleware suscrito) |
| ARC/iostat/reporting | ❌ | ✅ (widgets ARC, diskstats) | ✅ (Netdata; UI embebida eliminada en 25.04) |
| Puntos débiles | Sin replicación ni shares aún | ZFS ciudadano de 2ª (paso "Discover", kernel Proxmox casi obligatorio, roturas zfs-dkms), bus-factor | Cambios de rumbo (K8s→Docker, libvirt→Incus→libvirt), 8 GB RAM, REST API eliminada en 26, rigidez ZFS |

**Lectura**: EasyZFS no compite como NAS OS — compite como **capa de gestión ZFS de mínima
huella** sobre cualquier Linux. Ni OMV ni TrueNAS caben en un LXC de 256 MB; EasyZFS sí. Su
nicho: hosts Proxmox, servidores caseros minimalistas, appliances. Donde pierde feo hoy:
**replicación**, eventos en tiempo real y encriptación.

## 4. Roadmap propuesto (orden sugerido)

1. **zed → alertas en tiempo real** (ZEDLET que POSTea al API; eventos scrub/resilver/io/checksum) — alto impacto, esfuerzo medio
2. **Progreso de operaciones largas** con `zpool wait` (scrub, resilver, trim) — alto impacto, esfuerzo bajo
3. **Feature-gating por versión** (`zfs version`/`zpool upgrade -v`) — base para todo lo demás, esfuerzo bajo
4. **Replicación local + SSH** (send/recv incremental con holds/bookmarks, tarea programada) — el hueco funcional mayor, esfuerzo alto
5. **autotrim toggle** por pool — trivial
6. **`zfs rewrite` version-gated** con avisos — esfuerzo bajo (tras el punto 3)
7. **ARC stats + `zpool iostat -v`** (vista rendimiento) — esfuerzo medio
8. **Checkpoint de pool** antes de operaciones destructivas/upgrade — esfuerzo bajo-medio
9. **Historial `zpool history`** en UI — esfuerzo bajo
10. (A largo) encriptación por dataset y RAID-Z expansion con caveats

Fuentes: github.com/openzfs/zfs/releases (2.3.0/2.4.0), manpages.debian.org (zfs-rewrite.8,
zpool-wait.8, zpool-events.8), truenas.com/docs (25.10/26), docs.openmediavault.org/en/8.x,
wiki.omv-extras.org (omv8 zfs), endoflife.date/openzfs. Investigación realizada 2026-08-02.
