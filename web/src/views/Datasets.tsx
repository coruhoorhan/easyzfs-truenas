// Vista Datasets: tabla de datasets/zvols con acciones por fila.
import { useData } from '../ui/useData';
import { useApp } from '../ui/store';
import { fmtBytes } from '../ui/format';
import { Spinner } from '../components/ui';
import { useModal } from '../components/Modal';

export default function Datasets() {
  const { t, isAdmin } = useApp();
  const { openModal } = useModal();
  const { data, loading } = useData((p) => p.getDatasets());

  return (
    <div className="view">
      {loading && !data && <Spinner label={t('loading')} />}
      <div className="card tblwrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t('ds_name')}</th><th>{t('ds_type')}</th><th>{t('ds_comp')}</th>
              <th className="num">{t('ds_used')}</th><th className="num">{t('ds_avail')}</th><th className="num">{t('ds_quota')}</th><th />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((d) => (
              <tr className="clickable" key={d.name}
                onClick={() => isAdmin && openModal('editds', { ds: d })}>
                <td className="mono" style={{ fontWeight: 600 }}>{d.name}</td>
                <td style={{ color: 'var(--text2)' }}>{d.type === 'volume' ? t('ds_vol') : t('ds_fs')}</td>
                <td>{d.compression}</td>
                <td className="num">{fmtBytes(d.used_bytes)}</td>
                <td className="num">{fmtBytes(d.avail_bytes)}</td>
                <td className="num">{d.quota_bytes ? fmtBytes(d.quota_bytes) : '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={(e) => { e.stopPropagation(); openModal('newsnap', { dataset: d.name }); }}>
                    {t('ds_snapshot')}
                  </button>{' '}
                  {isAdmin && (
                    <button className="btn sm danger" onClick={(e) => { e.stopPropagation(); openModal('delds', { name: d.name }); }}>
                      {t('delete')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.length === 0 && <div className="empty">{t('empty')}</div>}
      </div>
      <div className="sect">
        <button className="btn primary" onClick={() => openModal('newds', { vol: false })}>{t('ds_new')}</button>
        <button className="btn" style={{ marginLeft: 8 }} onClick={() => openModal('newds', { vol: true })}>{t('ds_newvol')}</button>
      </div>
    </div>
  );
}
