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
  has_gap?: boolean;
  gap_days?: number;
}

interface VeeamMachine {
  name: string;
  total_size: number;
  files: VeeamFile[];
  chains: VeeamChain[];
  last_backup?: string;
  last_backup_ts?: number;
}

interface VeeamMount {
  share_name: string;
  clone_ds: string;
  path: string;
  read_only: boolean;
  created_ts: number;
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
  const { t, notify } = useApp();
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
      if (d.error) { setError(d.error); notify(d.error, 'err'); }
      else {
        const md = { shareName: d.share_name, cloneDS: d.clone_ds };
        localStorage.setItem(storageKey, JSON.stringify(md));
        setMountData(md);
        notify(t('veeam_connected'), 'ok');
      }
    } catch (e: any) { setError(e.message); notify(e.message ?? t('error'), 'err'); }
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
      if (d.error) { setError(d.error); notify(d.error, 'err'); }
      else {
        localStorage.removeItem(storageKey);
        setMountData(null);
        notify(t('veeam_disconnected'), 'ok');
      }
    } catch (e: any) { setError(e.message); notify(e.message ?? t('error'), 'err'); }
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

function MachineRow({ m, dataset, staleDays, ignored, onToggleIgnore }: {
  m: VeeamMachine; dataset: string; staleDays: number;
  ignored: boolean; onToggleIgnore: () => void;
}) {
  const { t, refresh, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [protecting, setProtecting] = useState(false);
  const [lastSnap, setLastSnap] = useState('');

  const ageDays = m.last_backup_ts ? Math.max(0, Math.floor((Date.now() / 1000 - m.last_backup_ts) / 86400)) : null;
  const stale = !ignored && ageDays !== null && ageDays >= staleDays;

  // Script de recuperación con el host real y cookie de sesión (el endpoint
  // de descarga exige autenticación).
  const scriptLines = [
    '#!/bin/bash',
    `# ${t('veeam_chain_tree')}: ${m.name}`,
    `HOST="${window.location.hostname}"`,
    `# ${t('veeam_script_cookie_hint')}`,
    'COOKIE="easyzfs_session=PASTE_AQUI"',
    'dl() { curl -sS -b "$COOKIE" -o "$1" "http://$HOST$2"; }',
    '',
  ].concat(m.chains.flatMap((chain, i) => {
    const lines = [`# ${t('veeam_chain', { i: i + 1 })}`];
    const push = (f: VeeamFile) => {
      if (f.is_zfs_archive && f.snapshot_name) {
        const full = `${dataset}@${f.snapshot_name}`;
        lines.push(`dl "${f.name}" "/api/snapshots/${encodeURIComponent(full)}/download?file=${encodeURIComponent(f.name)}"`);
      }
    };
    if (chain.vbk) push(chain.vbk);
    chain.vibs.forEach(push);
    return lines;
  })).join('\n');

  const protect = async () => {
    setProtecting(true);
    try {
      const safe = m.name.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 40);
      const name = `ezv-${safe}-${new Date().toISOString().slice(0, 10)}-${Math.floor(Date.now() / 1000) % 100000}`;
      await getProvider().createSnapshot({ dataset, name, recursive: false });
      setLastSnap(name);
      notify(t('veeam_protect_ok', { name }), 'ok');
      refresh(); // anında tazele: snapshot listesi ezv-<nombre>-<fecha> gösterir
      setTimeout(() => setLastSnap(''), 4000); // cooldown: evita clic repetido
    } catch (e: any) { notify(e?.message ?? t('error'), 'err'); }
    setProtecting(false);
  };

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
            {m.last_backup && (
              <span style={{ marginLeft: 10, color: stale ? '#b45309' : undefined, fontWeight: stale ? 600 : undefined }}>
                · {t('veeam_last_backup', { d: m.last_backup, n: ageDays ?? 0 })}
                {stale && (
                  <span style={{ marginLeft: 6, padding: '1px 7px', borderRadius: '9px', backgroundColor: '#fef3c7', color: '#92400e', fontSize: '0.72rem', fontWeight: 700 }}>
                    {t('veeam_stale_tag')}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        {ignored && (
          <span style={{ padding: '2px 9px', borderRadius: '10px', backgroundColor: '#e5e7eb', color: '#4b5563', fontSize: '0.72rem', fontWeight: 700 }}>
            {t('veeam_ignored')}
          </span>
        )}
        {stale && (
          <button className="btn sm" onClick={(e) => { e.stopPropagation(); onToggleIgnore(); }} title={t('veeam_ignore_btn')}>
            {t('veeam_ignore_btn')}
          </button>
        )}
        {ignored && (
          <button className="btn sm" onClick={(e) => { e.stopPropagation(); onToggleIgnore(); }} title={t('veeam_ignore_unbtn')}>
            {t('veeam_ignore_unbtn')}
          </button>
        )}
        <button className="btn sm" onClick={(e) => { e.stopPropagation(); void protect(); }} disabled={protecting || !!lastSnap}>
          {protecting ? '…' : lastSnap ? '✓' : t('veeam_protect')}
        </button>
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
            {m.chains.map((chain, i) => {
              const snap = chain.vbk?.snapshot_name;
              const mounted = !!snap && !!localStorage.getItem(`veeam_mount_${m.name}_${i + 1}_${snap}`);
              const border = chain.is_broken ? '#dc3545' : mounted ? '#1a7f37' : 'var(--border)';
              return (
                <div key={i} style={{ borderLeft: `4px solid ${border}`, paddingLeft: '16px', marginBottom: '16px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '8px', color: chain.is_broken ? '#dc3545' : mounted ? '#1a7f37' : 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span>{t('veeam_chain', { i: i + 1 })}</span>
                    {chain.is_broken && <span style={{ color: '#dc3545' }}>{t('veeam_broken_chain')}</span>}
                    {chain.has_gap && (
                      <span style={{ padding: '2px 9px', borderRadius: '10px', backgroundColor: '#fef3c7', color: '#92400e', fontSize: '0.72rem', fontWeight: 700 }}>
                        {t('veeam_gap', { n: chain.gap_days ?? 1 })}
                      </span>
                    )}
                    {mounted && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 9px', borderRadius: '10px', backgroundColor: '#e6f4ea', color: '#1a7f37', fontSize: '0.72rem', fontWeight: 700 }}>
                        ● {t('veeam_mounted')}
                      </span>
                    )}
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
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}

export default function VeeamExplorer() {
  const { t, notify } = useApp();
  const [data, setData] = useState<VeeamExplorerResp | null>(null);
  const [error, setError] = useState<string>('');
  const [dataset, setDataset] = useState('tank/vmware');
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [flt, setFlt] = useState<'all' | 'broken' | 'mounted' | 'archive'>('all');
  const [mounts, setMounts] = useState<VeeamMount[] | null>(null);
  const [staleDays, setStaleDays] = useState(2);
  const [ignoreSet, setIgnoreSet] = useState<Set<string>>(new Set());

  // Montajes activos (estado real del servidor, no localStorage).
  const loadMounts = () => {
    fetch('/api/veeam/mounts')
      .then(r => r.json())
      .then(d => { if (!d?.error) setMounts(Array.isArray(d) ? d : []); })
      .catch(() => {});
  };

  // Añade/elimina la máquina de la lista de exclusión del aviso de obsoleto.
  const toggleIgnore = (name: string) => {
    getProvider().getSettings().then((st) => {
      const cur = (st.veeam_ignore ?? '').split(',').map(s => s.trim()).filter(Boolean);
      const next = cur.includes(name) ? cur.filter(x => x !== name) : [...cur, name];
      setIgnoreSet(new Set(next));
      getProvider().putSettings({ ...st, veeam_ignore: next.join(',') }).catch(() => {});
    }).catch(() => {});
  };

  const unmountFromPanel = async (m: VeeamMount) => {
    try {
      const r = await fetch('/api/veeam/unmount-clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share_name: m.share_name, clone_ds: m.clone_ds })
      });
      const d = await r.json();
      if (d?.error) { notify(d.error, 'err'); return; }
      // Limpia el estado local de la cadena para que los badges se actualicen.
      const snap = m.share_name.replace(/^VeeamClone_/, '').replace(/_\d+$/, '');
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('veeam_mount_') && k.endsWith(`_${snap}`)) localStorage.removeItem(k);
        }
      } catch { /* ignore */ }
      notify(t('veeam_disconnected'), 'ok');
      loadMounts();
      load(dataset);
    } catch (e: any) { notify(e?.message ?? t('error'), 'err'); }
  };

  // ¿Está montada alguna cadena de esta máquina? (estado por máquina+cadena)
  const machineMounted = (m: VeeamMachine) =>
    m.chains.some((c, i) => !!c.vbk?.snapshot_name &&
      !!localStorage.getItem(`veeam_mount_${m.name}_${i + 1}_${c.vbk.snapshot_name}`));

  const shownMachines = (data?.machines ?? []).filter(m => {
    if (q && !m.name.toLowerCase().includes(q.toLowerCase())) return false;
    switch (flt) {
      case 'broken': return m.chains.some(c => c.is_broken);
      case 'mounted': return machineMounted(m);
      case 'archive': return m.chains.some(c => !!c.vbk?.is_zfs_archive);
      default: return true;
    }
  });

  // El escaneo se dispara solo con el botón "Tara" o el montaje inicial;
  // antes se disparaba en cada pulsación de teclado (escaneaba el árbol de
  // snapshots de un dataset de TB en cada letra).
  const load = (ds: string) => {
    setLoading(true); setError('');
    fetch(`/api/veeam/explorer?dataset=${encodeURIComponent(ds)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); notify(d.error, 'err'); return; }
        setData(d);
        persistMonitored(ds);
      })
      .catch(e => { setError(e.message); notify(e?.message ?? t('error'), 'err'); })
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
    getProvider().getSettings().then(s => {
      setStaleDays(s.veeam_stale_days ?? 2);
      setIgnoreSet(new Set((s.veeam_ignore ?? '').split(',').map(x => x.trim()).filter(Boolean)));
    }).catch(() => {});
    loadMounts();
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

      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="inp" style={{ flex: 1, minWidth: 220 }} value={q}
          onChange={e => setQ(e.target.value)} placeholder={t('veeam_search')} />
        <select className="inp" style={{ width: 'auto' }} value={flt}
          onChange={e => setFlt(e.target.value as 'all' | 'broken' | 'mounted' | 'archive')}>
          <option value="all">{t('veeam_filter_all')}</option>
          <option value="broken">{t('veeam_filter_broken')}</option>
          <option value="mounted">{t('veeam_filter_mounted')}</option>
          <option value="archive">{t('veeam_filter_archive')}</option>
        </select>
      </div>

      {mounts && mounts.length > 0 && (
        <div style={{ marginBottom: '24px', padding: '14px 16px', backgroundColor: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px' }}>
          <div style={{ fontWeight: 700, marginBottom: 10, fontSize: '0.95em' }}>{t('veeam_mounts')} ({mounts.length})</div>
          {mounts.map(m => (
            <div key={m.share_name} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '7px 0', borderTop: '1px solid var(--border)' }}>
              <span style={{ color: '#1a7f37', fontWeight: 700 }}>●</span>
              <span className="mono" style={{ fontSize: '0.85em', flex: 1, wordBreak: 'break-all' }}>{m.path}</span>
              <button className="btn sm danger" onClick={() => unmountFromPanel(m)}>{t('veeam_unmount')}</button>
            </div>
          ))}
        </div>
      )}

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
            {shownMachines.map(m => (
              <MachineRow key={m.name} m={m} dataset={dataset} staleDays={staleDays}
                ignored={ignoreSet.has(m.name)} onToggleIgnore={() => toggleIgnore(m.name)} />
            ))}
            {shownMachines.length === 0 && (
                <div className="empty">{data.machines.length === 0 ? t('veeam_empty') : t('veeam_nomatch')}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
