// Interfaz DataProvider: abstrae el origen de datos (HTTP real o mock demo).
import type {
  Alert, BackupFile, BackupStatus, CreateDatasetReq, CreateJobReq, CreatePoolReq, CreateReplicationReq, CreateSnapshotReq, CreateUserReq,
  Dataset, Disk, Job, JobHistoryItem, Lang, LongOp, Overview, Performance, Pool, PoolHistoryEntry, PushAlertTipo, PushPreference, PushQuietHours, PushSubscriptionJSON,
  ReplicationJob, ReplicationSSHKey, ReplicationTestResult, SessionUser, Settings,
  SnapshotGroup, SystemTimer, SystemTimersResp, UpdateJobReq, UpdateReplicationReq, UserInfo, VersionInfo,
} from './types';

export interface DataProvider {
  readonly isMock: boolean;

  // Sistema
  getVersion(): Promise<VersionInfo>;
  getSettings(): Promise<Settings>;
  putSettings(s: Settings): Promise<void>;
  getAlerts(): Promise<Alert[]>;
  ackAlert(id: number): Promise<void>;
  getOverview(): Promise<Overview>;

  // Copia de seguridad de la BD (admin; la descarga es enlace directo con cookie)
  getBackupStatus(): Promise<BackupStatus>;
  runBackup(): Promise<BackupFile>;
  importBackup(file: File): Promise<void>;

  // Auth y sesión
  login(user: string, password: string): Promise<SessionUser>;
  logout(): Promise<void>;
  me(): Promise<SessionUser>;
  setMyPassword(current: string, next: string): Promise<void>;
  setMyLanguage(language: Lang): Promise<void>;
  updateMyProfile(displayName: string, email: string): Promise<void>;

  // Usuarios (admin)
  getUsers(): Promise<UserInfo[]>;
  createUser(r: CreateUserReq): Promise<void>;
  deleteUser(name: string, confirm: string): Promise<void>;
  setUserPassword(name: string, next: string, closeSessions: boolean): Promise<void>;
  setUserLanguage(name: string, language: Lang): Promise<void>;

  // Pools
  getPools(): Promise<Pool[]>;
  createPool(r: CreatePoolReq): Promise<void>;
  importPool(name?: string): Promise<string[]>;
  scrubAction(pool: string, action: 'start' | 'pause' | 'stop'): Promise<void>;
  exportPool(name: string, confirm: string, force: boolean, destroy: boolean): Promise<void>;
  addVdev(pool: string, topo: string, disks: string[], confirm: string): Promise<void>;
  replaceDisk(pool: string, oldDev: string, newDev: string, confirm: string): Promise<void>;
  vdevAction(pool: string, dev: string, action: 'offline' | 'online' | 'detach', confirm?: string): Promise<void>;
  setAutotrim(pool: string, enabled: boolean): Promise<void>;
  checkpointPool(pool: string, action: 'create' | 'discard', confirm: string): Promise<void>;
  getPoolHistory(pool: string): Promise<PoolHistoryEntry[]>;
  getPerformance(): Promise<Performance>;

  // Datasets
  getDatasets(): Promise<Dataset[]>;
  createDataset(r: CreateDatasetReq): Promise<void>;
  updateDataset(name: string, patch: { quota_bytes?: number; compression?: string }): Promise<void>;
  deleteDataset(name: string, confirm: string, recursive: boolean): Promise<void>;
  // zfs rewrite como operación larga (admin; gate capabilities.rewrite)
  rewriteDataset(name: string, confirm: string): Promise<{ op_id: string }>;
  // Cifrado nativo por dataset (lote D; admin). La clave viaja en el body
  // JSON y vive solo en memoria de la petición.
  unlockDataset(name: string, key: string): Promise<void>;
  lockDataset(name: string): Promise<void>;
  changeDatasetKey(name: string, currentKey: string, newKey: string): Promise<void>;
  // RAID-Z expansion (lote D; admin; gate capabilities.raidz_expansion)
  expandPool(pool: string, vdev: string, disk: string, confirm: string): Promise<void>;

  // Operaciones largas (runner del backend; registro en memoria)
  getLongOps(): Promise<LongOp[]>;
  cancelLongOp(id: string): Promise<void>;

  // Snapshots
  getSnapshots(dataset?: string): Promise<SnapshotGroup[]>;
  createSnapshot(r: CreateSnapshotReq): Promise<void>;
  deleteSnapshot(full: string, confirm: string): Promise<void>;
  rollback(full: string, confirm: string): Promise<void>;

  // Tareas
  getJobs(): Promise<Job[]>;
  createJob(r: CreateJobReq): Promise<void>;
  updateJob(id: number, r: UpdateJobReq): Promise<void>;
  deleteJob(id: number, confirm: string): Promise<void>;
  runJob(id: number): Promise<void>;
  getJobHistory(): Promise<JobHistoryItem[]>;
  // Replicación ZFS send/recv (local y SSH; mutaciones admin)
  getReplicationJobs(): Promise<ReplicationJob[]>;
  createReplicationJob(r: CreateReplicationReq): Promise<void>;
  updateReplicationJob(id: number, r: UpdateReplicationReq): Promise<void>;
  deleteReplicationJob(id: number, confirm: string): Promise<void>;
  runReplicationJob(id: number): Promise<void>;
  getReplicationSSHKey(): Promise<ReplicationSSHKey>;
  testReplication(host: string, user: string, port: number): Promise<ReplicationTestResult>;

  getSystemTimers(): Promise<SystemTimersResp>;
  setSystemTimerSchedule(t: SystemTimer, schedule: string): Promise<void>;
  migrateSystemTimer(t: SystemTimer, newName: string): Promise<void>;

  // Discos
  getDisks(): Promise<Disk[]>;
  smartTest(dev: string, type: 'short' | 'long'): Promise<void>;
  poweroffDisk(dev: string): Promise<void>;

  // Notificaciones push (Web Push; 503 push_not_configured sin claves VAPID)
  getPushVapidKey(): Promise<{ publicKey: string }>;
  pushSubscribe(sub: PushSubscriptionJSON, lang: 'es' | 'en'): Promise<void>;
  pushUnsubscribe(endpoint: string): Promise<void>;

  // Preferencias de notificación y horario silencioso (del propio usuario)
  getPushPreferences(): Promise<{ preferences: PushPreference[] }>;
  putPushPreference(tipo: PushAlertTipo, enabled: boolean): Promise<void>;
  getPushQuietHours(): Promise<PushQuietHours>;
  putPushQuietHours(q: { enabled: boolean; start: number; end: number }): Promise<void>;
}
