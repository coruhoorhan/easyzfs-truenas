// Diccionario i18n es/en de toda la UI. Persiste en localStorage ('zfc-lang').
export type LangMode = 'auto' | 'es' | 'en';

const es = {
  // Navegación
  dash: 'Panel', pools: 'Pools', data: 'Datasets', snaps: 'Snapshots',
  brand_home: 'Ir al Panel',
  tasks: 'Tareas', disks: 'Discos', settings: 'Ajustes',
  sub_dash: 'Resumen del sistema', sub_pools: 'Estado y topología de pools',
  sub_data: 'Datasets y volúmenes', sub_snaps: 'Instantáneas por dataset',
  sub_tasks: 'Tareas programadas', sub_disks: 'Discos y salud SMART',
  sub_settings: 'Apariencia, umbrales y notificaciones',

  // Demo
  demobar: 'Modo demo — los cambios no se aplican al sistema',
  demobar_exit: 'Salir del demo',

  // Común
  save: 'Guardar', update: 'Actualizar', logout: 'Cerrar sesión', cancel: 'Cancelar',
  create: 'Crear', delete: 'Eliminar', edit: 'Editar', close: 'Cerrar',
  confirm: 'Confirmar', loading: 'Cargando…', error: 'Error',
  retry: 'Reintentar', empty: 'No hay datos para mostrar',
  now: 'ahora', today: 'hoy', tomorrow: 'mañana', yesterday: 'ayer',
  ago_prefix: 'hace', in_prefix: 'en', day: 'día', days: 'días',
  you: '(tú)', active: 'Activa', paused: 'Pausada', run_now: 'Ejecutar ahora',
  saved_ok: 'Guardado correctamente',

  // Login
  login_title: 'Iniciar sesión', login_sub: 'Gestión ZFS para tu servidor',
  login_user: 'Usuario', login_pass: 'Contraseña', login_btn: 'Entrar',
  login_error: 'Usuario o contraseña incorrectos',
  login_no_conn: 'No se puede conectar con el servidor',
  login_demo_btn: 'Entrar en modo demo',
  login_or: 'o',
  login_checking: 'Conectando con el servidor…',
  login_remember: 'Recordar contraseña',

  // Panel
  kpi_health: 'Salud general', kpi_health_ok: 'todo ONLINE', kpi_health_warn: 'hay avisos',
  kpi_cap: 'Capacidad total', kpi_cap_used: 'usado',
  kpi_snaps: 'Snapshots', kpi_snaps_foot: 'tareas programadas activas',
  kpi_scrub: 'Último scrub', kpi_scrub_errors: 'errores',
  dash_pools: 'Pools', dash_see_all: 'Ver todos',
  dash_alerts: 'Alertas recientes', dash_activity: 'Actividad',
  dash_no_alerts: 'Sin alertas. Todo en orden.',

  // Pools
  pools_all: 'Todos', pools_ok: 'Sanos', pools_warn: 'Con avisos',
  pool_create: '+ Crear pool', pool_import: 'Importar pool existente',
  pool_used: 'usado', pool_of: 'de',
  pool_comp: 'Compresión', pool_frag: 'Fragmentación', pool_last_scrub: 'Último scrub',
  pool_errors: 'errores', pool_scrub_running: 'Scrub en curso',
  pool_scrub_left: 'restantes', pool_scrub_now: 'Scrub ahora',
  pool_scrub_pause: 'Pausar scrub', pool_add_vdev: 'Añadir vdev',
  pool_replace: 'Sustituir', pool_replace_disk: 'Sustituir {dev}', pool_export: 'Exportar',
  pool_eta_min: 'min restantes', pool_in_progress: 'en curso',
  pool_rebuild: 'Disco libre detectado: {dev} ({size}). ¿Reconstruir el RAID sustituyendo {old}?',
  pool_rebuild_btn: 'Reconstruir RAID',
  pool_resilvering: 'Reconstruyendo RAID',
  vdev_offline: 'Apagar', vdev_online: 'Reactivar', vdev_detach: 'Retirar',
  vdev_offline_hint: 'Apagar el disco (zpool offline) antes de extraerlo',
  vdev_outgoing: 'saliente', vdev_new: 'nuevo',
  vdev_outgoing_hint: 'disco viejo · desaparece solo al terminar la reconstrucción',
  vdev_new_hint: 'disco incorporado al RAID; reconstrucción en curso',
  vdev_joining: 'Incorporándose al RAID',
  vdev_joining_hint: 'El disco nuevo se está llenando con los datos reconstruidos (resilver)',
  pool_scrub_hint: 'Comprobar la integridad de todos los datos leyendo el pool entero',
  pool_scrub_pause_hint: 'Pausar/reanudar el scrub en curso',
  pool_add_vdev_hint: 'Añadir discos al pool para ampliar capacidad (no se puede deshacer)',
  pool_export_hint: 'Desmontar y exportar el pool (p.ej. para moverlo a otro sistema)',
  pool_rebuild_hint: 'Sustituir el disco con fallo por el disco libre y reconstruir los datos',
  dk_test_short_hint: 'Test SMART corto (~2 min)',
  dk_test_long_hint: 'Test SMART largo (puede durar horas)',
  vdev_detach_hint: 'Retirar del mirror de forma permanente (zpool detach)',

  // Crear pool
  np_title: 'Crear pool', np_desc: 'Asistente en 2 pasos: topología y discos.',
  np_step1: '1. Topología', np_step2: '2. Discos',
  np_name: 'Nombre del pool', np_name_ph: 'p. ej. tank2',
  np_topo: 'Topología', np_disks: 'Discos disponibles',
  np_free: 'libre', np_inuse: 'en uso',
  np_warn: 'Se borrarán todos los datos de los discos seleccionados.',
  np_usable: 'Capacidad útil estimada',
  np_back: 'Atrás', np_next: 'Siguiente', np_create: 'Crear pool',
  np_need_name: 'Escribe un nombre para el pool',
  np_need_disks: 'Selecciona al menos {n} disco(s) para esta topología',
  np_no_disks: 'No hay discos libres disponibles.',

  // Exportar pool
  ex_title: 'Exportar pool',
  ex_desc: 'Se desmontarán todos sus datasets y el pool quedará disponible para importar en este u otro sistema. No se borran datos.',
  ex_force: 'Forzar exportación (si hay datasets en uso)',
  ex_destroy: 'Destruir el pool tras exportar (¡borra los datos!)',
  ex_confirm_lbl: 'Escribe el nombre del pool para confirmar',
  ex_btn: 'Exportar pool',

  // Añadir vdev / sustituir disco
  av_title: 'Añadir vdev',
  av_desc: 'Se añadirá un nuevo vdev al pool con los discos seleccionados. Esta acción no se puede deshacer. Pool:',
  av_btn: 'Añadir vdev',
  rp_title: 'Sustituir disco',
  rp_desc: 'Se sustituirá el disco elegido por uno nuevo y se reconstruirán los datos (resilver). Pool:',
  rp_proc: 'Procedimiento: apaga el equipo (o extrae en caliente si tu hardware lo permite), cambia el disco y vuelve aquí. El disco nuevo aparecerá en la lista al conectarlo.',
  rp_old: 'Disco a sustituir', rp_new: 'Disco nuevo',
  rp_btn: 'Sustituir disco',
  rp_small: 'pequeño', rp_small_hidden: '({n} oculto(s) por tamaño)',
  rp_show_all: 'Mostrar también los {n} disco(s) de tamaño insuficiente',

  // Retirar disco de un mirror
  dt_title: 'Retirar disco',
  dt_desc: 'Se retirará {dev} del pool {pool} de forma permanente. Los datos quedan a salvo en el resto del mirror.',

  // Datasets
  ds_name: 'Dataset', ds_type: 'Tipo', ds_comp: 'Compresión', ds_used: 'Usado',
  ds_avail: 'Disponible', ds_quota: 'Cuota',
  ds_fs: 'Dataset', ds_vol: 'Volumen (zvol)',
  ds_new: '+ Nuevo dataset', ds_newvol: '+ Nuevo volumen (zvol)',
  ds_snapshot: 'Snapshot', ds_edit: 'Editar', ds_none: 'Sin cuota',
  nds_title_fs: 'Nuevo dataset', nds_title_vol: 'Nuevo volumen (zvol)',
  nds_desc: 'Dentro de un pool existente.',
  nds_pool: 'Pool padre', nds_name: 'Nombre', nds_name_ph: 'p. ej. backups',
  nds_comp: 'Compresión', nds_comp_rec: 'lz4 (recomendado)', nds_comp_off: 'desactivada',
  nds_quota: 'Cuota (0 = sin límite)', nds_quota_ph: 'p. ej. 500G',
  nds_volsize: 'Tamaño del volumen', nds_volsize_ph: 'p. ej. 100G',
  eds_title: 'Editar dataset',
  dds_title: 'Eliminar dataset',
  dds_desc: 'Se eliminará el dataset y todos sus datos. Esta acción no se puede deshacer.',
  dds_recursive: 'Eliminar también sus descendientes (recursivo)',

  // Snapshots
  sn_now: '+ Snapshot ahora',
  nsn_title: 'Crear snapshot',
  nsn_desc: 'Instantánea manual de un dataset o de todo un pool (recursiva).',
  nsn_dataset: 'Dataset', nsn_recursive: '(recursivo)', nsn_name: 'Nombre',
  nsn_create: 'Crear snapshot',
  rb_title: 'Restaurar snapshot',
  rb_desc1: 'Vas a hacer rollback de',
  rb_desc2: 'a',
  rb_warn: 'Se perderán los cambios posteriores a este snapshot.',
  rb_confirm_lbl: 'Escribe el nombre del dataset para confirmar',
  rb_btn: 'Restaurar',
  dsn_title: 'Eliminar snapshot',
  dsn_desc: 'Se eliminará la instantánea. Los datos actuales no se ven afectados.',
  dsn_confirm_lbl: 'Escribe el nombre del snapshot para confirmar',
  snap_restore: 'Restaurar', snap_delete: 'Eliminar',

  // Tareas
  tk_next: 'Próximas ejecuciones', tk_jobs: 'Tareas programadas',
  tk_new: '+ Nueva tarea', tk_history: 'Historial de ejecuciones',
  tk_last: 'última', tk_nextrun: 'próxima', tk_none: '— (pausada)',
  tk_type_snapshot: 'Snapshot', tk_type_scrub: 'Scrub', tk_type_smart: 'SMART',
  tk_type_smart_short: 'SMART corto', tk_type_smart_long: 'SMART largo',
  nt_title: 'Nueva tarea programada',
  nt_desc: 'Cualquier operación recurrente: snapshot, scrub o test SMART.',
  nt_type: 'Tipo de tarea', nt_target: 'Objetivo', nt_freq: 'Frecuencia',
  nt_hourly: 'Cada hora', nt_daily: 'Diario', nt_weekly: 'Semanal', nt_monthly: 'Mensual',
  nt_minute: 'Minuto', nt_time: 'Hora', nt_weekday: 'Día de la semana', nt_monthday: 'Día del mes',
  nt_ret: 'Conservar durante (solo snapshots)',
  nt_ret_1w: '1 semana', nt_ret_1m: '1 mes', nt_ret_3m: '3 meses', nt_ret_1y: '1 año',
  nt_create: 'Crear tarea', nt_all_disks: 'todos los discos',
  nt_pool_full: '(pool completo)',
  et_title: 'Editar programación', et_job: 'Tarea',
  et_notify: 'Notificar si la tarea falla', et_delete: 'Eliminar tarea',
  hist_ok: 'OK', hist_warn: 'aviso',
  tk_system: 'Tareas del sistema',
  tk_system_d: 'Temporizadores del sistema operativo relacionados con ZFS. Los editables se pueden reprogramar o migrar a systemd.',
  tk_cronvs_title: '¿cron o systemd timer?',
  tk_cronvs_cron1: 'Simple y compatible con cualquier sistema antiguo',
  tk_cronvs_cron2: 'Sin registro de ejecuciones ni gestión de fallos',
  tk_cronvs_sysd1: 'Más moderno: logs con journalctl, dependencias y recursos controlados',
  tk_cronvs_sysd2: 'Recupera ejecuciones perdidas si el equipo estaba apagado (Persistent)',
  tk_cronvs_sysd3: 'Calendarios ricos: "Sun 02:00", "monthly", expresiones avanzadas',
  ss_title: 'Cambiar periodicidad',
  ss_lbl: 'Nueva periodicidad',
  ss_hint_cron: 'Formato cron: 5 campos (min hora día mes día-semana) o @daily, @weekly, @monthly…',
  ss_hint_sysd: 'Formato OnCalendar: daily, weekly, Sun 02:00, *-*-1 03:30:00, monthly…',
  ss_btn_hint: 'Cambiar la periodicidad de esta tarea',
  sm_title: 'Migrar a systemd timer',
  sm_desc: 'Se creará un servicio + timer de systemd equivalentes y la entrada cron quedará comentada (reversible).',
  sm_note: 'Ventajas: logs con journalctl, recupera ejecuciones perdidas, gestión con systemctl.',
  sm_name_lbl: 'Nombre de la nueva unidad',
  sm_btn: 'Migrar',
  sm_btn_hint: 'Migrar esta entrada cron a un systemd timer',
  freq_hourly: 'Cada hora', freq_daily: 'Diario', freq_weekly: 'Semanal', freq_monthly: 'Mensual',
  wd_mon: 'L', wd_tue: 'M', wd_wed: 'X', wd_thu: 'J', wd_fri: 'V', wd_sat: 'S', wd_sun: 'D',
  wdl_mon: 'lun', wdl_tue: 'mar', wdl_wed: 'mié', wdl_thu: 'jue', wdl_fri: 'vie', wdl_sat: 'sáb', wdl_sun: 'dom',

  // Discos
  dk_disk: 'Disco', dk_model: 'Modelo / Serie', dk_size: 'Tamaño',
  dk_temp: 'Temp.', dk_smart: 'Salud SMART', dk_pool: 'Pool',
  dk_test_short: 'Test corto', dk_test_long: 'Test largo',
  dk_test_started: 'Test SMART iniciado',
  dk_poweroff: 'Apagar', dk_poweroff_arm: '¿Confirmar?',
  dk_poweroff_hint: 'Apagar el disco para extraerlo (power-off)',
  dk_powered: 'Disco apagado', dk_in_use: 'en uso',
  dk_hours: 'horas encendido',
  dk_smart_na: 'no disponible',

  // Alertas (campanita)
  al_title: 'Alertas', al_ack: 'Marcar leída', al_none: 'No hay alertas pendientes.',
  al_ack_all: 'Marcar todas como leídas',
  al_goto: 'Ver la causa',

  // Ajustes
  s_general: 'General', s_lang: 'Idioma',
  s_appear: 'Apariencia', s_accent: 'Color de acento',
  s_density: 'Densidad', s_density_cozy: 'Cómoda', s_density_compact: 'Compacta',
  s_theme: 'Tema', s_theme_auto: 'Sistema', s_theme_light: 'Claro', s_theme_dark: 'Oscuro',
  s_users: 'Usuarios', s_newuser: 'Nuevo usuario',
  s_roles_d: 'Admin: acceso total (usuarios, ajustes, acciones destructivas). Usuario: consulta y operaciones del día a día (snapshots, scrubs, datasets).',
  s_last_login: 'último acceso', s_sessions: 'sesiones activas', s_session_one: 'sesión activa',
  s_passwd: 'Contraseña', s_delete_user: 'Eliminar',
  s_thresh: 'Umbrales de salud', s_thresh_d: 'Se disparan alertas al superar estos valores.',
  s_cap_warn: 'Aviso de capacidad de pool (%)', s_cap_crit: 'Capacidad crítica (%)',
  s_temp: 'Temperatura de disco (°C)',
  s_thresh_invalid: 'Valores no válidos: capacidad entre 1 y 100 (aviso menor que crítico) y temperatura entre 20 y 90.',
  s_notif: 'Notificaciones', s_webhook: 'Webhook / correo para alertas',
  s_webhook_ph: 'https://... o correo@dominio.es',
  s_n_scrub: 'Avisar al terminar un scrub con errores',
  s_n_smart: 'Avisar si un disco cambia de estado SMART',
  s_session: 'Mi sesión', s_mypass: 'Cambiar mi contraseña',
  s_mypass_cur: 'Contraseña actual', s_mypass2: 'Repetir contraseña',
  s_mypass_mismatch: 'Las contraseñas no coinciden',
  s_about: 'Acerca de',
  s_about_d: 'Gestión ZFS ligera para servidores caseros. Un solo binario Go + SQLite.',
  ab_ver: 'Versión', ab_rt: 'Runtime', ab_up: 'Tiempo activo', ab_mem: 'Memoria (RSS)',
  ab_db: 'Base de datos', ab_lic: 'Licencia',
  ab_chlog: 'Registro de cambios', ab_upd: 'Buscar actualizaciones',
  ab_uptodate: 'EasyZFS está al día.',
  ab_system: 'Sistema',
  ab_code: 'Código', ab_code_d: 'Repositorio del proyecto',
  ab_chlog_d: 'Novedades de cada versión', ab_chlog_first: 'primera versión pública',
  ab_home: 'Hecho en casa', ab_home_d: 'Proyecto personal para servidores caseros',
  ab_priv: 'Privacidad', ab_priv_d: 'Sin telemetría: todo se queda en tu servidor',
  ab_install: 'Instalar app', ab_install_btn: 'Instalar', ab_installed: 'Instalada',
  ab_install_d: 'Añade EasyZFS a tu pantalla de inicio',
  ab_installed_d: 'EasyZFS ya está instalada en este dispositivo',
  ab_install_ios: 'En iOS: Compartir → «Añadir a pantalla de inicio»',

  // Modal usuarios
  mu_title: 'Nuevo usuario', mu_d: 'El usuario podrá entrar a la app con su propia contraseña.',
  mu_name: 'Nombre de usuario', mu_name_ph: 'p. ej. maria',
  mu_pass: 'Contraseña', mu_pass_ph: 'Mínimo 8 caracteres',
  mu_role: 'Rol', mu_r_user: 'Usuario', mu_r_admin: 'Admin',
  mu_roles_d: 'Admin gestiona usuarios, ajustes y acciones destructivas. Usuario: consulta y operaciones del día a día.',
  mu_create: 'Crear usuario',
  mp_title: 'Cambiar contraseña', mp_user: 'Usuario',
  mp_new: 'Nueva contraseña', mp_new2: 'Repetir contraseña',
  mp_close: 'Cerrar sus sesiones activas al cambiarla',
  du_title: 'Eliminar usuario',
  du_desc: 'El usuario perderá el acceso a la aplicación.',
  du_confirm_lbl: 'Escribe el nombre del usuario para confirmar',

  // Roles / permisos
  no_permission: 'Necesitas rol de administrador para esta acción.',

  // Accesibilidad
  a11y_close_modal: 'Cerrar ventana', a11y_theme: 'Cambiar tema', a11y_alerts: 'Alertas',
};

