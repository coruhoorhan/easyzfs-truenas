// Vista Panel: KPIs, tarjetas de pool, alertas recientes y actividad.
import { useEffect } from 'react';
import { subscribeEvents } from '../data/events';
import { useData } from '../ui/useData';
import { useApp, alertTargetView } from '../ui/store';
import { fmtBytesPair, fmtInt, fmtPct, timeAgo } from '../ui/format';
import { KpiCard, Spinner } from '../components/ui';
import { PoolCard } from '../components/PoolCard';
import { IconChev } from '../components/icons';
import type { Alert } from '../data/types';

function AlertRow({ a }: { a: Alert }) {
  const { t, navigate } = useApp();
  const tone = a.level === 'crit' ? 'err' : a.level === 'warn' ? 'warn' : 'info';
  const ico = a.level === 'crit' ? '!' : a.level === 'warn' ? '⚠' : 'i';
  const view = alertTargetView(a.target);
  const go = view ? () => navigate(view) : undefined;
  return (
    <div className={`alert${view ? ' clickable' : ''}`}
      role={view ? 'link' : undefined} tabIndex={view ? 0 : undefined}
      title={view ? t('al_goto') : undefined}
      onClick={go}
      onKeyDown={go ? (e) => { if (e.key === 'Enter') go(); } : undefined}>
      <div className="ico" style={{ background: `var(--${tone}-soft)`, color: `var(--${tone})` }}>{ico}</div>
      <div className="grow" style={{ flex: 1, minWidth: 0 }}>
        <b>{a.message}</b>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 2 }}>{a.source}</div>
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{timeAgo(a.ts, t)}</span>
      {view && <span className="chev"><IconChev /></span>}
    </div>
  );
}

export default function Dashboard() {
  const { t, navigate } = useApp();
  const ov = useData((p) => p.getOverview());
  const pools = useData((p) => p.getPools());

  // Suscripción a eventos en tiempo real: refresca KPIs y progreso de scrub
  useEffect(() => subscribeEvents((ev) => {
    if (ev.type === 'overview' || ev.type === 'alert.new' || ev.type === 'pool.status') ov.reload();
    if (ev.type === 'scrub.progress') {
      pools.setData((cur) => cur?.map((p) => p.name === ev.pool
        ? { ...p, scrub: { ...p.scrub, state: 'running', pct: ev.pct, eta_sec: ev.eta_sec } }
        : p) ?? cur);
      if (ev.pct >= 100) { pools.reload(); ov.reload(); }
    }
    if (ev.type === 'disk.temp') {
      pools.setData((cur) => cur?.map((p) => ({
        ...p, vdevs: p.vdevs.map((v) => v.dev === ev.dev ? { ...v, temp_c: ev.temp_c } : v),
      })) ?? cur);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const o = ov.data;
  const pct = o && o.cap_total_bytes > 0 ? (o.cap_used_bytes / o.cap_total_bytes) * 100 : 0;

  return (
    <div className="view">
      {!o && <Spinner label={t('loading')} />}
      {o && (<>
        <div className="grid kpis">
          <KpiCard label={t('kpi_health')}
            value={`${o.pools_total} pools`}
            foot={o.pools_online === o.pools_total ? t('kpi_health_ok') : t('kpi_health_warn')} />
          <KpiCard label={t('kpi_cap')}
            value={fmtBytesPair(o.cap_used_bytes, o.cap_total_bytes).split(' de ')[0]}
            small={`${t('pool_of')} ${fmtBytesPair(o.cap_used_bytes, o.cap_total_bytes).split(' de ')[1]}`}
            foot={`${fmtPct(pct)} ${t('kpi_cap_used')}`} meter={pct} />
          <KpiCard label={t('kpi_snaps')} value={fmtInt(o.snapshots_total)}
            foot={`${o.jobs_active} ${t('kpi_snaps_foot')}`} />
          <KpiCard label={t('kpi_scrub')} value={o.last_scrub.errors === 0 ? 'OK' : String(o.last_scrub.errors)}
            foot={`${o.last_scrub.pool} · ${o.last_scrub.errors} ${t('kpi_scrub_errors')} · ${timeAgo(o.last_scrub.ts, t)}`} />
        </div>

        <div className="sect">
          <h2>{t('dash_pools')}
            <span className="actions">
              <button className="btn sm" onClick={() => navigate('pools')}>{t('dash_see_all')}</button>
            </span>
          </h2>
          <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
            {(pools.data ?? []).map((p) => (
              <PoolCard key={p.name} pool={p} onChanged={() => { pools.reload(); ov.reload(); }} />
            ))}
          </div>
        </div>

        <div className="sect">
          <h2>{t('dash_alerts')}</h2>
          <div className="card">
            {o.alerts.length === 0 && <div className="empty">{t('dash_no_alerts')}</div>}
            {o.alerts.map((a) => <AlertRow key={a.id} a={a} />)}
          </div>
        </div>

        <div className="sect">
          <h2>{t('dash_activity')}</h2>
          <div className="card">
            {o.activity.map((a, i) => (
              <div className="rowitem" key={i}>
                <div className="grow">
                  <div className="t1" style={{ fontSize: 13.5 }}>{a.text}</div>
                  <div className="t2">{a.detail}</div>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{timeAgo(a.ts, t)}</span>
              </div>
            ))}
          </div>
        </div>
      </>)}
    </div>
  );
}
