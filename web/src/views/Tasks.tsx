// Vista Tareas: próximas ejecuciones, tareas programadas, tareas del
// sistema (systemd/cron, solo lectura) e historial.
import { useEffect } from 'react';
import { getProvider } from '../data';
import { subscribeEvents } from '../data/events';
import type { Job, JobType } from '../data/types';
import { useData } from '../ui/useData';
import { errorMessage, useApp } from '../ui/store';
import { timeAgo } from '../ui/format';
import { Badge, Spinner, Switch } from '../components/ui';
import { useModal } from '../components/Modal';
import { describeSchedule } from '../components/Modals';
import { useState } from 'react';

const TIPO_CLS: Record<JobType, 'info' | 'ok' | 'warn'> = {
  snapshot: 'info', scrub: 'ok', smart_short: 'warn', smart_long: 'warn',
};

export default function Tasks() {
  const { t } = useApp();
  const { openModal } = useModal();
  const jobs = useData((p) => p.getJobs());
  const hist = useData((p) => p.getJobHistory());
  const sys = useData((p) => p.getSystemTimers());
  const [err, setErr] = useState('');

  // Cuando termina una tarea (evento) recargamos lista e historial
  useEffect(() => subscribeEvents((ev) => {
    if (ev.type === 'job.finished' || ev.type === 'scrub.progress') {
      if (ev.type === 'job.finished') { jobs.reload(); hist.reload(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const tipoLbl = (j: JobType) =>
    j === 'smart_short' ? t('tk_type_smart_short') : j === 'smart_long' ? t('tk_type_smart_long')
    : j === 'snapshot' ? t('tk_type_snapshot') : t('tk_type_scrub');

  const run = async (id: number) => {
    setErr('');
    try { await getProvider().runJob(id); jobs.reload(); hist.reload(); }
    catch (e) { setErr(errorMessage(e, t)); }
  };
  const toggleEnabled = async (j: Job, on: boolean) => {
    setErr('');
    try { await getProvider().updateJob(j.id, { enabled: on }); jobs.reload(); }
    catch (e) { setErr(errorMessage(e, t)); }
  };

  const list = jobs.data ?? [];
  const upcoming = list
    .filter((j) => j.enabled && j.next_run)
    .sort((a, b) => a.next_run.localeCompare(b.next_run))
    .slice(0, 5);

  return (
    <div className="view">
      {jobs.loading && !jobs.data && <Spinner label={t('loading')} />}
      {err && <p className="form-err" role="alert">{err}</p>}

      <div className="sect" style={{ marginTop: 0 }}>
        <h2>{t('tk_next')}</h2>
        <div className="card">
          {upcoming.length === 0 && <div className="empty">{t('empty')}</div>}
          {upcoming.map((j) => (
            <div className="rowitem" style={{ padding: '11px 16px' }} key={j.id}>
              <Badge tone={TIPO_CLS[j.tipo]} dot={false} style={{ padding: '2px 8px' }}>{tipoLbl(j.tipo)}</Badge>
              <div className="grow" style={{ fontSize: 13.5 }}>
                {tipoLbl(j.tipo)} · <span className="mono">{j.target === 'all' ? t('nt_all_disks') : j.target}</span>
              </div>
              <span className="mono" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 650 }}>
                {timeAgo(j.next_run, t)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="sect">
        <h2>{t('tk_jobs')}
          <span className="actions">
            <button className="btn sm primary" onClick={() => openModal('newtask')}>{t('tk_new')}</button>
          </span>
        </h2>
        <div className="card">
          {list.map((j) => (
            <div className="rowitem" key={j.id}>
              <div className="grow">
                <div className="t1" style={{ fontSize: 13.5 }}>
                  <Badge tone={TIPO_CLS[j.tipo]} dot={false} style={{ padding: '2px 8px' }}>{tipoLbl(j.tipo)}</Badge>
                  <span className="mono">{j.target === 'all' ? t('nt_all_disks') : j.target}</span>
                </div>
                <div className="t2">
                  {describeSchedule(j.schedule, t as never)}
                  {j.retention ? ` · ${j.retention}` : ''}
                  {j.last_run ? ` · ${t('tk_last')}: ${timeAgo(j.last_run, t)} · ${j.last_result}` : ''}
                </div>
                <div className="t2" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                  {t('tk_nextrun')}: {j.enabled && j.next_run ? timeAgo(j.next_run, t) : t('tk_none')}
                </div>
              </div>
              <button className="btn sm" onClick={() => openModal('sched', { job: j })}>{t('edit')}</button>
              <button className="btn sm" onClick={() => run(j.id)}>{t('run_now')}</button>
              <Switch checked={j.enabled} onChange={(on) => toggleEnabled(j, on)}
                ariaLabel={j.enabled ? t('active') : t('paused')} />
            </div>
          ))}
          {jobs.data && list.length === 0 && <div className="empty">{t('empty')}</div>}
        </div>
      </div>

      {/* Tareas del sistema: timers de systemd y cron (solo lectura) */}
      <div className="sect">
        <h2>{t('tk_system')}</h2>
        <div className="card">
          {sys.loading && !sys.data && <Spinner label={t('loading')} />}
          {(sys.data ?? []).map((s, i) => (
            <div className="rowitem" key={i}>
              <Badge tone={s.source === 'systemd' ? 'info' : 'warn'} dot={false} style={{ padding: '2px 8px' }}>
                {s.source}
              </Badge>
              <div className="grow">
                <div className="t1" style={{ fontSize: 13.5 }}>{s.name}</div>
                <div className="t2">
                  {s.schedule}
                  {s.next_run ? ` · ${t('tk_nextrun')}: ${timeAgo(s.next_run, t)}` : ''}
                </div>
                <div className="t2 mono">{s.command}</div>
              </div>
            </div>
          ))}
          {sys.data && sys.data.length === 0 && <div className="empty">{t('empty')}</div>}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>{t('tk_system_d')}</p>
      </div>

      <div className="sect">
        <h2>{t('tk_history')}</h2>
        <div className="card">
          {(hist.data ?? []).map((h, i) => (
            <div className="rowitem" key={i}>
              <Badge tone={h.ok ? 'ok' : 'err'} dot={false} style={{ padding: '2px 8px' }}>
                {h.ok ? t('hist_ok') : t('hist_warn')}
              </Badge>
              <div className="grow">
                <div className="t1" style={{ fontSize: 13.5 }}>{tipoLbl(h.tipo)} · <span className="mono">{h.target}</span></div>
                <div className="t2">{h.detail}</div>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{timeAgo(h.ts, t)}</span>
            </div>
          ))}
          {hist.data && hist.data.length === 0 && <div className="empty">{t('empty')}</div>}
        </div>
      </div>
    </div>
  );
}
