// Interfaz DataProvider: abstrae el origen de datos (HTTP real o mock demo).
import type {
  Alert, CreateDatasetReq, CreateJobReq, CreatePoolReq, CreateSnapshotReq, CreateUserReq,
  Dataset, Disk, Job, JobHistoryItem, Overview, Pool, PushSubscriptionJSON, SessionUser, Settings,
  SnapshotGroup, SystemTimer, UpdateJobReq, UserInfo, VersionInfo,
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

  // Auth y sesión
  login(user: string, password: string): Promise<SessionUser>;
  logout(): Promise<void>;
  me(): Promise<SessionUser>;
  setMyPassword(current: string, next: string): Promise<void>;

  // Usuarios (admin)
  getUsers(): Promise<UserInfo[]>;
  createUser(r: CreateUserReq): Promise<void>;
  deleteUser(name: string, confirm: string): Promise<void>;
  setUserPassword(name: string, next: string, closeSessions: boolean): Promise<void>;

  // Pools
  getPools(): Promise<Pool[]>;
  createPool(r: CreatePoolReq): Promise<void>;
  importPool(name?: string): Promise<string[]>;
  scrubAction(pool: string, action: 'start' | 'pause' | 'stop'): Promise<void>;
  exportPool(name: string, confirm: string, force: boolean, destroy: boolean): Promise<void>;
  addVdev(pool: string, topo: string, disks: string[], confirm: string): Promise<void>;
  replaceDisk(pool: string, oldDev: string, newDev: string, confirm: string): Promise<void>;
  vdevAction(pool: string, dev: string, action: 'offline' | 'online' | 'detach', confirm?: string): Promise<void>;

  // Datasets
  getDatasets(): Promise<Dataset[]>;
  createDataset(r: CreateDatasetReq): Promise<void>;
  updateDataset(name: string, patch: { quota_bytes?: number; compression?: string }): Promise<void>;
  deleteDataset(name: string, confirm: string, recursive: boolean): Promise<void>;

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
  getSystemTimers(): Promise<SystemTimer[]>;
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
}
