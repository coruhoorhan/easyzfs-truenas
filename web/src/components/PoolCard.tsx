// Tarjeta de pool compartida entre Panel y Pools (réplica del mockup)
import { getProvider } from '../data';
import type { Disk, Pool } from '../data/types';
import { errorMessage, useApp } from '../ui/store';
import { fmtBytes, fmtBytesPair, fmtPct, fmtRatio, timeAgo } from '../ui/format';
import { Badge, Meter } from './ui';
import { useModal } from './Modal';
import { useEffect, useState } from 'react';

// shortDev — nombre corto de vdev: ruta base si la hay; UUID acortado si no.
const shortDev = (v: { dev: string; path?: string }) =>
  v.path ? v.path.replace('/dev/', '') : (v.dev.length > 13 ? v.dev.slice(0, 8) + '…' : v.dev);

export function PoolCard({ pool, onChanged }: { pool: Pool; onChanged: () => void }) {
  const { t, isAdmin } = useApp();
  const { openModal } = useModal();
  const [err, setErr] = useState('');
  const [disks, setDisks] = useState<Disk[]>([]);
  const pct = pool.total_bytes > 0 ? (pool.used_bytes / pool.total_bytes) * 100 : 0;
  const running = pool.scrub.state === 'running';
  const ok = pool.status === 'ONLINE';

  useEffect(() => {
    let alive = true;
    getProvider().getDisks().then((d) => { if (alive) setDisks(d); }).catch(() => {});
    return () => { alive = false; };
  }, [pool]);

  const scrub = async (action: 'start' | 'pause' | 'stop') => {
    setErr('');
    try {
      await getProvider().scrubAction(pool.name, action);
      onChanged();
    } catch (e) { setErr(errorMessage(e, t)); }
  };

  const vdevAct = async (dev: string, action: 'offline' | 'online') => {
    setErr('');
    try {
      await getProvider().vdevAction(pool.name, dev, action);
      onChanged();
    } catch (e) { setErr(errorMessage(e, t)); }
  };

  const faulted = pool.vdevs.find((v) => v.status !== 'ONLINE');
  const free = disks.filter((d) => d.pool === '—' || d.pool === '');
  const isMirror = pool.topo.startsWith('mirror');

  return (
    <div className="card">
      <div className="poolhead">
        <div className="grow">
          <div className="t1" style={{ fontSize: 16, fontWeight: 700, display: 'flex', gap: 9, alignItems: 'center' }}>
            {pool.name} <Badge tone={ok ? 'ok' : 'warn'}>{pool.status}</Badge>
          </div>
          <div className="t2">{pool.topo}</div>
          <Meter pct={pct} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>
            {fmtBytesPair(pool.used_bytes, pool.total_bytes).split(' de ')[0]}
            <span style={{ fontSize: 12.5, color: 'var(--text2)', fontWeight: 500 }}>
              {' '}{t('pool_of')} {fmtBytesPair(pool.used_bytes, pool.total_bytes).split(' de ')[1]}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{fmtPct(pct)} {t('pool_used')}</div>
        </div>
      </div>

      <div className="poolmeta">
        <span>{t('pool_comp')} <b>{fmtRatio(pool.comp_ratio)}</b></span>
        <span>{t('pool_frag')} <b>{fmtPct(pool.frag_pct)}</b></span>
        <span>
          {t('pool_last_scrub')}{' '}
          <b>{running ? t('pool_in_progress') : timeAgo(pool.scrub.ts, t)}</b>
          {' '}· <b>{pool.scrub.errors} {t('pool_errors')}</b>
        </span>
      </div>

      {running && (<>
        <div style={{ padding: '0 16px 4px', fontSize: 12.5, color: 'var(--info)', fontWeight: 600 }}>
          {t('pool_scrub_running')} · {Math.round(pool.scrub.pct)}% · ~{Math.max(1, Math.round(pool.scrub.eta_sec / 60))} {t('pool_eta_min')}
        </div>
        <div className="scrubbar"><i style={{ width: `${pool.scrub.pct}%` }} /></div>
      </>)}

      {isAdmin && faulted && free.length > 0 && (
        <div className="rebuildbar">
          <span style={{ flex: 1, minWidth: 220 }}>
            {t('pool_rebuild', {
              dev: free[0].dev,
              size: fmtBytes(free[0].size_bytes),
              old: shortDev(faulted),
            })}
          </span>
          <button className="btn sm warn" onClick={() => openModal('replace', { pool: pool.name, oldDev: faulted.dev, newDev: free[0].dev })}>
            {t('pool_rebuild_btn')}
          </button>
        </div>
      )}

      <div className="vdevs">
        {pool.vdevs.map((v) => (
          <div className="vdev" key={v.dev}>
            <span className={`badge ${v.status === 'ONLINE' ? 'ok' : 'err'}`} style={{ padding: '2px 7px' }}>{v.status}</span>
            <span className="dname" title={v.dev}>{shortDev(v)}</span>
            <span>{v.role !== '—' ? v.role : ''}</span>
            <span style={{ marginLeft: 'auto' }}>{v.temp_c}°C</span>
            <button className="btn sm" disabled={!isAdmin}
              title={!isAdmin ? t('no_permission') : t('pool_replace_disk', { dev: shortDev(v) })}
              onClick={() => openModal('replace', { pool: pool.name, oldDev: v.dev })}>{t('pool_replace')}</button>
            {v.status === 'ONLINE' && (
              <button className="btn sm" disabled={!isAdmin} title={!isAdmin ? t('no_permission') : t('vdev_offline_hint')}
                onClick={() => vdevAct(v.dev, 'offline')}>{t('vdev_offline')}</button>
            )}
            {v.status === 'OFFLINE' && (
              <button className="btn sm" disabled={!isAdmin} title={!isAdmin ? t('no_permission') : undefined}
                onClick={() => vdevAct(v.dev, 'online')}>{t('vdev_online')}</button>
            )}
            {isMirror && (
              <button className="btn sm danger" disabled={!isAdmin} title={!isAdmin ? t('no_permission') : t('vdev_detach_hint')}
                onClick={() => openModal('detach', { pool: pool.name, dev: v.dev, path: v.path })}>{t('vdev_detach')}</button>
            )}
          </div>
        ))}
      </div>

      {err && <p className="form-err" style={{ padding: '0 16px' }} role="alert">{err}</p>}

      <div style={{ display: 'flex', gap: 7, padding: '0 16px 15px', flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => scrub(running ? 'pause' : 'start')}>
          {running ? t('pool_scrub_pause') : t('pool_scrub_now')}
        </button>
        {running && <button className="btn sm" onClick={() => scrub('stop')}>Stop</button>}
        <button className="btn sm" disabled={!isAdmin} title={!isAdmin ? t('no_permission') : undefined}
          onClick={() => openModal('addvdev', { pool: pool.name })}>{t('pool_add_vdev')}</button>
        <button className="btn sm danger" disabled={!isAdmin} title={!isAdmin ? t('no_permission') : undefined}
          onClick={() => openModal('export', { pool: pool.name })}>
          {t('pool_export')}
        </button>
      </div>
    </div>
  );
}
