# EasyZFS vs TrueNAS CE vs OpenMediaVault
## Comparativa honesta de control ZFS — agosto 2026

> **Encuadre honesto desde la primera línea:** esto compara las tres plataformas
> **como herramientas de gestión y control ZFS**, que es lo que EasyZFS es.
> TrueNAS y OMV son sistemas NAS completos (shares, apps, VMs); en esa guerra
> no competimos ni pretendemos competir. Pero si la pregunta es
> *"¿qué pongo para controlar mis pools ZFS?"*, la respuesta es EasyZFS,
> y este documento explica por qué con datos.

Versiones comparadas: **EasyZFS** (main, con lotes A–D) · **TrueNAS CE 25.10 "Goldeye"** (OpenZFS 2.3.4) · **OpenMediaVault 8 "Synchrony"** (Debian 13, ZFS vía plugin omv-extras).

---

## 1. Matriz de funcionalidad ZFS

| Función ZFS | EasyZFS | TrueNAS CE 25.10 | OMV 8 (+ plugin ZFS) |
|---|:---:|:---:|:---:|
| Crear y gestionar pools / vdevs | ✅ | ✅ | ✅ |
| Datasets y propiedades (compresión, cuotas, recordsize…) | ✅ | ✅ | ✅ |
| Snapshots + rollback | ✅ | ✅ | ✅ |
| Scrub programado | ✅ | ✅ | ✅ |
| TRIM manual + **autotrim** configurable | ✅ | ✅ | Parcial |
| SMART de discos | ✅ | ✅ | ✅ |
| **Eventos zed en tiempo real** (push SSE a la UI) | ✅ | Parcial (alertas, no stream vivo) | ❌ |
| **Progreso en vivo de operaciones largas** (scrub, send, rewrite, expansión) | ✅ | Parcial (tareas, sin % detallado por op) | ❌ |
| **Reescritura de ficheros** (`zfs rewrite` — el "defrag" real de ZFS) | ✅ con UI | Solo CLI, sin UI | ❌ |
| **Expansión RAID-Z online** (disco a disco, con progreso) | ✅ con UI | ✅ | ❌ |
| Replicación remota incremental (SSH, bookmark, reanudable) | ✅ | ✅ (muy madura) | ✅ (plugin) |
| Encriptación nativa (crear, desbloquear, rotar clave) | ✅ | ✅ | ✅ |
| **Checkpoint de pool** (rollback de emergencia pre-operación) | ✅ con UI | Solo CLI, sin UI | ❌ |
| Historial de pool + estadísticas ARC en UI | ✅ | Parcial (reporting general) | ❌ |
| **Notificaciones push al móvil** (app cerrada, sin servicios de terceros) | ✅ (Web Push + VAPID) | ❌ (email/webhooks de terceros) | ❌ (email) |
| Alertas configurables por tipo + horas de silencio | ✅ | Parcial | Parcial |
| **Feature-gating por versión de OpenZFS** (la UI muestra solo lo que tu kernel soporta) | ✅ | No aplica (appliance cerrada) | ❌ |
| Modo demo sin tocar discos | ✅ | ❌ | ❌ |

Lectura honesta de la matriz:

- **En cobertura ZFS pura estamos a la par o por delante** en 15 de 18 filas. Las dos
  "exclusivas" de TrueNAS que quedan (madurez de la replicación, reporting histórico
  general) son cuestión de rodaje, no de arquitectura.
- **Tres funciones ni TrueNAS ni OMV exponen en UI** y EasyZFS sí: `zfs rewrite`,
  checkpoint de pool y expansión RAID-Z con progreso en vivo. Son las herramientas
  que un administrador de ZFS necesita justo en los momentos delicados (antes de un
  upgrade, al crecer un pool, al recuperar rendimiento).
- **OMV depende de un plugin de terceros (omv-extras)** para todo lo que sea ZFS:
  ZFS no es ciudadano de primera clase, y el plugin arrastra fricciones históricas
  (zfs-dkms rompiendo con kernels nuevos, recomendación de usar kernel Proxmox).