export type I18nKey = keyof typeof es;

const en: Record<I18nKey, string> = {
  dash: 'Dashboard', pools: 'Pools', data: 'Datasets', snaps: 'Snapshots',
  brand_home: 'Go to Dashboard',
  tasks: 'Tasks', disks: 'Disks', settings: 'Settings',
  sub_dash: 'System overview', sub_pools: 'Pool status and topology',
  sub_data: 'Datasets and volumes', sub_snaps: 'Snapshots per dataset',
  sub_tasks: 'Scheduled tasks', sub_disks: 'Disks and SMART health',
  sub_settings: 'Appearance, thresholds and notifications',

  demobar: 'Demo mode — changes are not applied to the system',
  demobar_exit: 'Exit demo',

  save: 'Save', update: 'Update', logout: 'Log out', cancel: 'Cancel',
  create: 'Create', delete: 'Delete', edit: 'Edit', close: 'Close',
  confirm: 'Confirm', loading: 'Loading…', error: 'Error',
  retry: 'Retry', empty: 'No data to show',
  now: 'now', today: 'today', tomorrow: 'tomorrow', yesterday: 'yesterday',
  ago_prefix: '', in_prefix: 'in', day: 'day', days: 'days',
  you: '(you)', active: 'Active', paused: 'Paused', run_now: 'Run now',
  saved_ok: 'Saved successfully',

  login_title: 'Sign in', login_sub: 'ZFS management for your server',
  login_user: 'Username', login_pass: 'Password', login_btn: 'Sign in',
  login_error: 'Wrong username or password',
  login_no_conn: 'Cannot connect to the server',
  login_demo_btn: 'Enter demo mode',
  login_or: 'or',
  login_checking: 'Connecting to the server…',
  login_remember: 'Remember password',

  kpi_health: 'Overall health', kpi_health_ok: 'all ONLINE', kpi_health_warn: 'warnings present',
  kpi_cap: 'Total capacity', kpi_cap_used: 'used',
  kpi_snaps: 'Snapshots', kpi_snaps_foot: 'active scheduled tasks',
  kpi_scrub: 'Last scrub', kpi_scrub_errors: 'errors',
  dash_pools: 'Pools', dash_see_all: 'View all',
  dash_alerts: 'Recent alerts', dash_activity: 'Activity',
  dash_no_alerts: 'No alerts. Everything is fine.',

  pools_all: 'All', pools_ok: 'Healthy', pools_warn: 'With warnings',
  pool_create: '+ Create pool', pool_import: 'Import existing pool',
  pool_used: 'used', pool_of: 'of',
  pool_comp: 'Compression', pool_frag: 'Fragmentation', pool_last_scrub: 'Last scrub',
  pool_errors: 'errors', pool_scrub_running: 'Scrub running',
  pool_scrub_left: 'left', pool_scrub_now: 'Scrub now',
  pool_scrub_pause: 'Pause scrub', pool_add_vdev: 'Add vdev',
  pool_replace: 'Replace', pool_replace_disk: 'Replace {dev}', pool_export: 'Export',
  pool_eta_min: 'min left', pool_in_progress: 'in progress',
  pool_rebuild: 'Free disk detected: {dev} ({size}). Rebuild the RAID replacing {old}?',
  pool_rebuild_btn: 'Rebuild RAID',
  pool_resilvering: 'Rebuilding RAID',
  vdev_offline: 'Turn off', vdev_online: 'Reactivate', vdev_detach: 'Detach',
  vdev_offline_hint: 'Take the disk offline (zpool offline) before removing it',
  vdev_outgoing: 'outgoing', vdev_new: 'new',
  vdev_outgoing_hint: 'old disk · disappears by itself when the rebuild finishes',
  vdev_new_hint: 'disk just joined the RAID; rebuild in progress',
  vdev_joining: 'Joining the RAID',
  vdev_joining_hint: 'The new disk is being filled with the rebuilt data (resilver)',
  pool_scrub_hint: 'Check the integrity of all data by reading the whole pool',
  pool_scrub_pause_hint: 'Pause/resume the running scrub',
  pool_add_vdev_hint: 'Add disks to the pool to grow capacity (cannot be undone)',
  pool_export_hint: 'Unmount and export the pool (e.g. to move it to another system)',
  pool_rebuild_hint: 'Replace the failed disk with the free one and rebuild the data',
  dk_test_short_hint: 'Short SMART test (~2 min)',
  dk_test_long_hint: 'Long SMART test (can take hours)',
  vdev_detach_hint: 'Permanently detach from the mirror (zpool detach)',

  np_title: 'Create pool', np_desc: '2-step wizard: topology and disks.',
  np_step1: '1. Topology', np_step2: '2. Disks',
  np_name: 'Pool name', np_name_ph: 'e.g. tank2',
  np_topo: 'Topology', np_disks: 'Available disks',
  np_free: 'free', np_inuse: 'in use',
  np_warn: 'All data on the selected disks will be erased.',
  np_usable: 'Estimated usable capacity',
  np_back: 'Back', np_next: 'Next', np_create: 'Create pool',
  np_need_name: 'Enter a pool name',
  np_need_disks: 'Select at least {n} disk(s) for this topology',
  np_no_disks: 'No free disks available.',

  ex_title: 'Export pool',
  ex_desc: 'All its datasets will be unmounted and the pool will be available to import on this or another system. No data is deleted.',
  ex_force: 'Force export (if datasets are in use)',
  ex_destroy: 'Destroy the pool after exporting (deletes data!)',
  ex_confirm_lbl: 'Type the pool name to confirm',
  ex_btn: 'Export pool',

  av_title: 'Add vdev',
  av_desc: 'A new vdev with the selected disks will be added to the pool. This action cannot be undone. Pool:',
  av_btn: 'Add vdev',
  rp_title: 'Replace disk',
  rp_desc: 'The chosen disk will be replaced by a new one and data will be rebuilt (resilver). Pool:',
  rp_proc: 'Procedure: power off the machine (or hot-swap if your hardware supports it), swap the disk and come back here. The new disk will appear in the list once connected.',
  rp_old: 'Disk to replace', rp_new: 'New disk',
  rp_btn: 'Replace disk',
  rp_small: 'too small', rp_small_hidden: '({n} hidden by size)',
  rp_show_all: 'Also show the {n} undersized disk(s)',

  dt_title: 'Detach disk',
  dt_desc: '{dev} will be permanently detached from pool {pool}. Data stays safe on the rest of the mirror.',

  ds_name: 'Dataset', ds_type: 'Type', ds_comp: 'Compression', ds_used: 'Used',
  ds_avail: 'Available', ds_quota: 'Quota',
  ds_fs: 'Dataset', ds_vol: 'Volume (zvol)',
  ds_new: '+ New dataset', ds_newvol: '+ New volume (zvol)',
  ds_snapshot: 'Snapshot', ds_edit: 'Edit', ds_none: 'No quota',
  nds_title_fs: 'New dataset', nds_title_vol: 'New volume (zvol)',
  nds_desc: 'Inside an existing pool.',
  nds_pool: 'Parent pool', nds_name: 'Name', nds_name_ph: 'e.g. backups',
  nds_comp: 'Compression', nds_comp_rec: 'lz4 (recommended)', nds_comp_off: 'disabled',
  nds_quota: 'Quota (0 = no limit)', nds_quota_ph: 'e.g. 500G',
  nds_volsize: 'Volume size', nds_volsize_ph: 'e.g. 100G',
  eds_title: 'Edit dataset',
  dds_title: 'Delete dataset',
  dds_desc: 'The dataset and all its data will be deleted. This cannot be undone.',
  dds_recursive: 'Also delete its descendants (recursive)',

  sn_now: '+ Snapshot now',
  nsn_title: 'Create snapshot',
  nsn_desc: 'Manual snapshot of a dataset or a whole pool (recursive).',
  nsn_dataset: 'Dataset', nsn_recursive: '(recursive)', nsn_name: 'Name',
  nsn_create: 'Create snapshot',
  rb_title: 'Restore snapshot',
  rb_desc1: 'You are about to roll back',
  rb_desc2: 'to',
  rb_warn: 'Changes made after this snapshot will be lost.',
  rb_confirm_lbl: 'Type the dataset name to confirm',
  rb_btn: 'Restore',
  dsn_title: 'Delete snapshot',
  dsn_desc: 'The snapshot will be deleted. Current data is not affected.',
  dsn_confirm_lbl: 'Type the snapshot name to confirm',
  snap_restore: 'Restore', snap_delete: 'Delete',

  tk_next: 'Upcoming runs', tk_jobs: 'Scheduled tasks',
  tk_new: '+ New task', tk_history: 'Run history',
  tk_last: 'last', tk_nextrun: 'next', tk_none: '— (paused)',
  tk_type_snapshot: 'Snapshot', tk_type_scrub: 'Scrub', tk_type_smart: 'SMART',
  tk_type_smart_short: 'SMART short', tk_type_smart_long: 'SMART long',
  nt_title: 'New scheduled task',
  nt_desc: 'Any recurring operation: snapshot, scrub or SMART test.',
  nt_type: 'Task type', nt_target: 'Target', nt_freq: 'Frequency',
  nt_hourly: 'Hourly', nt_daily: 'Daily', nt_weekly: 'Weekly', nt_monthly: 'Monthly',
  nt_minute: 'Minute', nt_time: 'Time', nt_weekday: 'Day of week', nt_monthday: 'Day of month',
  nt_ret: 'Keep for (snapshots only)',
  nt_ret_1w: '1 week', nt_ret_1m: '1 month', nt_ret_3m: '3 months', nt_ret_1y: '1 year',
  nt_create: 'Create task', nt_all_disks: 'all disks',
  nt_pool_full: '(whole pool)',
  et_title: 'Edit schedule', et_job: 'Task',
  et_notify: 'Notify if the task fails', et_delete: 'Delete task',
  hist_ok: 'OK', hist_warn: 'warning',
  tk_system: 'System tasks',
  tk_system_d: 'ZFS-related OS timers. Editable ones can be rescheduled or migrated to systemd.',
  tk_cronvs_title: 'cron or systemd timer?',
  tk_cronvs_cron1: 'Simple and compatible with any legacy system',
  tk_cronvs_cron2: 'No execution log, no failure handling',
  tk_cronvs_sysd1: 'Modern: journalctl logs, dependencies and resource control',
  tk_cronvs_sysd2: 'Catches up missed runs if the machine was off (Persistent)',
  tk_cronvs_sysd3: 'Rich calendars: "Sun 02:00", "monthly", advanced expressions',
  ss_title: 'Change schedule',
  ss_lbl: 'New schedule',
  ss_hint_cron: 'cron format: 5 fields (min hour day month weekday) or @daily, @weekly, @monthly…',
  ss_hint_sysd: 'OnCalendar format: daily, weekly, Sun 02:00, *-*-1 03:30:00, monthly…',
  ss_btn_hint: 'Change this task schedule',
  sm_title: 'Migrate to systemd timer',
  sm_desc: 'An equivalent systemd service + timer will be created and the cron entry will be commented out (reversible).',
  sm_note: 'Benefits: journalctl logs, missed-run catch-up, systemctl management.',
  sm_name_lbl: 'New unit name',
  sm_btn: 'Migrate',
  sm_btn_hint: 'Migrate this cron entry to a systemd timer',
  freq_hourly: 'Hourly', freq_daily: 'Daily', freq_weekly: 'Weekly', freq_monthly: 'Monthly',
  wd_mon: 'M', wd_tue: 'T', wd_wed: 'W', wd_thu: 'T', wd_fri: 'F', wd_sat: 'S', wd_sun: 'S',
  wdl_mon: 'Mon', wdl_tue: 'Tue', wdl_wed: 'Wed', wdl_thu: 'Thu', wdl_fri: 'Fri', wdl_sat: 'Sat', wdl_sun: 'Sun',

  dk_disk: 'Disk', dk_model: 'Model / Serial', dk_size: 'Size',
  dk_temp: 'Temp.', dk_smart: 'SMART health', dk_pool: 'Pool',
  dk_test_short: 'Short test', dk_test_long: 'Long test',
  dk_test_started: 'SMART test started',
  dk_poweroff: 'Power off', dk_poweroff_arm: 'Confirm?',
  dk_poweroff_hint: 'Power the disk down for removal',
  dk_powered: 'Disk powered off', dk_in_use: 'in use',
  dk_hours: 'power-on hours',
  dk_smart_na: 'not available',

  al_title: 'Alerts', al_ack: 'Mark as read', al_none: 'No pending alerts.',
  al_ack_all: 'Mark all as read',
  al_goto: 'View the cause',

  s_general: 'General', s_lang: 'Language',
  s_appear: 'Appearance', s_accent: 'Accent color',
  s_density: 'Density', s_density_cozy: 'Comfortable', s_density_compact: 'Compact',
  s_theme: 'Theme', s_theme_auto: 'System', s_theme_light: 'Light', s_theme_dark: 'Dark',
  s_users: 'Users', s_newuser: 'New user',
  s_roles_d: 'Admin: full access (users, settings, destructive actions). User: read-only plus day-to-day operations (snapshots, scrubs, datasets).',
  s_last_login: 'last login', s_sessions: 'active sessions', s_session_one: 'active session',
  s_passwd: 'Password', s_delete_user: 'Delete',
  s_thresh: 'Health thresholds', s_thresh_d: 'Alerts fire when these values are exceeded.',
  s_cap_warn: 'Pool capacity warning (%)', s_cap_crit: 'Critical capacity (%)',
  s_temp: 'Disk temperature (°C)',
  s_thresh_invalid: 'Invalid values: capacity between 1 and 100 (warning lower than critical) and temperature between 20 and 90.',
  s_notif: 'Notifications', s_webhook: 'Webhook / email for alerts',
  s_webhook_ph: 'https://... or mail@example.com',
  s_n_scrub: 'Notify when a scrub finishes with errors',
  s_n_smart: 'Notify if a disk SMART status changes',
  s_session: 'My session', s_mypass: 'Change my password',
  s_mypass_cur: 'Current password', s_mypass2: 'Repeat password',
  s_mypass_mismatch: 'Passwords do not match',
  s_about: 'About',
  s_about_d: 'Lightweight ZFS management for home servers. A single Go binary + SQLite.',
  ab_ver: 'Version', ab_rt: 'Runtime', ab_up: 'Uptime', ab_mem: 'Memory (RSS)',
  ab_db: 'Database', ab_lic: 'License',
  ab_chlog: 'Changelog', ab_upd: 'Check for updates',
  ab_uptodate: 'EasyZFS is up to date.',
  ab_system: 'System',
  ab_code: 'Source code', ab_code_d: 'Project repository',
  ab_chlog_d: 'What’s new in each release', ab_chlog_first: 'first public release',
  ab_home: 'Homemade', ab_home_d: 'Personal project for home servers',
  ab_priv: 'Privacy', ab_priv_d: 'No telemetry: everything stays on your server',
  ab_install: 'Install app', ab_install_btn: 'Install', ab_installed: 'Installed',
  ab_install_d: 'Add EasyZFS to your home screen',
  ab_installed_d: 'EasyZFS is already installed on this device',
  ab_install_ios: 'On iOS: Share → “Add to Home Screen”',

  mu_title: 'New user', mu_d: 'The user will log in to the app with their own password.',
  mu_name: 'Username', mu_name_ph: 'e.g. maria',
  mu_pass: 'Password', mu_pass_ph: 'At least 8 characters',
  mu_role: 'Role', mu_r_user: 'User', mu_r_admin: 'Admin',
  mu_roles_d: 'Admin manages users, settings and destructive actions. User: read-only plus day-to-day operations.',
  mu_create: 'Create user',
  mp_title: 'Change password', mp_user: 'User',
  mp_new: 'New password', mp_new2: 'Repeat password',
  mp_close: 'Close their active sessions when changing it',
  du_title: 'Delete user',
  du_desc: 'The user will lose access to the application.',
  du_confirm_lbl: 'Type the username to confirm',

  no_permission: 'You need an administrator role for this action.',

  a11y_close_modal: 'Close dialog', a11y_theme: 'Toggle theme', a11y_alerts: 'Alerts',
};

const DICTS: Record<'es' | 'en', Record<I18nKey, string>> = { es, en };
const LANG_KEY = 'zfc-lang';

let currentLang: 'es' | 'en' = 'es';
const subs = new Set<() => void>();

export function resolveLang(mode: LangMode): 'es' | 'en' {
  if (mode === 'auto') {
    return (navigator.language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  }
  return mode;
}

export function getLangMode(): LangMode {
  return (localStorage.getItem(LANG_KEY) as LangMode) || 'auto';
}

export function setLangMode(mode: LangMode): void {
  localStorage.setItem(LANG_KEY, mode);
  currentLang = resolveLang(mode);
  document.documentElement.lang = currentLang;
  subs.forEach((f) => f());
}

export function initLang(): void {
  currentLang = resolveLang(getLangMode());
  document.documentElement.lang = currentLang;
}

// Traducción con interpolación simple {clave}
export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  let s = DICTS[currentLang][key] ?? DICTS.es[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// Suscripción para re-render al cambiar de idioma
export function onLangChange(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function getCurrentLang(): 'es' | 'en' {
  return currentLang;
}
