// Implementación real del provider contra el backend Go en /api.
import type { DataProvider } from './provider';
import { ApiError } from './types';
import { notifyAuthExpired } from './events';
import type {
  Alert, CreateDatasetReq, CreateJobReq, CreatePoolReq, CreateSnapshotReq, CreateUserReq,
  Dataset, Disk, Job, JobHistoryItem, Overview, Pool, SessionUser, Settings, SnapshotGroup,
  SystemTimer, UpdateJobReq, UserInfo, VersionInfo,
} from './types';

const BASE = '/api';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch { /* respuesta no JSON */ }
  if (!res.ok) {
    // Sesión expirada: cualquier 401 fuera del propio login/logout fuerza
    // volver a la pantalla de login (lo gestiona el store). Se excluyen
    // /login (credenciales incorrectas no son sesión expirada) y /logout
    // (evita bucles al cerrar una sesión ya caducada).
    if (res.status === 401 && path !== '/login' && path !== '/logout') notifyAuthExpired();
    const e = json as { error?: string; message?: string } | undefined;
    throw new ApiError(res.status, e?.error ?? 'http_error', e?.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

const get = <T>(p: string) => req<T>('GET', p);
const post = <T>(p: string, b?: unknown) => req<T>('POST', p, b);
const patch = <T>(p: string, b?: unknown) => req<T>('PATCH', p, b);
const put = <T>(p: string, b?: unknown) => req<T>('PUT', p, b);
const del = <T>(p: string, b?: unknown) => req<T>('DELETE', p, b);
const enc = encodeURIComponent;

export class HttpProvider implements DataProvider {
  readonly isMock = false;

  getVersion = () => get<VersionInfo>('/version');
  getSettings = () => get<Settings>('/settings');
  putSettings = (s: Settings) => put<void>('/settings', s);
  getAlerts = () => get<Alert[]>('/alerts');
  ackAlert = (id: number) => post<void>(`/alerts/${id}/ack`);
  getOverview = () => get<Overview>('/overview');

  login = (user: string, password: string) => post<SessionUser>('/login', { user, password });
  logout = () => post<void>('/logout');
  me = () => get<SessionUser>('/me');
  setMyPassword = (current: string, next: string) => post<void>('/me/password', { current, new: next });

  getUsers = () => get<UserInfo[]>('/users');
  createUser = (r: CreateUserReq) => post<void>('/users', r);
  deleteUser = (name: string, confirm: string) => del<void>(`/users/${enc(name)}`, { confirm });
  setUserPassword = (name: string, next: string, closeSessions: boolean) =>
    post<void>(`/users/${enc(name)}/password`, { new: next, close_sessions: closeSessions });

  getPools = () => get<Pool[]>('/pools');
  createPool = (r: CreatePoolReq) => post<void>('/pools', r);
  importPool = async (name?: string): Promise<string[]> => {
    const r = await post<{ importable?: string[] } | string[]>('/pools/import', name ? { name } : {});
    return Array.isArray(r) ? r : (r.importable ?? []);
  };
  scrubAction = (pool: string, action: 'start' | 'pause' | 'stop') =>
    post<void>(`/pools/${enc(pool)}/scrub`, { action });
  exportPool = (name: string, confirm: string, force: boolean, destroy: boolean) =>
    post<void>(`/pools/${enc(name)}/export`, { confirm, force, destroy });
  addVdev = (pool: string, topo: string, disks: string[], confirm: string) =>
    post<void>(`/pools/${enc(pool)}/vdev`, { topo, disks, confirm });
  replaceDisk = (pool: string, oldDev: string, newDev: string, confirm: string) =>
    post<void>(`/pools/${enc(pool)}/replace`, { old_dev: oldDev, new_dev: newDev, confirm });
  vdevAction = (pool: string, dev: string, action: 'offline' | 'online' | 'detach', confirm?: string) =>
    post<void>(`/pools/${enc(pool)}/vdev/action`, { dev, action, confirm });

  getDatasets = () => get<Dataset[]>('/datasets');
  createDataset = (r: CreateDatasetReq) => post<void>('/datasets', r);
  updateDataset = (name: string, p: { quota_bytes?: number; compression?: string }) =>
    patch<void>(`/datasets/${enc(name)}`, p);
  deleteDataset = (name: string, confirm: string, recursive: boolean) =>
    del<void>(`/datasets/${enc(name)}`, { confirm, recursive });

  getSnapshots = (dataset?: string) =>
    get<SnapshotGroup[]>('/snapshots' + (dataset ? `?dataset=${enc(dataset)}` : ''));
  createSnapshot = (r: CreateSnapshotReq) => post<void>('/snapshots', r);
  deleteSnapshot = (full: string, confirm: string) => del<void>(`/snapshots/${enc(full)}`, { confirm });
  rollback = (full: string, confirm: string) => post<void>(`/snapshots/${enc(full)}/rollback`, { confirm });

  getJobs = () => get<Job[]>('/jobs');
  createJob = (r: CreateJobReq) => post<void>('/jobs', r);
  updateJob = (id: number, r: UpdateJobReq) => patch<void>(`/jobs/${id}`, r);
  deleteJob = (id: number, confirm: string) => del<void>(`/jobs/${id}`, { confirm });
  runJob = (id: number) => post<void>(`/jobs/${id}/run`);
  getJobHistory = () => get<JobHistoryItem[]>('/jobs/history');
  getSystemTimers = () => get<SystemTimer[]>('/system-timers');

  getDisks = () => get<Disk[]>('/disks');
  smartTest = (dev: string, type: 'short' | 'long') => post<void>(`/disks/${enc(dev)}/smart-test`, { type });
  poweroffDisk = (dev: string) => post<void>(`/disks/${enc(dev)}/poweroff`, {});
}