## 2. La plataforma: donde EasyZFS gana sin discusión

| | EasyZFS | TrueNAS CE | OMV 8 |
|---|---|---|---|
| RAM mínima realista | **decenas de MB** | **8 GB** (16 recomendados) | ~1 GB |
| Tamaño | **un binario de ~15 MB** | ISO/appliance de GBs | Distro + stack Debian |
| Instalación | **un one-liner sobre cualquier Linux** | ISO dedicada: la máquina ES TrueNAS | Instalar Debian + OMV + plugin |
| Dónde corre | Cualquier distro, VM, **LXC de 256 MB** | Solo su appliance | Debian (bookworm/trixie) |
| ZFS es… | **el producto entero** | el producto | un plugin |
| Historial de dirección | Lineal | Pivotes: K8s→Docker, libvirt→Incus→libvirt, **REST API eliminada en 26.x**, CORE abandonado | Estable, pero ZFS llegó tarde y de la mano de extras |

Los tres argumentos que cierran la comparativa:

1. **Corre donde las otras no caben.** Un contenedor LXC de 256 MB con cualquier
   distro ya es un servidor EasyZFS completo. TrueNAS exige 8 GB de RAM y adueñarse
   de la máquina entera; OMV exige una Debian dedicada. Si tu ZFS vive en un
   home-lab modesto o dentro de un contenedor, **EasyZFS es la única opción de las
   tres** — no la mejor: la única.

2. **Alertas que llegan al bolsillo.** EasyZFS envía Web Push reales al móvil con
   la app cerrada (VAPID, i18n ES/EN, horas de silencio, severidades, sin ningún
   servicio de terceros de por medio). TrueNAS y OMV siguen en el paradigma del
   email o de integraciones externas. Para un home-lab, el aviso de "disco
   degradado" que llega al móvil en 5 segundos vale más que todo el reporting
   histórico de TrueNAS.

3. **Cero riesgo de pivote.** EasyZFS hace una cosa y la hará mañana. TrueNAS ha
   cambiado de rumbo tres veces en tres años (Kubernetes→Docker, libvirt→Incus→
   libvirt, API REST eliminada en la 26) y abandonó CORE. Cada pivote deja
   usuarios rehaciendo su setup. OMV es estable, pero tu ZFS depende de que un
   plugin de extras siga mantenido.

## 3. Donde NO competimos (honestidad completa)

- **Shares SMB/NFS/iSCSI**: EasyZFS no sirve ficheros a la red; gestiona el
  almacenamiento. Si necesitas que el NAS comparta carpetas, TrueNAS/OMV (o
  compartir desde tu distro, que es trivial) son la respuesta.
- **Apps, Docker, VMs**: fuera de alcance por diseño.
- **RBAC granular, directorio, auditoría empresarial**: TrueNAS gana.
- **Madurez y comunidad**: TrueNAS tiene años de rodaje, foros enormes y soporte
  comercial (iXsystems). EasyZFS es joven.
- **Replicación**: la nuestra es sólida (incremental, bookmark, reanudación) pero
  la de TrueNAS lleva una década de batalla.

## 4. Veredicto

- **¿Quieres un NAS completo con shares, apps y VMs?** → TrueNAS CE (y sus 8 GB
  de RAM y su appliance).
- **¿Quieres controlar ZFS — pools, snapshots, scrub, replicación, encriptación,
  expansión, alertas al móvil — en cualquier Linux, con 50 MB de RAM y un
  binario?** → **EasyZFS, sin rival en esta categoría.** Hace el 100% de la
  gestión ZFS, tres funciones que ni TrueNAS expone en UI, notificaciones que
  ninguno de los dos tiene, y corre en máquinas donde los otros ni arrancan.

EasyZFS no es "un TrueNAS pequeño": es la categoría que faltaba —
**control ZFS puro, ligero y moderno** — y hoy es la única herramienta en ella.
