// Todos los modales de la app. Cada uno gestiona su estado y llama al provider;
// al terminar con éxito: cierra y refresca los datos de las vistas.
import { useEffect, useMemo, useState } from 'react';
import { getProvider } from '../data';
import { errorMessage, useApp } from '../ui/store';
import { fmtBytes, parseSize } from '../ui/format';
import { ModalBox, useModal } from './Modal';
import { Seg } from './ui';
import type { Dataset, Disk, Job, Pool, Topo } from '../data/types';

// ---------- utilidades comunes ----------
function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    fn().then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return data;
}

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Botón de envío con estado de carga
function SubmitBtn({ label, busy, disabled, danger }: {
  label: string; busy: boolean; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button type="submit" className={`btn ${danger ? 'solid-danger' : 'primary'}`} disabled={busy || disabled}>
      {busy ? '…' : label}
    </button>
  );
}

// ---------- host: renderiza el modal activo ----------
export function ModalHost() {
  const { modal, closeModal } = useModal();
  if (!modal) return null;
  const p = modal.props ?? {};
  switch (modal.name) {
    case 'newsnap': return <SnapshotModal preset={p.dataset as string | undefined} onClose={closeModal} />;
    case 'newpool': return <NewPoolModal onClose={closeModal} />;
    case 'newds': return <NewDatasetModal vol={!!p.vol} onClose={closeModal} />;
    case 'editds': return <EditDatasetModal ds={p.ds as Dataset} onClose={closeModal} />;
    case 'delds': return <DeleteDatasetModal name={p.name as string} onClose={closeModal} />;
    case 'newtask': return <NewTaskModal onClose={closeModal} />;
    case 'sched': return <EditScheduleModal job={p.job as Job} onClose={closeModal} />;
    case 'export': return <ExportPoolModal pool={p.pool as string} onClose={closeModal} />;
    case 'addvdev': return <PoolDiskModal pool={p.pool as string} mode="vdev" onClose={closeModal} />;
    case 'replace': return <PoolDiskModal pool={p.pool as string} mode="replace" onClose={closeModal} />;
    case 'newuser': return <NewUserModal onClose={closeModal} />;
    case 'mypass': return <MyPasswdModal onClose={closeModal} />;
    case 'passwd': return <PasswdModal user={p.user as string} onClose={closeModal} />;
    case 'deluser': return <DeleteUserModal user={p.user as string} onClose={closeModal} />;
    case 'rollback': return <RollbackModal full={p.full as string} onClose={closeModal} />;
    case 'delsnap': return <DeleteSnapModal full={p.full as string} onClose={closeModal} />;
    default: return null;
  }
}

