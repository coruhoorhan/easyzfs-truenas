// Vista Ajustes: general, usuarios (admin), umbrales, notificaciones, sesión y acerca de.
import { useEffect, useState } from 'react';
import { getProvider } from '../data';
import { errorMessage, useApp } from '../ui/store';
import { fmtBytes, fmtDuration, timeAgo } from '../ui/format';
import { Seg, Spinner } from '../components/ui';
import { Logo } from '../components/icons';
import { useModal } from '../components/Modal';
import type { Settings as SettingsData } from '../data/types';

export default function Settings() {
  const { t, langMode, setLang, themeMode, setTheme, isAdmin, user, logout, refresh } = useApp();
  const { openModal } = useModal();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [users, setUsers] = useState<Awaited<ReturnType<ReturnType<typeof getProvider>['getUsers']>> | null>(null);
  const [version, setVersion] = useState<Awaited<ReturnType<ReturnType<typeof getProvider>['getVersion']>> | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [pw, setPw] = useState({ cur: '', p1: '', p2: '' });

  useEffect(() => {
    let alive = true;
    getProvider().getSettings().then((s) => alive && setSettings(s)).catch(() => {});
    getProvider().getVersion().then((v) => alive && setVersion(v)).catch(() => {});
    if (isAdmin) getProvider().getUsers().then((u) => alive && setUsers(u)).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, refresh]);

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

  const changeMyPw = async () => {
    setErr(''); setMsg('');
    if (pw.p1 !== pw.p2) { setErr(t('s_mypass_mismatch')); return; }
    try {
      await getProvider().setMyPassword(pw.cur, pw.p1);
      setMsg(t('saved_ok'));
      setPw({ cur: '', p1: '', p2: '' });
    } catch (e) { setErr(errorMessage(e, t)); }
  };

  if (!settings) return <Spinner label={t('loading')} />;

  return (
    <div className="view">
      {/* ---- General ---- */}
      <div className="card pad">
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{t('s_general')}</h3>
        <label>{t('s_lang')}</label>
        <Seg value={langMode} onChange={setLang} ariaLabel={t('s_lang')}
          options={[{ v: 'auto', label: 'Auto' }, { v: 'es', label: 'Español' }, { v: 'en', label: 'English' }]} />
        <label>{t('s_theme')}</label>
        <Seg value={themeMode} onChange={setTheme} ariaLabel={t('s_theme')}
          options={[
            { v: 'auto', label: t('s_theme_auto') },
            { v: 'light', label: t('s_theme_light') },
            { v: 'dark', label: t('s_theme_dark') },
          ]} />
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
            <div className="m-actions">
              <button className="btn primary" onClick={() => saveSettings({})}>{t('save')}</button>
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
          <label htmlFor="pw-cur">{t('s_mypass')}</label>
          <input id="pw-cur" type="password" placeholder={t('s_mypass_cur')} style={{ marginBottom: 8 }}
            value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} autoComplete="current-password" />
          <input type="password" placeholder={t('mp_new')} style={{ marginBottom: 8 }} aria-label={t('mp_new')}
            value={pw.p1} onChange={(e) => setPw({ ...pw, p1: e.target.value })} autoComplete="new-password" />
          <input type="password" placeholder={t('s_mypass2')} aria-label={t('s_mypass2')}
            value={pw.p2} onChange={(e) => setPw({ ...pw, p2: e.target.value })} autoComplete="new-password" />
          <div className="m-actions">
            <button className="btn" onClick={changeMyPw} disabled={!pw.cur || pw.p1.length < 8}>{t('update')}</button>
            <button className="btn danger" onClick={logout}>{t('logout')}</button>
          </div>
        </div>
      </div>

      {/* ---- Acerca de ---- */}
      <div className="sect">
        <h2>{t('s_about')}</h2>
        <div className="card pad">
          <div className="about">
            <div className="logo"><Logo size={26} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>zfsctl</div>
              <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{t('s_about_d')}</div>
            </div>
          </div>
          {version && (
            <div style={{ marginTop: 14 }}>
              <div className="kv"><span>{t('ab_ver')}</span><span>{version.version} (build {version.build})</span></div>
              <div className="kv"><span>{t('ab_rt')}</span><span className="mono">{version.go} {version.os_arch}</span></div>
              <div className="kv"><span>{t('ab_up')}</span><span>{fmtDuration(version.uptime_sec)}</span></div>
              <div className="kv"><span>{t('ab_mem')}</span><span>{fmtBytes(version.rss_bytes)}</span></div>
              <div className="kv"><span>{t('ab_db')}</span><span>{fmtBytes(version.db_bytes)} · {version.db_path}</span></div>
              <div className="kv"><span>ZFS</span><span className="mono">{version.zfs_version}</span></div>
              <div className="kv"><span>{t('ab_lic')}</span><span>MIT</span></div>
            </div>
          )}
          <div className="m-actions">
            <button className="btn sm" onClick={() => setMsg('0.1.0 — primera versión pública')}>{t('ab_chlog')}</button>
            <button className="btn sm" onClick={() => setMsg(t('ab_uptodate'))}>{t('ab_upd')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
