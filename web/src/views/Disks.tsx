// Vista Discos: tabla con salud SMART, temperaturas en vivo y tests.
import { useEffect, useState } from 'react';
import { getProvider } from '../data';
import { subscribeEvents } from '../data/events';
import { useData } from '../ui/useData';
import { errorMessage, useApp } from '../ui/store';
import { fmtBytes, fmtInt } from '../ui/format';
import { Badge, Spinner } from '../components/ui';

export default function Disks() {
  const { t } = useApp();
  const { data, loading, setData } = useData((p) => p.getDisks());
  const [msg, setMsg] = useState('');

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
                <td>{d.smart === 'unknown'
                  ? <Badge tone="info" dot={false}>{t('dk_smart_na')}</Badge>
                  : <Badge tone={d.smart === 'ok' ? 'ok' : d.smart === 'warn' ? 'warn' : 'err'}>{d.smart_detail}</Badge>}
                </td>
                <td>{d.pool}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" disabled={d.smart === 'unknown'} onClick={() => test(d.dev, 'short')}>{t('dk_test_short')}</button>{' '}
                  <button className="btn sm" disabled={d.smart === 'unknown'} onClick={() => test(d.dev, 'long')}>{t('dk_test_long')}</button>
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
