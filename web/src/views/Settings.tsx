// Vista Ajustes: apariencia, usuarios (admin), umbrales, notificaciones,
// sesión, acerca de (estilo netpulse) y datos del sistema.
import { useEffect, useState } from 'react';
import { getProvider } from '../data';
import { errorMessage, useApp } from '../ui/store';
import { fmtBytes, fmtDuration, timeAgo } from '../ui/format';
import { Seg, Select, Spinner, Badge } from '../components/ui';
import { Logo, IconCode, IconList, IconHome, IconShield, IconDownload } from '../components/icons';
import { useModal } from '../components/Modal';
import {
  ACCENTS, getAccent, setAccent, getDensity, setDensity,
} from '../ui/theme';
import type { AccentId, Density, ThemeMode } from '../ui/theme';
import type { Settings as SettingsData } from '../data/types';

// Evento beforeinstallprompt (PWA), no tipado en lib.dom
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as { standalone?: boolean }).standalone === true;
}

// Mini-preview visual de un tema (barras simuladas, sin animación)
function ThemePreview({ mode }: { mode: ThemeMode }) {
  const mini = (key: string, bg: string, bar: string) => (
    <div key={key} style={{
      flex: 1, background: bg, borderRadius: 6, padding: 5,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ height: 5, borderRadius: 3, background: bar, width: '72%' }} />
      <div style={{ height: 5, borderRadius: 3, background: bar, width: '52%' }} />
      <div style={{ height: 5, borderRadius: 3, background: 'var(--accent)', width: '36%' }} />
    </div>
  );
  return (
    <div className="tpreview" aria-hidden="true">
      {mode !== 'dark' && mini('l', '#f6f6f3', '#dcdcd4')}
      {mode !== 'light' && mini('d', '#0e1210', '#2a332d')}
    </div>
  );
}

