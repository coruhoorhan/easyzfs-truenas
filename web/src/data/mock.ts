// Provider mock: reproduce los datos del mockup validado y simula
// el progreso del scrub de "ssd" y variaciones de temperatura con eventos.
import type { DataProvider } from './provider';
import { emitEvent } from './events';
import { ApiError } from './types';
import type {
  Alert, CreateDatasetReq, CreateJobReq, CreatePoolReq, CreateSnapshotReq, CreateUserReq,
  Dataset, Disk, Job, JobHistoryItem, Overview, Pool, SessionUser, Settings, Snapshot,
  SnapshotGroup, SystemTimer, UpdateJobReq, UserInfo, VersionInfo,
} from './types';

const GiB = 1024 ** 3;
const TiB = 1024 ** 4;
const DAY = 86400_000;

// Latencia simulada de red para que la UI muestre estados de carga
const delay = (ms = 160) => new Promise<void>((r) => setTimeout(r, ms));
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number, h = 6) => {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(h, 0, 0, 0);
  return d;
};

// Genera snapshots automáticos diarios/semanales hacia atrás hasta llegar a `count`
function genSnaps(dataset: string, prefix: string, count: number, stepDays: number, sizeMiB: number): Snapshot[] {
  const out: Snapshot[] = [];
  for (let i = 0; i < count; i++) {
    const d = daysAgo(i * stepDays);
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_06-00`;
    out.push({
      name: `${prefix}-${stamp}`,
      full: `${dataset}@${prefix}-${stamp}`,
      ts: iso(d),
      used_bytes: Math.round(sizeMiB * 1024 ** 2 * (0.7 + ((i * 37) % 60) / 100)),
      kind: 'auto',
    });
  }
  return out;
}

export class MockProvider implements DataProvider {
  readonly isMock = true;

  private session: SessionUser | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private alertSeq = 100;

  private version: VersionInfo = {
    name: 'EasyZFS', version: '0.1.0', build: '2026-08-01', go: 'go1.23.4', os_arch: 'linux/amd64',
    uptime_sec: 17 * 86400 + 4 * 3600, rss_bytes: 21 * 1024 ** 2,
    db_bytes: Math.round(8.4 * 1024 ** 2), db_path: '/var/lib/easyzfs/app.db',
    zfs_version: 'OpenZFS 2.2.6', demo: true,
  };

  private settings: Settings = {
    lang: 'auto', cap_warn_pct: 80, cap_crit_pct: 90, disk_temp_c: 45,
    webhook: '', notify_scrub_errors: true, notify_smart_change: true,
  };

  private users: UserInfo[] = [
    { user: 'admin', role: 'admin', last_login: iso(daysAgo(0, 8)), sessions: 2 },
    { user: 'maria', role: 'user', last_login: iso(daysAgo(1, 21)), sessions: 1 },
  ];

  private pools: Pool[] = [
    {
      name: 'tank', status: 'ONLINE', topo: 'mirror-0 (2×1,86 TB NVMe)',
      used_bytes: Math.round(4.9 * TiB), total_bytes: Math.round(7.2 * TiB),
      frag_pct: 12, comp_ratio: 1.42,
      scrub: { state: 'done', pct: 100, eta_sec: 0, ts: iso(daysAgo(6, 2)), errors: 0 },
      vdevs: [
        { dev: 'nvme0n1', role: 'mirror-0', status: 'ONLINE', temp_c: 48 },
        { dev: 'nvme1n1', role: 'mirror-0', status: 'ONLINE', temp_c: 48 },
      ],
    },
    {
      name: 'ssd', status: 'ONLINE', topo: 'stripe (1×238 GB NVMe)',
      used_bytes: Math.round(0.31 * TiB), total_bytes: Math.round(0.93 * TiB),
      frag_pct: 4, comp_ratio: 1.18,
      scrub: { state: 'running', pct: 62, eta_sec: 12 * 60, ts: iso(daysAgo(0, 5)), errors: 0 },
      vdevs: [{ dev: 'nvme3n1', role: '—', status: 'ONLINE', temp_c: 55 }],
    },
  ];

  private datasets: Dataset[] = [
    { name: 'tank/documentos', type: 'fs', compression: 'lz4', used_bytes: Math.round(1.2 * TiB), avail_bytes: Math.round(2.3 * TiB), quota_bytes: 0, mountpoint: '/tank/documentos' },
    { name: 'tank/fotos', type: 'fs', compression: 'lz4', used_bytes: Math.round(2.8 * TiB), avail_bytes: Math.round(2.3 * TiB), quota_bytes: Math.round(4 * TiB), mountpoint: '/tank/fotos' },
    { name: 'tank/backups', type: 'fs', compression: 'zstd', used_bytes: Math.round(0.9 * TiB), avail_bytes: Math.round(2.3 * TiB), quota_bytes: Math.round(1 * TiB), mountpoint: '/tank/backups' },
    { name: 'ssd/vm-docker', type: 'volume', compression: 'lz4', used_bytes: Math.round(180 * GiB), avail_bytes: Math.round(640 * GiB), quota_bytes: 0, mountpoint: '—' },
    { name: 'ssd/lxc-cache', type: 'fs', compression: 'lz4', used_bytes: Math.round(42 * GiB), avail_bytes: Math.round(640 * GiB), quota_bytes: 0, mountpoint: '/ssd/lxc-cache' },
  ];

  // 148 snapshots en total repartidos por dataset
  private snaps: SnapshotGroup[] = [
    { dataset: 'tank/documentos', snaps: genSnaps('tank/documentos', 'auto', 61, 1, 110) },
    { dataset: 'tank/fotos', snaps: genSnaps('tank/fotos', 'auto', 53, 7, 2400) },
    { dataset: 'tank/backups', snaps: genSnaps('tank/backups', 'semanal', 30, 7, 300) },
    { dataset: 'ssd/vm-docker', snaps: genSnaps('ssd/vm-docker', 'auto', 4, 1, 900) },
  ];

  private jobs: Job[] = [
    { id: 1, tipo: 'snapshot', target: 'tank/documentos', schedule: 'daily@06:00', retention: '1m', enabled: true, last_run: iso(daysAgo(0, 6)), last_result: 'OK', next_run: iso(daysAgo(-1, 6)) },
    { id: 2, tipo: 'snapshot', target: 'tank/fotos', schedule: 'weekly:sun@03:00', retention: '3m', enabled: true, last_run: iso(daysAgo(5, 3)), last_result: 'OK', next_run: iso(daysAgo(-2, 3)) },
    { id: 3, tipo: 'snapshot', target: 'tank/backups', schedule: 'weekly:sun@04:00', retention: '1y', enabled: false, last_run: iso(daysAgo(12, 4)), last_result: 'OK', next_run: '' },
    { id: 4, tipo: 'scrub', target: 'tank', schedule: 'monthly:1@02:00', retention: '', enabled: true, last_run: iso(daysAgo(6, 2)), last_result: '0 errores (4h 12m)', next_run: iso(daysAgo(-2, 2)) },
    { id: 5, tipo: 'scrub', target: 'ssd', schedule: 'weekly:sun@05:00', retention: '', enabled: true, last_run: iso(daysAgo(0, 5)), last_result: 'en curso', next_run: iso(daysAgo(-14, 5)) },
    { id: 6, tipo: 'smart_short', target: 'all', schedule: 'weekly:sat@22:00', retention: '', enabled: true, last_run: iso(daysAgo(6, 22)), last_result: 'OK', next_run: iso(daysAgo(0, 22)) },
    { id: 7, tipo: 'smart_long', target: 'all', schedule: 'monthly:1@23:00', retention: '', enabled: true, last_run: iso(daysAgo(31, 23)), last_result: 'OK', next_run: iso(daysAgo(-31, 23)) },
  ];
  private jobSeq = 8;

  private history: JobHistoryItem[] = [
    { ts: iso(daysAgo(6, 2)), tipo: 'scrub', target: 'tank', ok: true, detail: '0 errores · 4h 12m' },
    { ts: iso(daysAgo(0, 6)), tipo: 'snapshot', target: 'tank/fotos', ok: true, detail: '2,4 GiB referenciados' },
    { ts: iso(daysAgo(1, 22)), tipo: 'smart_short', target: 'nvme0n1', ok: true, detail: 'completado sin errores' },
    { ts: iso(daysAgo(14, 5)), tipo: 'scrub', target: 'ssd', ok: false, detail: 'cancelado por el usuario al 31%' },
  ];

  // Discos físicos del caso real (tras filtrar loop/zvols): eMMC sin SMART ni
  // temperatura, un NVMe Samsung de sistema y tres ORICO de datos.
  private disks: Disk[] = [
    { dev: 'mmcblk0', model: 'eMMC 5.1 (64 GB)', serial: '—', size_bytes: Math.round(58.2 * GiB), temp_c: null, smart: 'unknown', smart_detail: '', pool: '—', hours: 0 },
    { dev: 'nvme3n1', model: 'Samsung MZVLB256HAHQ', serial: 'S417NB0K402133', size_bytes: Math.round(238 * GiB), temp_c: 55, smart: 'ok', smart_detail: 'PASSED', pool: 'ssd', hours: 1577 },
    { dev: 'nvme0n1', model: 'ORICO NVMe SSD', serial: 'ORC2024A01', size_bytes: Math.round(1.86 * TiB), temp_c: 48, smart: 'ok', smart_detail: 'PASSED', pool: 'tank', hours: 8725 },
    { dev: 'nvme1n1', model: 'ORICO NVMe SSD', serial: 'ORC2024A02', size_bytes: Math.round(1.86 * TiB), temp_c: 48, smart: 'ok', smart_detail: 'PASSED', pool: 'tank', hours: 8725 },
    { dev: 'nvme2n1', model: 'ORICO NVMe SSD', serial: 'ORC2024A03', size_bytes: Math.round(1.86 * TiB), temp_c: 48, smart: 'ok', smart_detail: 'PASSED', pool: '—', hours: 8725 },
  ];

  private systemTimers: SystemTimer[] = [
    { source: 'systemd', name: 'Scrub mensual de ZFS (zfsutils)', schedule: 'zfs-scrub-monthly@tank.timer · mensual', next_run: iso(daysAgo(-9, 2)), command: '/usr/sbin/zpool scrub tank' },
    { source: 'systemd', name: 'logrotate', schedule: 'logrotate.timer · diario', next_run: iso(daysAgo(-1, 0)), command: '/usr/sbin/logrotate /etc/logrotate.conf' },
    { source: 'systemd', name: 'man-db', schedule: 'man-db.timer · diario', next_run: iso(daysAgo(-1, 3)), command: '/usr/bin/mandb --quiet' },
    { source: 'cron', name: 'Backup nocturno (crontab de root)', schedule: '30 3 * * *', next_run: iso(daysAgo(-1, 3)), command: '/root/bin/backup.sh --to tank/backups' },
  ];

  private alerts: Alert[] = [
    { id: 1, ts: iso(daysAgo(2, 14)), level: 'warn', source: 'pool/tank', message: 'Fragmentación alta en tank (12%) · considera programar un scrub', acked: false, target: 'pools:tank' },
    { id: 2, ts: iso(new Date()), level: 'info', source: 'scrub/ssd', message: 'Scrub de ssd en curso (62%)', acked: false, target: 'pools:ssd' },
    { id: 4, ts: iso(daysAgo(1, 3)), level: 'warn', source: 'cron/backup', message: 'El backup nocturno terminó con avisos · revisa /var/log/backup.log', acked: false, target: 'tasks' },
    { id: 3, ts: iso(daysAgo(5, 9)), level: 'crit', source: 'smartd/nvme1n1', message: 'smartd: nvme1n1 a 48 °C de forma sostenida · revisar ventilación', acked: false, target: 'disks:nvme1n1' },
  ];

  private activity = [
    { ts: iso(daysAgo(0, 6)), text: 'Snapshot automático creado', detail: 'tank/documentos@auto' },
    { ts: iso(daysAgo(0, 5)), text: 'Scrub iniciado en ssd', detail: 'programación quincenal' },
    { ts: iso(daysAgo(1, 19)), text: 'Cuota modificada', detail: 'tank/backups → 1 TiB' },
  ];

  constructor() {
    // Simulación: progreso del scrub de ssd cada 2 s
    this.timers.push(setInterval(() => {
      const ssd = this.pools.find((p) => p.name === 'ssd');
      if (!ssd || ssd.scrub.state !== 'running') return;
      ssd.scrub.pct = Math.min(100, ssd.scrub.pct + 1);
      ssd.scrub.eta_sec = Math.max(0, ssd.scrub.eta_sec - 20);
      emitEvent({ type: 'scrub.progress', pool: 'ssd', pct: ssd.scrub.pct, eta_sec: ssd.scrub.eta_sec });
      if (ssd.scrub.pct >= 100) {
        ssd.scrub = { state: 'done', pct: 100, eta_sec: 0, ts: iso(new Date()), errors: 0 };
        const alert: Alert = {
          id: ++this.alertSeq, ts: iso(new Date()), level: 'info',
          source: 'scrub/ssd', message: 'Scrub de ssd completado · 0 errores', acked: false,
          target: 'pools:ssd',
        };
        this.alerts.unshift(alert);
        this.activity.unshift({ ts: alert.ts, text: 'Scrub completado en ssd', detail: '0 errores' });
        emitEvent({ type: 'alert.new', alert });
        emitEvent({ type: 'overview' });
      }
    }, 2000));

    // Simulación: variaciones leves de temperatura (solo discos con sensor)
    this.timers.push(setInterval(() => {
      const conTemp = this.disks.filter((d): d is Disk & { temp_c: number } => d.temp_c !== null);
      if (conTemp.length === 0) return;
      const d = conTemp[Math.floor(Math.random() * conTemp.length)];
      d.temp_c = Math.max(38, Math.min(56, d.temp_c + (Math.random() > 0.5 ? 1 : -1)));
      const v = this.pools.flatMap((p) => p.vdevs).find((x) => x.dev === d.dev);
      if (v) v.temp_c = d.temp_c;
      emitEvent({ type: 'disk.temp', dev: d.dev, temp_c: d.temp_c });
    }, 8000));
  }

  // Libera los temporizadores al salir del modo demo
  dispose() { this.timers.forEach(clearInterval); this.timers = []; }

  private totalSnaps() { return this.snaps.reduce((n, g) => n + g.snaps.length, 0); }

  // ---- Sistema ----
  getVersion = async () => { await delay(); return { ...this.version }; };
  getSettings = async () => { await delay(); return { ...this.settings }; };
  putSettings = async (s: Settings) => { await delay(); this.settings = { ...s }; };
  getAlerts = async () => { await delay(); return this.alerts.map((a) => ({ ...a })); };
  ackAlert = async (id: number) => {
    await delay();
    const a = this.alerts.find((x) => x.id === id);
    if (a) a.acked = true;
  };
  getOverview = async (): Promise<Overview> => {
    await delay();
    const used = this.pools.reduce((n, p) => n + p.used_bytes, 0);
    const total = this.pools.reduce((n, p) => n + p.total_bytes, 0);
    const tank = this.pools[0];
    return {
      pools_total: this.pools.length,
      pools_online: this.pools.filter((p) => p.status === 'ONLINE').length,
      cap_used_bytes: used, cap_total_bytes: total,
      snapshots_total: this.totalSnaps(),
      jobs_active: this.jobs.filter((j) => j.enabled).length,
      last_scrub: { pool: tank.name, ts: tank.scrub.ts, errors: tank.scrub.errors },
      alerts: this.alerts.slice(0, 3).map((a) => ({ ...a })),
      activity: this.activity.slice(0, 10).map((a) => ({ ...a })),
    };
  };

  // ---- Auth ----
  login = async (user: string, _password: string): Promise<SessionUser> => {
    await delay(300);
    // En modo demo entra cualquier credencial; rol según el usuario conocido
    const known = this.users.find((u) => u.user === user);
    this.session = { user: user || 'admin', role: known?.role ?? 'admin' };
    return { ...this.session };
  };
  logout = async () => { await delay(80); this.session = null; };
  me = async (): Promise<SessionUser> => {
    await delay(60);
    if (!this.session) throw new ApiError(401, 'unauthorized', 'Sesión no iniciada');
    return { ...this.session };
  };
  setMyPassword = async (_c: string, _n: string) => { await delay(); };

  // ---- Usuarios ----
  getUsers = async () => { await delay(); return this.users.map((u) => ({ ...u })); };
  createUser = async (r: CreateUserReq) => {
    await delay();
    if (this.users.some((u) => u.user === r.user)) throw new ApiError(409, 'conflict', 'El usuario ya existe');
    this.users.push({ user: r.user, role: r.role, last_login: iso(new Date()), sessions: 0 });
  };
  deleteUser = async (name: string, confirm: string) => {
    await delay();
    if (confirm !== name) throw new ApiError(400, 'confirm_required', 'Confirmación incorrecta');
    if (this.session?.user === name) throw new ApiError(400, 'self_delete', 'No puedes eliminarte a ti mismo');
    this.users = this.users.filter((u) => u.user !== name);
  };
  setUserPassword = async (_n: string, _p: string, _c: boolean) => { await delay(); };

  // ---- Pools ----
  getPools = async () => { await delay(); return this.pools.map((p) => ({ ...p, vdevs: p.vdevs.map((v) => ({ ...v })), scrub: { ...p.scrub } })); };
  createPool = async (r: CreatePoolReq) => {
    await delay(400);
    if (r.confirm !== r.name) throw new ApiError(400, 'confirm_required', `Escribe "${r.name}" para confirmar`);
    const size = this.disks.filter((d) => r.disks.includes(d.dev)).reduce((n, d) => n + d.size_bytes, 0);
    const usable = r.topo === 'mirror' ? size / Math.max(1, r.disks.length) : size;
    this.pools.push({
      name: r.name, status: 'ONLINE', topo: `${r.topo} (${r.disks.length} discos)`,
      used_bytes: Math.round(0.001 * usable), total_bytes: Math.round(usable),
      frag_pct: 1, comp_ratio: 1.0,
      scrub: { state: 'none', pct: 0, eta_sec: 0, ts: iso(new Date()), errors: 0 },
      vdevs: r.disks.map((dev) => ({ dev, role: r.topo === 'stripe' ? '—' : `${r.topo}-0`, status: 'ONLINE', temp_c: 33 })),
    });
    this.disks.forEach((d) => { if (r.disks.includes(d.dev)) d.pool = r.name; });
    emitEvent({ type: 'overview' });
  };
  importPool = async (name?: string) => { await delay(); return name ? [] : ['archivo-antiguo']; };
  scrubAction = async (pool: string, action: 'start' | 'pause' | 'stop') => {
    await delay();
    const p = this.pools.find((x) => x.name === pool);
    if (!p) throw new ApiError(404, 'not_found', 'Pool no encontrado');
    if (action === 'start') p.scrub = { state: 'running', pct: 0, eta_sec: 3600, ts: iso(new Date()), errors: 0 };
    if (action === 'pause') p.scrub.state = 'none';
    if (action === 'stop') p.scrub = { state: 'done', pct: p.scrub.pct, eta_sec: 0, ts: iso(new Date()), errors: p.scrub.errors };
  };
  exportPool = async (name: string, confirm: string, _f: boolean, destroy: boolean) => {
    await delay(400);
    if (confirm !== name) throw new ApiError(400, 'confirm_required', `Escribe "${name}" para confirmar`);
    if (destroy) {
      this.pools = this.pools.filter((p) => p.name !== name);
      this.datasets = this.datasets.filter((d) => !d.name.startsWith(name + '/') && d.name !== name);
      this.snaps = this.snaps.filter((g) => !g.dataset.startsWith(name + '/') && g.dataset !== name);
      this.disks.forEach((d) => { if (d.pool === name) d.pool = '—'; });
    }
    emitEvent({ type: 'overview' });
  };
  addVdev = async (pool: string, topo: string, disks: string[], confirm: string) => {
    await delay(300);
    if (confirm !== pool) throw new ApiError(400, 'confirm_required', `Escribe "${pool}" para confirmar`);
    const p = this.pools.find((x) => x.name === pool);
    if (!p) throw new ApiError(404, 'not_found', 'Pool no encontrado');
    const role = topo === 'stripe' ? '—' : `${topo}-${p.vdevs.length}`;
    disks.forEach((dev) => {
      p.vdevs.push({ dev, role, status: 'ONLINE', temp_c: 33 });
      const d = this.disks.find((x) => x.dev === dev);
      if (d) { d.pool = pool; p.total_bytes += d.size_bytes; }
    });
    emitEvent({ type: 'overview' });
  };
  replaceDisk = async (pool: string, oldDev: string, newDev: string, confirm: string) => {
    await delay(300);
    if (confirm !== pool) throw new ApiError(400, 'confirm_required', `Escribe "${pool}" para confirmar`);
    const p = this.pools.find((x) => x.name === pool);
    if (!p) throw new ApiError(404, 'not_found', 'Pool no encontrado');
    const v = p.vdevs.find((x) => x.dev === oldDev);
    if (v) v.dev = newDev;
    const oldD = this.disks.find((x) => x.dev === oldDev);
    if (oldD) oldD.pool = '—';
    const newD = this.disks.find((x) => x.dev === newDev);
    if (newD) newD.pool = pool;
    emitEvent({ type: 'overview' });
  };

  // ---- Datasets ----
  getDatasets = async () => { await delay(); return this.datasets.map((d) => ({ ...d })); };
  createDataset = async (r: CreateDatasetReq) => {
    await delay(250);
    this.datasets.push({
      name: `${r.pool}/${r.name}`, type: r.type, compression: r.compression,
      used_bytes: 1024 ** 2, avail_bytes: Math.round(2 * TiB),
      quota_bytes: r.type === 'volume' ? (r.volsize_bytes ?? 0) : r.quota_bytes,
      mountpoint: r.type === 'fs' ? `/${r.pool}/${r.name}` : '—',
    });
  };
  updateDataset = async (name: string, p: { quota_bytes?: number; compression?: string }) => {
    await delay();
    const d = this.datasets.find((x) => x.name === name);
    if (d) Object.assign(d, p);
  };
  deleteDataset = async (name: string, confirm: string, _r: boolean) => {
    await delay(300);
    if (confirm !== name) throw new ApiError(400, 'confirm_required', 'Confirmación incorrecta');
    this.datasets = this.datasets.filter((d) => d.name !== name);
    this.snaps = this.snaps.filter((g) => g.dataset !== name);
  };

  // ---- Snapshots ----
  getSnapshots = async (dataset?: string) => {
    await delay();
    const list = dataset ? this.snaps.filter((g) => g.dataset === dataset) : this.snaps;
    return list.map((g) => ({ dataset: g.dataset, snaps: g.snaps.map((s) => ({ ...s })) }));
  };
  createSnapshot = async (r: CreateSnapshotReq) => {
    await delay(200);
    const stamp = iso(new Date());
    const targets = r.recursive
      ? this.datasets.filter((d) => d.name === r.dataset || d.name.startsWith(r.dataset + '/')).map((d) => d.name)
      : [r.dataset];
    for (const ds of targets) {
      let g = this.snaps.find((x) => x.dataset === ds);
      if (!g) { g = { dataset: ds, snaps: [] }; this.snaps.unshift(g); }
      g.snaps.unshift({ name: r.name, full: `${ds}@${r.name}`, ts: stamp, used_bytes: 0, kind: 'manual' });
    }
    this.activity.unshift({ ts: stamp, text: 'Snapshot manual creado', detail: `${r.dataset}@${r.name}` });
    emitEvent({ type: 'overview' });
  };
  deleteSnapshot = async (full: string, confirm: string) => {
    await delay(200);
    if (confirm !== full.split('@')[1] && confirm !== full)
      throw new ApiError(400, 'confirm_required', 'Confirmación incorrecta');
    const [ds, name] = full.split('@');
    const g = this.snaps.find((x) => x.dataset === ds);
    if (g) g.snaps = g.snaps.filter((s) => s.name !== name);
  };
  rollback = async (full: string, confirm: string) => {
    await delay(300);
    const [ds] = full.split('@');
    if (confirm !== ds) throw new ApiError(400, 'confirm_required', `Escribe "${ds}" para confirmar`);
    this.activity.unshift({ ts: iso(new Date()), text: 'Rollback ejecutado', detail: full });
  };

  // ---- Tareas ----
  getJobs = async () => { await delay(); return this.jobs.map((j) => ({ ...j })); };
  createJob = async (r: CreateJobReq) => {
    await delay();
    this.jobs.push({
      id: this.jobSeq++, tipo: r.tipo, target: r.target, schedule: r.schedule,
      retention: r.retention ?? '', enabled: true, last_run: '', last_result: '—', next_run: iso(daysAgo(-1)),
    });
  };
  updateJob = async (id: number, r: UpdateJobReq) => {
    await delay();
    const j = this.jobs.find((x) => x.id === id);
    if (j) Object.assign(j, r);
  };
  deleteJob = async (id: number, _c: string) => {
    await delay();
    this.jobs = this.jobs.filter((j) => j.id !== id);
  };
  runJob = async (id: number) => {
    await delay(200);
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    j.last_run = iso(new Date());
    j.last_result = 'OK';
    this.history.unshift({ ts: j.last_run, tipo: j.tipo, target: j.target, ok: true, detail: 'ejecutado manualmente' });
    emitEvent({ type: 'job.finished', id, ok: true, detail: 'ejecutado manualmente' });
  };
  getJobHistory = async () => { await delay(); return this.history.map((h) => ({ ...h })); };
  getSystemTimers = async () => { await delay(); return this.systemTimers.map((s) => ({ ...s })); };

  // ---- Discos ----
  getDisks = async () => { await delay(); return this.disks.map((d) => ({ ...d })); };
  smartTest = async (dev: string, type: 'short' | 'long') => {
    await delay(200);
    this.history.unshift({ ts: iso(new Date()), tipo: type === 'short' ? 'smart_short' : 'smart_long', target: dev, ok: true, detail: 'test iniciado' });
  };
}
