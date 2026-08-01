// Vista Discos: tabla con salud SMART, temperaturas en vivo y tests.
import { useEffect, useState } from 'react';
import { getProvider } from '../data';
import { subscribeEvents } from '../data/events';
import { useData } from '../ui/useData';
import { errorMessage, useApp } from '../ui/store';
import { fmtBytes, fmtInt } from '../ui/format';
import { Badge, Spinner } from '../components/ui';
import type { Disk } from '../data/types';

const TIPO_SMART: Record<string, 'ok' | 'warn' | 'err' | 'info'> = {
  ok: 'ok', warn: 'warn', crit: 'err', unknown: 'info',
};

// smartLabel — estado SMART en lenguaje humano (los contadores crudos
// quedan en el title como respaldo).
function smartLabel(d: Disk, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (d.smart === 'unknown') return t('dk_smart_na');
  if (d.smart === 'crit') return t('dk_smart_failed');
  const parts: string[] = [];
  if ((d.realloc_sectors ?? 0) > 0) parts.push(t('dk_realloc', { n: d.realloc_sectors! }));
  if ((d.pending_sectors ?? 0) > 0) parts.push(t('dk_pending', { n: d.pending_sectors! }));
  if ((d.nvme_warn ?? 0) > 0) parts.push(t('dk_nvme_warn', { n: d.nvme_warn! }));
  const base = t('dk_smart_ok');
  return parts.length ? `${base} · ${parts.join(' · ')}` : base;
}

export default function Disks() {
  const { t, isAdmin } = useApp();
  const { data, loading, setData } = useData((p) => p.getDisks());
  const [msg, setMsg] = useState('');
  const [arm, setArm] = useState('');

  // Temperaturas en tiempo real vía eventos
  useEffect(() => subscribeEvents((ev) => {
    if (ev.type === 'disk.temp') {
      setData((cur) => cur?.map((d) => d.dev === ev.dev ? { ...d, temp_c: ev.temp_c } : d) ?? cur);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const test = async (dev: string, type: 'short' | 'long') => {
    setMsg('');
    try {
      await getProvider().smartTest(dev, type);
      setMsg(`${t('dk_test_started')}: ${dev} (${type})`);
    } catch (e) { setMsg(errorMessage(e, t)); }
  };

  // Apagar disco: doble clic (1º arma "¿Confirmar?", 2º ejecuta). Se desarma a los 3 s.
  useEffect(() => {
    if (!arm) return;
    const id = setTimeout(() => setArm(''), 3000);
    return () => clearTimeout(id);
  }, [arm]);

  const poweroff = async (dev: string) => {
    if (arm !== dev) { setArm(dev); return; }
    setArm('');
    setMsg('');
    try {
      await getProvider().poweroffDisk(dev);
      setMsg(`${t('dk_powered')}: ${dev}`);
    } catch (e) { setMsg(errorMessage(e, t)); }
  };

  return (
    <div className="view">
      {loading && !data && <Spinner label={t('loading')} />}
      {msg && <p className="desc" style={{ marginBottom: 10, fontSize: 13, color: 'var(--info)', fontWeight: 600 }}>{msg}</p>}
      <div className="card tblwrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('dk_disk')}</th><th>{t('dk_model')}</th><th className="num">{t('dk_size')}</th>
              <th className="num">{t('dk_temp')}</th><th>{t('dk_smart')}</th><th>{t('dk_pool')}</th><th />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((d) => (
              <tr key={d.dev}>
                <td className="mono" style={{ fontWeight: 650 }}>{d.dev}</td>
                <td>
                  <div style={{ fontSize: 13 }}>{d.model}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)' }} className="mono">
                    {d.serial} · {fmtInt(d.hours)} {t('dk_hours')}
                  </div>
                </td>
                <td className="num">{fmtBytes(d.size_bytes)}</td>
                <td className="num">{d.temp_c === null ? '—' : `${d.temp_c}°C`}</td>
                <td>
                  <span title={d.smart_detail}>
                    <Badge tone={TIPO_SMART[d.smart] ?? 'info'} dot={d.smart !== 'unknown'}>{smartLabel(d, t)}</Badge>
                  </span>
                </td>
                <td>
                  {d.pool}
                  {d.in_use && <Badge tone="warn" dot={false}> {t('dk_in_use')}</Badge>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" disabled={d.smart === 'unknown'} title={t('dk_test_short_hint')} onClick={() => test(d.dev, 'short')}>{t('dk_test_short')}</button>{' '}
                  <button className="btn sm" disabled={d.smart === 'unknown'} title={t('dk_test_long_hint')} onClick={() => test(d.dev, 'long')}>{t('dk_test_long')}</button>{' '}
                  {(d.pool === '—' || d.pool === '') && !d.in_use && (
                    <button className={`btn sm ${arm === d.dev ? 'danger' : ''}`} disabled={!isAdmin}
                      title={!isAdmin ? t('no_permission') : t('dk_poweroff_hint')}
                      onClick={() => poweroff(d.dev)}>
                      {arm === d.dev ? t('dk_poweroff_arm') : t('dk_poweroff')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.length === 0 && <div className="empty">{t('empty')}</div>}
      </div>
    </div>
  );
}
