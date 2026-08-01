// Tipos del contrato API (ver docs/api-contract.md).
// Números en bytes enteros; fechas RFC3339 UTC.

export type Role = 'admin' | 'user';
export type Lang = 'auto' | 'es' | 'en';

export interface SessionUser {
  user: string;
  role: Role;
}

export interface UserInfo {
  user: string;
  role: Role;
  last_login: string;
  sessions: number;
}

export interface VersionInfo {
  name?: string; // nombre del producto ("EasyZFS")
  version: string;
  build: string;
  go: string;
  os_arch: string;
  uptime_sec: number;
  rss_bytes: number;
  db_bytes: number;
  db_path: string;
  zfs_version: string;
  demo: boolean;
}

export interface Settings {
  lang: Lang;
  cap_warn_pct: number;
  cap_crit_pct: number;
  disk_temp_c: number;
  webhook: string;
  notify_scrub_errors: boolean;
  notify_smart_change: boolean;
}

export type AlertLevel = 'info' | 'warn' | 'crit';
export interface Alert {
  id: number;
  ts: string;
  level: AlertLevel;
  source: string;
  message: string;
  acked: boolean;
  // Vista/recurso causante: "disks:nvme1n1" | "pools:tank" | "tasks" | "settings"
  target?: string;
}

export interface ActivityItem {
  ts: string;
  text: string;
  detail: string;
}

export interface Overview {
  pools_total: number;
  pools_online: number;
  cap_used_bytes: number;
  cap_total_bytes: number;
  snapshots_total: number;
  jobs_active: number;
  last_scrub: { pool: string; ts: string; errors: number };
  alerts: Alert[];
  activity: ActivityItem[];
}

export type PoolStatus = 'ONLINE' | 'DEGRADED' | 'FAULTED';
export type Topo = 'stripe' | 'mirror' | 'raidz1' | 'raidz2' | 'raidz3';
export interface ScrubInfo {
  state: 'none' | 'running' | 'done';
  kind?: 'scrub' | 'resilver' | '';
  pct: number;
  eta_sec: number;
  ts: string;
  errors: number;
}
export interface Vdev {
  dev: string;
  path?: string;
  role: string;
  status: string;
  temp_c: number;
  replacing?: boolean; // hijo de un 'replacing-N' (sustitución en curso)
}
export interface Pool {
  name: string;
  status: PoolStatus;
  topo: string;
  used_bytes: number;
  total_bytes: number;
  frag_pct: number;
  comp_ratio: number;
  scrub: ScrubInfo;
  vdevs: Vdev[];
}

export type DatasetType = 'fs' | 'volume';
export interface Dataset {
  name: string;
  type: DatasetType;
  compression: string;
  used_bytes: number;
  avail_bytes: number;
  quota_bytes: number;
  mountpoint: string;
}

export interface Snapshot {
  name: string;
  full: string;
  ts: string;
  used_bytes: number;
  kind: 'auto' | 'manual';
}
export interface SnapshotGroup {
  dataset: string;
  snaps: Snapshot[];
}

export type JobType = 'snapshot' | 'scrub' | 'smart_short' | 'smart_long' | 'poweroff';
export interface Job {
  id: number;
  tipo: JobType;
  target: string;
  schedule: string; // hourly@:15 | daily@06:00 | weekly:sun@03:00 | monthly:1@02:00
  retention: string;
  enabled: boolean;
  last_run: string;
  last_result: string;
  next_run: string;
}
export interface JobHistoryItem {
  ts: string;
  tipo: JobType;
  target: string;
  ok: boolean;
  detail: string;
}

export interface Disk {
  dev: string;
  model: string;
  serial: string;
  size_bytes: number;
  temp_c: number | null; // null = sensor no disponible (p. ej. eMMC)
  smart: 'ok' | 'warn' | 'crit' | 'unknown'; // unknown = SMART no disponible
  smart_detail: string;
  pool: string;
  in_use?: boolean; // particiones montadas o swap activo (no elegible como libre)
  hours: number;
}

// Tarea del sistema (GET /api/system-timers): timers de systemd y cron
export interface SystemTimer {
  source: 'systemd' | 'cron';
  name: string;
  schedule: string;
  next_run: string; // RFC3339 UTC; '' si no se conoce
  last_run?: string;
  command: string;
  origin?: string;
  line?: number;
  editable?: boolean;
}

// --- Peticiones ---
export interface CreatePoolReq { name: string; topo: Topo; disks: string[]; confirm: string }
export interface CreateDatasetReq {
  pool: string; name: string; type: DatasetType;
  compression: 'lz4' | 'zstd' | 'off';
  quota_bytes: number; volsize_bytes?: number;
}
export interface CreateSnapshotReq { dataset: string; name: string; recursive: boolean }
export interface CreateJobReq { tipo: JobType; target: string; schedule: string; retention?: string }
export interface UpdateJobReq { enabled?: boolean; schedule?: string; retention?: string }
export interface CreateUserReq { user: string; password: string; role: Role }

// --- Eventos SSE ---
export type AppEvent =
  | { type: 'pool.status'; name: string; status: PoolStatus }
  | { type: 'scrub.progress'; pool: string; pct: number; eta_sec: number; kind?: 'scrub' | 'resilver' | '' }
  | { type: 'disk.temp'; dev: string; temp_c: number }
  | { type: 'alert.new'; alert: Alert }
  | { type: 'job.finished'; id: number; ok: boolean; detail: string }
  | { type: 'overview' };

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