// ---------- crear snapshot ----------
function SnapshotModal({ preset, onClose }: { preset?: string; onClose: () => void }) {
  const { t, refresh } = useApp();
  const datasets = useLoad(() => getProvider().getDatasets());
  const pools = useLoad(() => getProvider().getPools());
  const [target, setTarget] = useState(preset ?? '');
  const [name, setName] = useState(`manual-${todayStamp()}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!target && datasets?.length) setTarget(datasets[0].name);
  }, [datasets, target]);

  const isPoolTarget = pools?.some((pl) => pl.name === target) ?? false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await getProvider().createSnapshot({ dataset: target, name, recursive: isPoolTarget });
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('nsn_title')}</h3>
        <p className="desc">{t('nsn_desc')}</p>
        <label htmlFor="sn-target">{t('nsn_dataset')}</label>
        <select id="sn-target" value={target} onChange={(e) => setTarget(e.target.value)}>
          {(datasets ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          {(pools ?? []).map((pl) => <option key={pl.name} value={pl.name}>{pl.name} {t('nsn_recursive')}</option>)}
        </select>
        <label htmlFor="sn-name">{t('nsn_name')}</label>
        <input id="sn-name" value={name} onChange={(e) => setName(e.target.value)} required />
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('nsn_create')} busy={busy} disabled={!target || !name.trim()} />
        </div>
      </form>
    </ModalBox>
  );
}

// ---------- crear pool (asistente 2 pasos) ----------
const TOPO_MIN: Record<Topo, number> = { stripe: 1, mirror: 2, raidz1: 3, raidz2: 4, raidz3: 5 };

function NewPoolModal({ onClose }: { onClose: () => void }) {
  const { t, refresh } = useApp();
  const disks = useLoad(() => getProvider().getDisks());
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [topo, setTopo] = useState<Topo>('mirror');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const free = useMemo(() => (disks ?? []).filter((d) => d.pool === '—' || d.pool === ''), [disks]);
  const toggle = (dev: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(dev)) n.delete(dev); else n.add(dev);
    return n;
  });

  // Capacidad útil estimada según topología
  const usable = useMemo(() => {
    const chosen = free.filter((d) => sel.has(d.dev));
    if (!chosen.length) return 0;
    const total = chosen.reduce((n, d) => n + d.size_bytes, 0);
    if (topo === 'stripe') return total;
    if (topo === 'mirror') return Math.min(...chosen.map((d) => d.size_bytes));
    const parity = topo === 'raidz1' ? 1 : topo === 'raidz2' ? 2 : 3;
    return Math.min(...chosen.map((d) => d.size_bytes)) * Math.max(0, chosen.length - parity);
  }, [free, sel, topo]);

  const minDisks = TOPO_MIN[topo];
  const canNext = name.trim().length > 0;
  const canCreate = sel.size >= minDisks && confirm.trim() === name.trim();

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await getProvider().createPool({ name: name.trim(), topo, disks: [...sel], confirm: confirm.trim() });
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <h3>{t('np_title')}</h3>
      <p className="desc">{t('np_desc')}</p>
      <div className="chips" style={{ marginTop: 12 }}>
        <span className={`chip ${step === 1 ? 'on' : ''}`}>{t('np_step1')}</span>
        <span className={`chip ${step === 2 ? 'on' : ''}`}>{t('np_step2')}</span>
      </div>

      {step === 1 && (<>
        <label htmlFor="np-name">{t('np_name')}</label>
        <input id="np-name" placeholder={t('np_name_ph')} value={name}
          onChange={(e) => setName(e.target.value)} />
        <label>{t('np_topo')}</label>
        <Seg<Topo> ariaLabel={t('np_topo')} value={topo} onChange={setTopo}
          options={[
            { v: 'mirror', label: 'Mirror' }, { v: 'raidz1', label: 'RaidZ1' },
            { v: 'raidz2', label: 'RaidZ2' }, { v: 'stripe', label: 'Stripe' },
          ]} />
        {!canNext && <p className="form-err">{t('np_need_name')}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={!canNext} onClick={() => setStep(2)}>{t('np_next')}</button>
        </div>
      </>)}

      {step === 2 && (<>
        <label>{t('np_disks')}</label>
        {free.length === 0 && <p className="desc" style={{ marginTop: 8 }}>{t('np_no_disks')}</p>}
        {free.map((d: Disk) => (
          <div key={d.dev} className={`diskpick ${sel.has(d.dev) ? 'sel' : ''}`} role="checkbox"
            aria-checked={sel.has(d.dev)} tabIndex={0}
            onClick={() => toggle(d.dev)}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(d.dev); } }}>
            <span className="mono">{d.dev}</span>
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text2)' }}>{d.model} · {fmtBytes(d.size_bytes)}</span>
            <span className="badge info">{t('np_free')}</span>
          </div>
        ))}
        <p className="desc" style={{ marginTop: 14 }}>
          ⚠️ {t('np_warn')} {usable > 0 && <>{t('np_usable')}: <b>~{fmtBytes(usable)}</b>.</>}
        </p>
        {sel.size < minDisks && <p className="form-err">{t('np_need_disks', { n: minDisks })}</p>}
        <label htmlFor="np-confirm">{t('ex_confirm_lbl')}</label>
        <input id="np-confirm" placeholder={name.trim()} value={confirm}
          onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={() => setStep(1)}>{t('np_back')}</button>
          <button type="button" className="btn primary" disabled={!canCreate || busy} onClick={submit}>
            {busy ? '…' : t('np_create')}
          </button>
        </div>
      </>)}
    </ModalBox>
  );
}

// ---------- nuevo dataset / zvol ----------
function NewDatasetModal({ vol, onClose }: { vol: boolean; onClose: () => void }) {
  const { t, refresh } = useApp();
  const pools = useLoad(() => getProvider().getPools());
  const [pool, setPool] = useState('');
  const [name, setName] = useState('');
  const [comp, setComp] = useState<'lz4' | 'zstd' | 'off'>('lz4');
  const [quota, setQuota] = useState('');
  const [volsize, setVolsize] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (!pool && pools?.length) setPool(pools[0].name); }, [pools, pool]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await getProvider().createDataset({
        pool, name: name.trim(), type: vol ? 'volume' : 'fs', compression: comp,
        quota_bytes: parseSize(quota), volsize_bytes: vol ? parseSize(volsize) : undefined,
      });
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{vol ? t('nds_title_vol') : t('nds_title_fs')}</h3>
        <p className="desc">{t('nds_desc')}</p>
        <label htmlFor="nd-pool">{t('nds_pool')}</label>
        <select id="nd-pool" value={pool} onChange={(e) => setPool(e.target.value)}>
          {(pools ?? []).map((p: Pool) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <label htmlFor="nd-name">{t('nds_name')}</label>
        <input id="nd-name" placeholder={t('nds_name_ph')} value={name} onChange={(e) => setName(e.target.value)} required />
        <label htmlFor="nd-comp">{t('nds_comp')}</label>
        <select id="nd-comp" value={comp} onChange={(e) => setComp(e.target.value as 'lz4' | 'zstd' | 'off')}>
          <option value="lz4">{t('nds_comp_rec')}</option>
          <option value="zstd">zstd</option>
          <option value="off">{t('nds_comp_off')}</option>
        </select>
        {vol ? (<>
          <label htmlFor="nd-volsize">{t('nds_volsize')}</label>
          <input id="nd-volsize" placeholder={t('nds_volsize_ph')} value={volsize} onChange={(e) => setVolsize(e.target.value)} required />
        </>) : (<>
          <label htmlFor="nd-quota">{t('nds_quota')}</label>
          <input id="nd-quota" placeholder={t('nds_quota_ph')} value={quota} onChange={(e) => setQuota(e.target.value)} />
        </>)}
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('create')} busy={busy} disabled={!name.trim() || !pool || (vol && !volsize.trim())} />
        </div>
      </form>
    </ModalBox>
  );
}

// ---------- editar dataset (cuota / compresión) ----------
function EditDatasetModal({ ds, onClose }: { ds: Dataset; onClose: () => void }) {
  const { t, refresh } = useApp();
  const [comp, setComp] = useState(ds.compression);
  const [quota, setQuota] = useState(ds.quota_bytes ? fmtBytes(ds.quota_bytes).replace('iB', '').replace('B', '') : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await getProvider().updateDataset(ds.name, { compression: comp, quota_bytes: parseSize(quota) });
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('eds_title')}</h3>
        <p className="desc mono">{ds.name}</p>
        <label htmlFor="ed-comp">{t('nds_comp')}</label>
        <select id="ed-comp" value={comp} onChange={(e) => setComp(e.target.value)}>
          <option value="lz4">lz4</option>
          <option value="zstd">zstd</option>
          <option value="off">{t('nds_comp_off')}</option>
        </select>
        {ds.type === 'fs' && (<>
          <label htmlFor="ed-quota">{t('nds_quota')}</label>
          <input id="ed-quota" placeholder={t('nds_quota_ph')} value={quota} onChange={(e) => setQuota(e.target.value)} />
        </>)}
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('save')} busy={busy} />
        </div>
      </form>
    </ModalBox>
  );
}

// ---------- eliminar dataset (confirmación escrita) ----------
function DeleteDatasetModal({ name, onClose }: { name: string; onClose: () => void }) {
  const { t, refresh, isAdmin } = useApp();
  const [confirm, setConfirm] = useState('');
  const [recursive, setRecursive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await getProvider().deleteDataset(name, confirm.trim(), recursive);
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('dds_title')}</h3>
        <p className="desc">{t('dds_desc')}</p>
        <p className="desc mono" style={{ marginTop: 8 }}>{name}</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, textTransform: 'none', fontSize: 13.5, fontWeight: 500, color: 'var(--text)', marginTop: 16 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
          {t('dds_recursive')}
        </label>
        <label htmlFor="dd-confirm">{t('ex_confirm_lbl').replace('pool', 'dataset')}</label>
        <input id="dd-confirm" placeholder={name} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('delete')} busy={busy} danger disabled={!isAdmin || confirm.trim() !== name} />
        </div>
      </form>
    </ModalBox>
  );
}

// ---------- exportar pool ----------
function ExportPoolModal({ pool, onClose }: { pool: string; onClose: () => void }) {
  const { t, refresh, isAdmin } = useApp();
  const [force, setForce] = useState(false);
  const [destroy, setDestroy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await getProvider().exportPool(pool, confirm.trim(), force, destroy);
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('ex_title')}</h3>
        <p className="desc">{t('ex_desc')} <b className="mono">{pool}</b></p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, textTransform: 'none', fontSize: 13.5, fontWeight: 500, color: 'var(--text)', marginTop: 16 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={force} onChange={(e) => setForce(e.target.checked)} />
          {t('ex_force')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, textTransform: 'none', fontSize: 13.5, fontWeight: 500, color: 'var(--err)' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={destroy} onChange={(e) => setDestroy(e.target.checked)} />
          {t('ex_destroy')}
        </label>
        <label htmlFor="ex-confirm">{t('ex_confirm_lbl')}</label>
        <input id="ex-confirm" placeholder={pool} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('ex_btn')} busy={busy} danger disabled={!isAdmin || confirm.trim() !== pool} />
        </div>
      </form>
    </ModalBox>
  );
}

// ---------- añadir vdev / sustituir disco (confirmación escrita) ----------
// Modal genérico para las dos operaciones destructivas de pool: pide el
// nombre del pool para confirmar y envía {confirm} al backend.
function PoolDiskModal({ pool, mode, onClose }: { pool: string; mode: 'vdev' | 'replace'; onClose: () => void }) {
  const { t, refresh, isAdmin } = useApp();
  const disks = useLoad(() => getProvider().getDisks());
  const pools = useLoad(() => getProvider().getPools());
  const [topo, setTopo] = useState<Topo>('mirror');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [oldDev, setOldDev] = useState('');
  const [newDev, setNewDev] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const free = useMemo(() => (disks ?? []).filter((d) => d.pool === '—' || d.pool === ''), [disks]);
  const current = useMemo(() => pools?.find((pl) => pl.name === pool)?.vdevs ?? [], [pools, pool]);
  const toggle = (dev: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(dev)) n.delete(dev); else n.add(dev);
    return n;
  });

  useEffect(() => {
    if (mode === 'replace') {
      if (!oldDev && current.length) setOldDev(current[0].dev);
      if (!newDev && free.length) setNewDev(free[0].dev);
    }
  }, [mode, current, free, oldDev, newDev]);

  const confirmed = confirm.trim() === pool;
  const minDisks = TOPO_MIN[topo];
  const valid = mode === 'vdev'
    ? sel.size >= minDisks
    : !!oldDev && !!newDev && oldDev !== newDev;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      if (mode === 'vdev') await getProvider().addVdev(pool, topo, [...sel], confirm.trim());
      else await getProvider().replaceDisk(pool, oldDev, newDev, confirm.trim());
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{mode === 'vdev' ? t('av_title') : t('rp_title')}</h3>
        <p className="desc">
          {t(mode === 'vdev' ? 'av_desc' : 'rp_desc')} <b className="mono">{pool}</b>
        </p>

        {mode === 'vdev' && (<>
          <label>{t('np_topo')}</label>
          <Seg<Topo> ariaLabel={t('np_topo')} value={topo} onChange={setTopo}
            options={[
              { v: 'mirror', label: 'Mirror' }, { v: 'raidz1', label: 'RaidZ1' },
              { v: 'raidz2', label: 'RaidZ2' }, { v: 'stripe', label: 'Stripe' },
            ]} />
          <label>{t('np_disks')}</label>
          {free.length === 0 && <p className="desc" style={{ marginTop: 8 }}>{t('np_no_disks')}</p>}
          {free.map((d: Disk) => (
            <div key={d.dev} className={`diskpick ${sel.has(d.dev) ? 'sel' : ''}`} role="checkbox"
              aria-checked={sel.has(d.dev)} tabIndex={0}
              onClick={() => toggle(d.dev)}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(d.dev); } }}>
              <span className="mono">{d.dev}</span>
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text2)' }}>{d.model} · {fmtBytes(d.size_bytes)}</span>
              <span className="badge info">{t('np_free')}</span>
            </div>
          ))}
          {sel.size < minDisks && <p className="form-err">{t('np_need_disks', { n: minDisks })}</p>}
        </>)}

        {mode === 'replace' && (<>
          <label htmlFor="rp-old">{t('rp_old')}</label>
          <select id="rp-old" value={oldDev} onChange={(e) => setOldDev(e.target.value)}>
            {current.map((v) => <option key={v.dev} value={v.dev}>{v.dev} ({v.role})</option>)}
          </select>
          <label htmlFor="rp-new">{t('rp_new')}</label>
          {free.length === 0 && <p className="desc" style={{ marginTop: 8 }}>{t('np_no_disks')}</p>}
          {free.length > 0 && (
            <select id="rp-new" value={newDev} onChange={(e) => setNewDev(e.target.value)}>
              {free.map((d) => <option key={d.dev} value={d.dev}>{d.dev} · {d.model} · {fmtBytes(d.size_bytes)}</option>)}
            </select>
          )}
        </>)}

        <label htmlFor="pd-confirm">{t('ex_confirm_lbl')}</label>
        <input id="pd-confirm" placeholder={pool} value={confirm}
          onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={mode === 'vdev' ? t('av_btn') : t('rp_btn')} busy={busy} danger
            disabled={!isAdmin || !confirmed || !valid} />
        </div>
      </form>
    </ModalBox>
  );
}

// ---------- rollback de snapshot ----------
function RollbackModal({ full, onClose }: { full: string; onClose: () => void }) {
  const { t, refresh, isAdmin } = useApp();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ds, snap] = full.split('@');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await getProvider().rollback(full, confirm.trim());
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('rb_title')}</h3>
        <p className="desc">{t('rb_desc1')} <b className="mono">{ds}</b> {t('rb_desc2')} <b className="mono">{snap}</b>.</p>
        <p className="desc" style={{ marginTop: 10, color: 'var(--err)' }}>⚠️ {t('rb_warn')}</p>
        <label htmlFor="rb-confirm">{t('rb_confirm_lbl')}</label>
        <input id="rb-confirm" placeholder={ds} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('rb_btn')} busy={busy} danger disabled={!isAdmin || confirm.trim() !== ds} />
        </div>
      </form>
    </ModalBox>
  );
}

// ---------- eliminar snapshot ----------
function DeleteSnapModal({ full, onClose }: { full: string; onClose: () => void }) {
  const { t, refresh, isAdmin } = useApp();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [, snap] = full.split('@');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await getProvider().deleteSnapshot(full, confirm.trim());
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('dsn_title')}</h3>
        <p className="desc">{t('dsn_desc')}</p>
        <p className="desc mono" style={{ marginTop: 8 }}>{full}</p>
        <label htmlFor="ds-confirm">{t('dsn_confirm_lbl')}</label>
        <input id="ds-confirm" placeholder={snap} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('delete')} busy={busy} danger disabled={!isAdmin || confirm.trim() !== snap} />
        </div>
      </form>
    </ModalBox>
  );
}

// ---------- tareas programadas ----------
type Freq = 'hourly' | 'daily' | 'weekly' | 'monthly';
const WD_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Wd = (typeof WD_KEYS)[number];

interface SchedState { freq: Freq; minute: string; time: string; weekday: Wd; monthday: number }

// Construye la cadena schedule del contrato: hourly@:15 | daily@06:00 | weekly:sun@03:00 | monthly:1@02:00
export function buildSchedule(s: SchedState): string {
  switch (s.freq) {
    case 'hourly': return `hourly@:${s.minute.padStart(2, '0')}`;
    case 'daily': return `daily@${s.time}`;
    case 'weekly': return `weekly:${s.weekday}@${s.time}`;
    case 'monthly': return `monthly:${s.monthday}@${s.time}`;
  }
}

// Parsea una cadena schedule al estado del editor
export function parseSchedule(sc: string): SchedState {
  const def: SchedState = { freq: 'daily', minute: '15', time: '06:00', weekday: 'sun', monthday: 1 };
  try {
    if (sc.startsWith('hourly@:')) return { ...def, freq: 'hourly', minute: sc.slice(8) || '00' };
    if (sc.startsWith('daily@')) return { ...def, freq: 'daily', time: sc.slice(6) || '06:00' };
    const w = /^weekly:(\w+)@(.+)$/.exec(sc);
    if (w) return { ...def, freq: 'weekly', weekday: (WD_KEYS.includes(w[1] as Wd) ? w[1] : 'sun') as Wd, time: w[2] };
    const m = /^monthly:(\d+)@(.+)$/.exec(sc);
    if (m) return { ...def, freq: 'monthly', monthday: parseInt(m[1], 10) || 1, time: m[2] };
  } catch { /* formato desconocido: valores por defecto */ }
  return def;
}

// Describe una schedule en lenguaje natural (para la lista de tareas)
export function describeSchedule(sc: string, t: (k: never, vars?: Record<string, string | number>) => string): string {
  const s = parseSchedule(sc);
  const T = t as (k: string, vars?: Record<string, string | number>) => string;
  switch (s.freq) {
    case 'hourly': return `${T('freq_hourly')} · :${s.minute.padStart(2, '0')}`;
    case 'daily': return `${T('freq_daily')} · ${s.time}`;
    case 'weekly': return `${T('freq_weekly')} · ${T(`wdl_${s.weekday}`)} ${s.time}`;
    case 'monthly': return `${T('freq_monthly')} · ${s.monthday} · ${s.time}`;
  }
}

// Campos de frecuencia compartidos entre "nueva tarea" y "editar programación"
function ScheduleFields({ s, set, showRetention, retention, setRetention, t }: {
  s: SchedState; set: (v: SchedState) => void;
  showRetention: boolean; retention: string; setRetention: (v: string) => void;
  t: (k: never, vars?: Record<string, string | number>) => string;
}) {
  const T = t as (k: string) => string;
  return (<>
    <label>{T('nt_freq')}</label>
    <Seg<Freq> value={s.freq} onChange={(freq) => set({ ...s, freq })} ariaLabel={T('nt_freq')}
      options={[
        { v: 'hourly', label: T('nt_hourly') }, { v: 'daily', label: T('nt_daily') },
        { v: 'weekly', label: T('nt_weekly') }, { v: 'monthly', label: T('nt_monthly') },
      ]} />
    {s.freq === 'hourly' && (<>
      <label htmlFor="sch-min">{T('nt_minute')}</label>
      <input id="sch-min" type="number" min={0} max={59} value={s.minute}
        onChange={(e) => set({ ...s, minute: e.target.value })} />
    </>)}
    {s.freq === 'weekly' && (<>
      <label>{T('nt_weekday')}</label>
      <Seg<Wd> value={s.weekday} onChange={(weekday) => set({ ...s, weekday })} ariaLabel={T('nt_weekday')}
        options={WD_KEYS.map((d) => ({ v: d, label: T(`wd_${d}`) }))} />
    </>)}
    {s.freq === 'monthly' && (<>
      <label htmlFor="sch-md">{T('nt_monthday')}</label>
      <input id="sch-md" type="number" min={1} max={28} value={s.monthday}
        onChange={(e) => set({ ...s, monthday: parseInt(e.target.value, 10) || 1 })} />
    </>)}
    {s.freq !== 'hourly' && (<>
      <label htmlFor="sch-time">{T('nt_time')}</label>
      <input id="sch-time" type="time" value={s.time} onChange={(e) => set({ ...s, time: e.target.value })} />
    </>)}
    {showRetention && (<>
      <label htmlFor="sch-ret">{T('nt_ret')}</label>
      <select id="sch-ret" value={retention} onChange={(e) => setRetention(e.target.value)}>
        <option value="1w">{T('nt_ret_1w')}</option>
        <option value="1m">{T('nt_ret_1m')}</option>
        <option value="3m">{T('nt_ret_3m')}</option>
        <option value="1y">{T('nt_ret_1y')}</option>
      </select>
    </>)}
  </>);
}

function NewTaskModal({ onClose }: { onClose: () => void }) {
  const { t, refresh } = useApp();
  const datasets = useLoad(() => getProvider().getDatasets());
  const pools = useLoad(() => getProvider().getPools());
  const [tipo, setTipo] = useState<'snapshot' | 'scrub' | 'smart'>('snapshot');
  const [target, setTarget] = useState('');
  const [sched, setSched] = useState<SchedState>({ freq: 'daily', minute: '15', time: '06:00', weekday: 'sun', monthday: 1 });
  const [retention, setRetention] = useState('1m');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (!target && datasets?.length) setTarget(datasets[0].name); }, [datasets, target]);
  useEffect(() => {
    // Ajusta el objetivo por defecto según el tipo de tarea
    if (tipo === 'smart') setTarget('all');
    else if (tipo === 'scrub' && pools?.length) setTarget(pools[0].name);
    else if (tipo === 'snapshot' && datasets?.length) setTarget(datasets[0].name);
  }, [tipo, pools, datasets]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const jobType = tipo === 'smart' ? 'smart_short' : tipo;
    try {
      await getProvider().createJob({
        tipo: jobType, target, schedule: buildSchedule(sched),
        retention: tipo === 'snapshot' ? retention : undefined,
      });
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('nt_title')}</h3>
        <p className="desc">{t('nt_desc')}</p>
        <label>{t('nt_type')}</label>
        <Seg value={tipo} onChange={setTipo} ariaLabel={t('nt_type')}
          options={[
            { v: 'snapshot', label: t('tk_type_snapshot') },
            { v: 'scrub', label: t('tk_type_scrub') },
            { v: 'smart', label: t('tk_type_smart') },
          ]} />
        <label htmlFor="nt-target">{t('nt_target')}</label>
        <select id="nt-target" value={target} onChange={(e) => setTarget(e.target.value)}>
          {tipo === 'smart' && <option value="all">{t('nt_all_disks')}</option>}
          {tipo === 'scrub' && (pools ?? []).map((p) => <option key={p.name} value={p.name}>{p.name} {t('nt_pool_full')}</option>)}
          {tipo === 'snapshot' && (<>
            {(datasets ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            {(pools ?? []).map((p) => <option key={p.name} value={p.name}>{p.name} {t('nt_pool_full')}</option>)}
          </>)}
        </select>
        <ScheduleFields s={sched} set={setSched} showRetention={tipo === 'snapshot'}
          retention={retention} setRetention={setRetention} t={t as never} />
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('nt_create')} busy={busy} disabled={!target} />
        </div>
      </form>
    </ModalBox>
  );
}

function EditScheduleModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const { t, refresh, isAdmin } = useApp();
  const [sched, setSched] = useState<SchedState>(() => parseSchedule(job.schedule));
  const [retention, setRetention] = useState(job.retention || '1m');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await getProvider().updateJob(job.id, {
        schedule: buildSchedule(sched),
        retention: job.tipo === 'snapshot' ? retention : undefined,
      });
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setErr('');
    try {
      await getProvider().deleteJob(job.id, String(job.id));
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('et_title')}</h3>
        <p className="desc">{t('et_job')}: <b className="mono">{job.tipo} · {job.target}</b></p>
        <ScheduleFields s={sched} set={setSched} showRetention={job.tipo === 'snapshot'}
          retention={retention} setRetention={setRetention} t={t as never} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, textTransform: 'none', fontSize: 13.5, fontWeight: 500, color: 'var(--text)', marginTop: 16 }}>
          <input type="checkbox" defaultChecked style={{ width: 'auto' }} /> {t('et_notify')}
        </label>
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          {isAdmin && <button type="button" className="btn danger" style={{ marginRight: 'auto' }} onClick={remove} disabled={busy}>{t('et_delete')}</button>}
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('save')} busy={busy} />
        </div>
      </form>
    </ModalBox>
  );
}

// ---------- usuarios ----------
function NewUserModal({ onClose }: { onClose: () => void }) {
  const { t, refresh } = useApp();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await getProvider().createUser({ user: user.trim(), password: pass, role });
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('mu_title')}</h3>
        <p className="desc">{t('mu_d')}</p>
        <label htmlFor="mu-name">{t('mu_name')}</label>
        <input id="mu-name" placeholder={t('mu_name_ph')} value={user} onChange={(e) => setUser(e.target.value)} required />
        <label htmlFor="mu-pass">{t('mu_pass')}</label>
        <input id="mu-pass" type="password" placeholder={t('mu_pass_ph')} value={pass}
          onChange={(e) => setPass(e.target.value)} minLength={8} required />
        <label>{t('mu_role')}</label>
        <Seg value={role} onChange={setRole} ariaLabel={t('mu_role')}
          options={[{ v: 'user', label: t('mu_r_user') }, { v: 'admin', label: t('mu_r_admin') }]} />
        <p className="desc" style={{ marginTop: 12 }}>{t('mu_roles_d')}</p>
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('mu_create')} busy={busy} disabled={!user.trim() || pass.length < 8} />
        </div>
      </form>
    </ModalBox>
  );
}

// Cambiar la contraseña de la sesión actual (desde Ajustes > Mi sesión)
function MyPasswdModal({ onClose }: { onClose: () => void }) {
  const { t } = useApp();
  const [cur, setCur] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (p1 !== p2) { setErr(t('s_mypass_mismatch')); return; }
    setBusy(true); setErr('');
    try {
      await getProvider().setMyPassword(cur, p1);
      onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('s_mypass')}</h3>
        <label htmlFor="myp-cur">{t('s_mypass_cur')}</label>
        <input id="myp-cur" type="password" autoComplete="current-password" value={cur}
          onChange={(e) => setCur(e.target.value)} required />
        <label htmlFor="myp-p1">{t('mp_new')}</label>
        <input id="myp-p1" type="password" placeholder={t('mu_pass_ph')} autoComplete="new-password"
          value={p1} onChange={(e) => setP1(e.target.value)} minLength={8} required />
        <label htmlFor="myp-p2">{t('s_mypass2')}</label>
        <input id="myp-p2" type="password" autoComplete="new-password" value={p2}
          onChange={(e) => setP2(e.target.value)} minLength={8} required />
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('update')} busy={busy} disabled={!cur || p1.length < 8 || p1 !== p2} />
        </div>
      </form>
    </ModalBox>
  );
}

function PasswdModal({ user, onClose }: { user: string; onClose: () => void }) {
  const { t } = useApp();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [closeSess, setCloseSess] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (p1 !== p2) { setErr(t('s_mypass_mismatch')); return; }
    setBusy(true); setErr('');
    try {
      await getProvider().setUserPassword(user, p1, closeSess);
      onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('mp_title')}</h3>
        <p className="desc">{t('mp_user')}: <b className="mono">{user}</b></p>
        <label htmlFor="mp-p1">{t('mp_new')}</label>
        <input id="mp-p1" type="password" placeholder={t('mu_pass_ph')} value={p1}
          onChange={(e) => setP1(e.target.value)} minLength={8} required />
        <label htmlFor="mp-p2">{t('mp_new2')}</label>
        <input id="mp-p2" type="password" value={p2} onChange={(e) => setP2(e.target.value)} minLength={8} required />
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, textTransform: 'none', fontSize: 13.5, fontWeight: 500, color: 'var(--text)', marginTop: 16 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={closeSess} onChange={(e) => setCloseSess(e.target.checked)} />
          {t('mp_close')}
        </label>
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('update')} busy={busy} disabled={p1.length < 8 || p1 !== p2} />
        </div>
      </form>
    </ModalBox>
  );
}

function DeleteUserModal({ user, onClose }: { user: string; onClose: () => void }) {
  const { t, refresh } = useApp();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await getProvider().deleteUser(user, confirm.trim());
      refresh(); onClose();
    } catch (ex) { setErr(errorMessage(ex, t)); setBusy(false); }
  };

  return (
    <ModalBox onClose={onClose}>
      <form onSubmit={submit}>
        <h3>{t('du_title')}</h3>
        <p className="desc">{t('du_desc')}</p>
        <p className="desc mono" style={{ marginTop: 8 }}>{user}</p>
        <label htmlFor="du-confirm">{t('du_confirm_lbl')}</label>
        <input id="du-confirm" placeholder={user} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {err && <p className="form-err" role="alert">{err}</p>}
        <div className="m-actions">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <SubmitBtn label={t('delete')} busy={busy} danger disabled={confirm.trim() !== user} />
        </div>
      </form>
    </ModalBox>
  );
}
