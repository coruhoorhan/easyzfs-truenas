import { useEffect, useState } from 'react';
import { useApp } from '../ui/store';
import { getProvider } from '../data';
import { Spinner } from '../components/ui';
import { fmtBytes } from '../ui/format';
import { IconArchive, IconDownload, IconMonitor } from '../components/icons';

// Interfaces for Veeam Explorer
interface VeeamFile {
  name: string;
  path: string;
  size: number;
  type: string; // VBK, VIB, VBM
  date_str: string;
  time_str: string;
  is_zfs_archive: boolean;
  snapshot_name?: string;
}

interface VeeamChain {
  vbk: VeeamFile | null;
  vibs: VeeamFile[];
  is_broken: boolean;
}

interface VeeamMachine {
  name: string;
  total_size: number;
  files: VeeamFile[];
  chains: VeeamChain[];
}

interface VeeamExplorerResp {
  machines: VeeamMachine[];
  total_vms: number;
  total_capacity: number;
  logical_used?: number;
  physical_used?: number;
  compress_ratio?: string;
}

function VeeamFileRow({ f, dataset }: { f: VeeamFile; dataset: string }) {
  const { t } = useApp();
  const isVbk = f.type === 'VBK';
  const isVib = f.type === 'VIB';
  const isVbm = f.type === 'VBM';

  let downUrl = `/api/snapshots/${encodeURIComponent(dataset + '@' + f.snapshot_name)}/download?file=${encodeURIComponent(f.name)}`;

  return (
    <tr key={f.path} style={{ opacity: f.is_zfs_archive ? 0.9 : 1 }}>
      <td className="mono" style={{ whiteSpace: 'normal', maxWidth: '350px', wordBreak: 'break-all' }}>
        <div style={{ fontSize: '0.85em', color: 'var(--text)' }}>{f.name}</div>
        {f.is_zfs_archive && f.snapshot_name && (
          <span style={{ marginTop: 4, display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold', backgroundColor: '#fff3cd', color: '#856404' }}>
            {t('veeam_archive', { snap: f.snapshot_name })}
          </span>
        )}
      </td>
      <td>
        <div style={{ fontWeight: 'bold', color: 'var(--text)' }}>{f.date_str}</div>
        <div style={{ fontSize: '0.85em', color: 'var(--text2)' }}>{f.time_str}</div>
      </td>
      <td>
        {isVbk && <span style={{ padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 'bold', backgroundColor: '#e2f5e9', color: '#10753b', display: 'inline-block' }}>{t('veeam_type_vbk')}</span>}
        {isVib && <span style={{ padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 'bold', backgroundColor: '#e6f0ff', color: '#0052cc', display: 'inline-block' }}>{t('veeam_type_vib')}</span>}
        {isVbm && <span style={{ padding: '4px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 'bold', backgroundColor: '#f4f5f7', color: '#42526e', display: 'inline-block' }}>{t('veeam_type_vbm')}</span>}
      </td>
      <td className="num">{fmtBytes(f.size)}</td>
      <td style={{ textAlign: 'right' }}>
        {f.is_zfs_archive ? (
          <a href={downUrl} download className="btn sm primary">{t('veeam_download')}</a>
        ) : (
          <span style={{ fontSize: '0.8em', color: 'var(--text2)' }}>{t('veeam_live')}</span>
        )}
      </td>
    </tr>
  );
}

function MountSMBButton({ snapshot, dataset, mountKey }: { snapshot: string, dataset: string, mountKey: string }) {
  const { t } = useApp();
  // El estado de montaje es por (máquina, cadena, snapshot): el mismo
  // snapshot aloja el VBK de muchas máquinas, y sin la máquina en la clave
  // el estado "montado" aparecería en TODAS las filas que usan ese snapshot.
  const storageKey = `veeam_mount_${mountKey}_${snapshot}`;
  const [mountData, setMountData] = useState<{shareName: string, cloneDS: string} | null>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mount = async () => {
    setBusy(true); setError('');
    try {
      const snap = dataset + "@" + snapshot;
      const r = await fetch('/api/veeam/mount-clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: snap })
      });
      const d = await r.json();
      if (d.error) setError(d.error);
      else {
        const md = { shareName: d.share_name, cloneDS: d.clone_ds };
        localStorage.setItem(storageKey, JSON.stringify(md));
        setMountData(md);
      }
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const unmount = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/veeam/unmount-clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share_name: mountData?.shareName, clone_ds: mountData?.cloneDS })
      });
      const d = await r.json();
      if (d.error) setError(d.error);
      else {
        localStorage.removeItem(storageKey);
        setMountData(null);
      }
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  if (mountData) {
    const smbPath = `\\\\${window.location.hostname}\\${mountData.shareName}`;
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', marginLeft: '16px', padding: '6px 12px', backgroundColor: '#e2f5e9', borderRadius: '6px', fontSize: '0.85em', border: '1px solid #10753b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => { navigator.clipboard.writeText(smbPath); alert(t('veeam_copied', { path: smbPath })); }} title={t('veeam_copy_hint')}>
          <span style={{ fontWeight: 'bold', color: '#10753b', fontFamily: 'monospace', fontSize: '1.1em' }}>{smbPath}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10753b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </div>
        <button className="btn sm danger" onClick={unmount} disabled={busy}>
          {busy ? t('veeam_unmounting') : t('veeam_unmount')}
        </button>
        <div style={{ fontSize: '0.72em', color: '#10753b', maxWidth: '240px' }}>{t('veeam_connect_hint')}</div>
        {error && <span style={{ color: 'red' }}>{error}</span>}
      </div>
    );
  }

  return (
    <span style={{ marginLeft: '16px' }}>
      <button className="btn sm primary" onClick={mount} disabled={busy}>
        {busy ? t('veeam_mounting') : t('veeam_mount')}
      </button>
      {error && <span style={{ color: 'red', marginLeft: '8px', fontSize: '0.85em' }}>{error}</span>}
    </span>
  );
}

function MachineRow({ m, dataset }: { m: VeeamMachine; dataset: string }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);

  const scriptLines = m.chains.map((chain, i) => {
      let script = `# ${t('veeam_chain', { i: i + 1 })}\n`;
      if (chain.vbk && chain.vbk.is_zfs_archive && chain.vbk.snapshot_name) {
         const snap = dataset + "@" + chain.vbk.snapshot_name;
         script += `wget -O "${chain.vbk.name}" "http://<server-ip>/api/snapshots/${snap}/download?file=${chain.vbk.name}"\n`;
      }
      for (const vib of chain.vibs) {
          if (vib.is_zfs_archive && vib.snapshot_name) {
              const snap = dataset + "@" + vib.snapshot_name;
              script += `wget -O "${vib.name}" "http://<server-ip>/api/snapshots/${snap}/download?file=${vib.name}"\n`;
          }
      }
      return script;
  }).join('\n');

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '16px', overflow: 'hidden' }}>
      <div
        style={{ padding: '16px', backgroundColor: 'var(--bg2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '16px' }}
        onClick={() => setOpen(!open)}
      >
        <IconMonitor size={28} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold', fontSize: '1.2em', color: 'var(--text)' }}>{m.name}</div>
          <div style={{ fontSize: '0.85em', color: 'var(--text2)', marginTop: 4 }}>
            {t('veeam_files_chains', { n: m.files.length, c: m.chains.length })}
          </div>
        </div>
        <div style={{ fontSize: '1.1em', fontWeight: 'bold' }}>{fmtBytes(m.total_size)}</div>
      </div>

      {open && (
        <div style={{ padding: '16px', backgroundColor: 'var(--bg)' }}>

          <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', alignItems: 'center' }}>
            <h3 style={{ margin: 0, flex: 1 }}>{t('veeam_chain_tree')}</h3>
            <button className="btn sm" onClick={() => {
                const blob = new Blob([scriptLines], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `restore_${m.name}.sh`;
                a.click();
            }}>
                <IconDownload size={16} /> {t('veeam_gen_script')}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {m.chains.map((chain, i) => (
              <div key={i} style={{ borderLeft: chain.is_broken ? '4px solid #dc3545' : '4px solid #28a745', paddingLeft: '16px', marginBottom: '16px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '8px', color: chain.is_broken ? '#dc3545' : 'var(--text)', display: 'flex', alignItems: 'center' }}>
                  <span>{t('veeam_chain', { i: i + 1 })} {chain.is_broken && t('veeam_broken_chain')}</span>
                  {chain.vbk && chain.vbk.is_zfs_archive && chain.vbk.snapshot_name && (
                      <MountSMBButton snapshot={chain.vbk.snapshot_name} dataset={dataset} mountKey={`${m.name}_${i + 1}`} />
                  )}
                </div>

                <div className="tblwrap" style={{ overflowX: 'auto' }}>
                  <table className="data" style={{ margin: 0 }}>
                    <thead>
                      <tr><th>{t('veeam_file')}</th><th>{t('veeam_date')}</th><th>{t('veeam_type')}</th><th className="num">{t('veeam_size')}</th><th style={{ textAlign: 'right' }}>{t('veeam_action')}</th></tr>
                    </thead>
                    <tbody>
                      {chain.vbk && <VeeamFileRow f={chain.vbk} dataset={dataset} />}
                      {chain.vibs.map(vib => (
                        <VeeamFileRow key={vib.path} f={vib} dataset={dataset} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

        </div>
      )}
    </div>
  );
}

export default function VeeamExplorer() {
  const { t } = useApp();
  const [data, setData] = useState<VeeamExplorerResp | null>(null);
  const [error, setError] = useState<string>('');
  const [dataset, setDataset] = useState('tank/vmware');
  const [loading, setLoading] = useState(false);

  // El escaneo se dispara solo con el botón "Tara" o el montaje inicial;
  // antes se disparaba en cada pulsación de teclado (escaneaba el árbol de
  // snapshots de un dataset de TB en cada letra).
  const load = (ds: string) => {
    setLoading(true); setError('');
    fetch(`/api/veeam/explorer?dataset=${encodeURIComponent(ds)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setData(d);
        persistMonitored(ds);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  // Dataset escaneado correctamente → lo añade a settings.veeam_datasets para
  // que el collector vigile sus cadenas en segundo plano (mejor esfuerzo).
  const persistMonitored = (ds: string) => {
    getProvider().getSettings().then((st) => {
      const current = (st.veeam_datasets ?? '').split(',').map(s => s.trim()).filter(Boolean);
      if (current.includes(ds)) return;
      getProvider().putSettings({ ...st, veeam_datasets: [...current, ds].join(',') }).catch(() => {});
    }).catch(() => {});
  };

  useEffect(() => {
    load(dataset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="view">
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', alignItems: 'center' }}>
        <input
            type="text"
            value={dataset}
            onChange={e => setDataset(e.target.value)}
            className="inp"
            style={{ width: '300px' }}
            placeholder={t('veeam_ds_ph')}
        />
        <button className="btn primary" onClick={() => load(dataset)} disabled={loading}>
            {t('veeam_scan')}
        </button>
      </div>

      {loading && <Spinner label={t('veeam_scanning')} />}
      {error && <div className="alert err">{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
            <div style={{ padding: '16px', backgroundColor: 'var(--bg2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.9em', color: 'var(--text2)', marginBottom: '8px' }}>{t('veeam_machines')}</div>
              <div style={{ fontSize: '2em', fontWeight: 'bold' }}>{data.total_vms}</div>
            </div>
            <div style={{ padding: '16px', backgroundColor: 'var(--bg2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.9em', color: 'var(--text2)', marginBottom: '8px' }}>{t('veeam_capacity')}</div>
              <div style={{ fontSize: '2em', fontWeight: 'bold' }}>{fmtBytes(data.total_capacity)}</div>
            </div>
            <div style={{ padding: '16px', backgroundColor: 'var(--bg2)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.9em', color: 'var(--text2)', marginBottom: '8px' }}>{t('veeam_savings')}</div>
              {data.logical_used && data.physical_used && data.logical_used > 0 ? (
                <>
                  <div style={{ fontSize: '1.6em', fontWeight: 'bold', color: '#10753b' }}>
                    {t('veeam_savings_pct', { pct: (((data.logical_used - data.physical_used) / data.logical_used) * 100).toFixed(1) })}
                  </div>
                  <div style={{ fontSize: '0.85em', color: 'var(--text2)', marginTop: 4 }}>
                    {t('veeam_savings_detail', { l: fmtBytes(data.logical_used), p: fmtBytes(data.physical_used), r: data.compress_ratio || '-' })}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '1.2em', fontWeight: 'bold' }}>{t('veeam_savings_na')}</div>
              )}
            </div>
          </div>

          <div>
            {data.machines.map(m => (
              <MachineRow key={m.name} m={m} dataset={dataset} />
            ))}
            {data.machines.length === 0 && (
                <div className="empty">{t('veeam_empty')}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