export default function Settings() {
  const { t, langMode, setLang, themeMode, setTheme, isAdmin, user, logout, refresh } = useApp();
  const { openModal } = useModal();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [users, setUsers] = useState<Awaited<ReturnType<ReturnType<typeof getProvider>['getUsers']>> | null>(null);
  const [version, setVersion] = useState<Awaited<ReturnType<ReturnType<typeof getProvider>['getVersion']>> | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [accent, setAccentState] = useState<AccentId>(getAccent());
  const [density, setDensityState] = useState<Density>(getDensity());
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    let alive = true;
    getProvider().getSettings().then((s) => alive && setSettings(s)).catch(() => {});
    getProvider().getVersion().then((v) => alive && setVersion(v)).catch(() => {});
    if (isAdmin) getProvider().getUsers().then((u) => alive && setUsers(u)).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, refresh]);

  // Instalación PWA: captura el evento y detecta cuando queda instalada
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setInstallEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const saveSettings = async (patch: Partial<SettingsData>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setMsg(''); setErr('');
    try {
      await getProvider().putSettings(next);
      setMsg(t('saved_ok'));
    } catch (e) { setErr(errorMessage(e, t)); }
  };

  if (!settings) return <Spinner label={t('loading')} />;

  // Validación de umbrales en cliente: capacidad 1-100 con warn < crit,
  // temperatura entre 20 y 90 °C. Si no cumple, se avisa inline y se
  // deshabilita el botón de guardar umbrales.
  const capOk = Number.isInteger(settings.cap_warn_pct) && Number.isInteger(settings.cap_crit_pct)
    && settings.cap_warn_pct >= 1 && settings.cap_warn_pct <= 100
    && settings.cap_crit_pct >= 1 && settings.cap_crit_pct <= 100
    && settings.cap_warn_pct < settings.cap_crit_pct;
  const tempOk = Number.isInteger(settings.disk_temp_c)
    && settings.disk_temp_c >= 20 && settings.disk_temp_c <= 90;
  const threshOk = capOk && tempOk;

  const themeOpts: { v: ThemeMode; label: string }[] = [
    { v: 'light', label: t('s_theme_light') },
    { v: 'dark', label: t('s_theme_dark') },
    { v: 'auto', label: t('s_theme_auto') },
  ];

  return (
    <div className="view">
      {/* ---- Apariencia ---- */}
      <div className="card pad">
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{t('s_appear')}</h3>
        <label>{t('s_theme')}</label>
        <div className="themegrid" role="group" aria-label={t('s_theme')}>
          {themeOpts.map((o) => (
            <button key={o.v} type="button"
              className={`themecard${themeMode === o.v ? ' sel' : ''}`}
              aria-pressed={themeMode === o.v} onClick={() => setTheme(o.v)}>
              <ThemePreview mode={o.v} />
              <span className="lbl">{o.label}</span>
            </button>
          ))}
        </div>
        <label>{t('s_accent')}</label>
        <div className="swatches" role="group" aria-label={t('s_accent')}>
          {(Object.keys(ACCENTS) as AccentId[]).map((id) => (
            <button key={id} type="button" title={id} aria-label={id}
              className={`swatch${accent === id ? ' sel' : ''}`}
              aria-pressed={accent === id}
              onClick={() => { setAccent(id); setAccentState(id); }}>
              <span style={{ background: `linear-gradient(135deg, ${ACCENTS[id].light[0]} 50%, ${ACCENTS[id].dark[0]} 50%)` }} />
            </button>
          ))}
        </div>
        <label>{t('s_density')}</label>
        <Seg value={density} ariaLabel={t('s_density')}
          onChange={(d) => { setDensity(d); setDensityState(d); }}
          options={[
            { v: 'cozy', label: t('s_density_cozy') },
            { v: 'compact', label: t('s_density_compact') },
          ]} />
        <label>{t('s_lang')}</label>
        <Select value={langMode} onChange={setLang} ariaLabel={t('s_lang')}
          options={[{ v: 'auto', label: '🌐 Auto' }, { v: 'es', label: '🇪🇸 Español' }, { v: 'en', label: '🇬🇧 English' }]} />
      </div>

      {/* ---- Usuarios (solo admin) ---- */}
      {isAdmin && (
        <div className="sect">
          <h2>{t('s_users')}
            <span className="actions">
              <button className="btn sm primary" onClick={() => openModal('newuser')}>+ {t('s_newuser')}</button>
            </span>
          </h2>
          <div className="card">
            {(users ?? []).map((u) => (
              <div className="rowitem" key={u.user}>
                <div className="grow">
                  <div className="t1" style={{ fontSize: 14 }}>
                    {u.user}
                    {u.user === user?.user && <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500 }}>{t('you')}</span>}
                    <span className={`rolebadge ${u.role}`}>{u.role === 'admin' ? 'Admin' : t('mu_r_user')}</span>
                  </div>
                  <div className="t2">
                    {t('s_last_login')}: {timeAgo(u.last_login, t)} · {u.sessions}{' '}
                    {u.sessions === 1 ? t('s_session_one') : t('s_sessions')}
                  </div>
                </div>
                <button className="btn sm" onClick={() => openModal('passwd', { user: u.user })}>{t('s_passwd')}</button>
                {u.user !== user?.user && (
                  <button className="btn sm danger" onClick={() => openModal('deluser', { user: u.user })}>{t('s_delete_user')}</button>
                )}
              </div>
            ))}
            {users && users.length === 0 && <div className="empty">{t('empty')}</div>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>{t('s_roles_d')}</p>
        </div>
      )}

      {/* ---- Umbrales (solo admin) ---- */}
      {isAdmin && (
        <div className="sect">
          <h2>{t('s_thresh')}</h2>
          <div className="card pad">
            <p style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('s_thresh_d')}</p>
            <label htmlFor="th-warn">{t('s_cap_warn')}</label>
            <input id="th-warn" type="number" value={settings.cap_warn_pct}
              onChange={(e) => setSettings({ ...settings, cap_warn_pct: +e.target.value })} />
            <label htmlFor="th-crit">{t('s_cap_crit')}</label>
            <input id="th-crit" type="number" value={settings.cap_crit_pct}
              onChange={(e) => setSettings({ ...settings, cap_crit_pct: +e.target.value })} />
            <label htmlFor="th-temp">{t('s_temp')}</label>
            <input id="th-temp" type="number" value={settings.disk_temp_c}
              onChange={(e) => setSettings({ ...settings, disk_temp_c: +e.target.value })} />
            {!threshOk && <p className="form-err" role="alert">{t('s_thresh_invalid')}</p>}
            <div className="m-actions">
              <button className="btn primary" disabled={!threshOk} onClick={() => saveSettings({})}>{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Notificaciones (solo admin) ---- */}
      {isAdmin && (
        <div className="sect">
          <h2>{t('s_notif')}</h2>
          <div className="card pad">
            <label htmlFor="nf-hook">{t('s_webhook')}</label>
            <input id="nf-hook" placeholder={t('s_webhook_ph')} value={settings.webhook}
              onChange={(e) => setSettings({ ...settings, webhook: e.target.value })} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, textTransform: 'none', fontSize: 13.5, fontWeight: 500, color: 'var(--text)', marginTop: 16 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={settings.notify_scrub_errors}
                onChange={(e) => setSettings({ ...settings, notify_scrub_errors: e.target.checked })} />
              {t('s_n_scrub')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, textTransform: 'none', fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={settings.notify_smart_change}
                onChange={(e) => setSettings({ ...settings, notify_smart_change: e.target.checked })} />
              {t('s_n_smart')}
            </label>
            <div className="m-actions">
              <button className="btn primary" onClick={() => saveSettings({})}>{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {msg && <p style={{ fontSize: 13, color: 'var(--ok)', fontWeight: 600, marginTop: 12 }} role="status">{msg}</p>}
      {err && <p className="form-err" role="alert">{err}</p>}

      {/* ---- Mi sesión ---- */}
      <div className="sect">
        <h2>{t('s_session')}</h2>
        <div className="card pad">
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => openModal('mypass')}>{t('s_mypass')}</button>
            <button className="btn danger" onClick={logout}>{t('logout')}</button>
          </div>
        </div>
      </div>

      {/* ---- Sistema ---- */}
      {version && (
        <div className="sect">
          <h2>{t('ab_system')}</h2>
          <div className="card pad">
            <div className="kv"><span>{t('ab_ver')}</span><span>{version.version} (build {version.build})</span></div>
            <div className="kv"><span>{t('ab_rt')}</span><span className="mono">{version.go} {version.os_arch}</span></div>
            <div className="kv"><span>{t('ab_up')}</span><span>{fmtDuration(version.uptime_sec)}</span></div>
            <div className="kv"><span>{t('ab_mem')}</span><span>{fmtBytes(version.rss_bytes)}</span></div>
            <div className="kv"><span>{t('ab_db')}</span><span>{fmtBytes(version.db_bytes)} · {version.db_path}</span></div>
            <div className="kv"><span>ZFS</span><span className="mono">{version.zfs_version}</span></div>
            <div className="kv"><span>{t('ab_lic')}</span><span>AGPL-3.0</span></div>
          </div>
        </div>
      )}
      {/* ---- Acerca de (estilo netpulse) ---- */}
      <div className="sect">
        <h2>{t('s_about')}</h2>
        <div className="card pad">
          <div className="about">
            <div className="logo"><Logo size={46} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{version?.name ?? 'EasyZFS'}</div>
              {version && (
                <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>
                  v{version.version} · build {version.build}
                </div>
              )}
              <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 2 }}>{t('s_about_d')}</div>
            </div>
          </div>

          <div className="abouttiles">
            <a className="abouttile" href="https://github.com/gnacho/easyzfs" target="_blank" rel="noreferrer">
              <span className="t-ico"><IconCode size={16} /></span>
              <b>{t('ab_code')}</b>
              <span>{t('ab_code_d')}</span>
            </a>
            <button type="button" className="abouttile"
              onClick={() => setMsg(`0.1.0 — ${t('ab_chlog_first')}`)}>
              <span className="t-ico"><IconList size={16} /></span>
              <b>{t('ab_chlog')}</b>
              <span>{t('ab_chlog_d')}</span>
            </button>
            <div className="abouttile">
              <span className="t-ico"><IconHome size={16} /></span>
              <b>{t('ab_home')}</b>
              <span>{t('ab_home_d')}</span>
            </div>
            <div className="abouttile">
              <span className="t-ico"><IconShield size={16} /></span>
              <b>{t('ab_priv')}</b>
              <span>{t('ab_priv_d')}</span>
            </div>
          </div>

          {/* Instalación PWA */}
          <div className="installstrip">
            <span className="t-ico" style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <IconDownload size={16} />
            </span>
            <div className="grow">
              <b>{t('ab_install')}</b>
              <div className="d">
                {installed ? t('ab_installed_d')
                  : isIOS() ? t('ab_install_ios')
                  : t('ab_install_d')}
              </div>
            </div>
            {installed
              ? <Badge tone="ok" dot={false}>{t('ab_installed')}</Badge>
              : installEvt
                ? <button className="btn sm primary" onClick={() => { void installEvt.prompt(); }}>{t('ab_install_btn')}</button>
                : null}
          </div>

          <div className="aboutfoot mono">
            {version?.name ?? 'EasyZFS'} v{version?.version ?? '0.1.0'} · {version?.zfs_version ?? 'OpenZFS'} · AGPL-3.0
          </div>
        </div>
      </div>

    </div>
  );
}
