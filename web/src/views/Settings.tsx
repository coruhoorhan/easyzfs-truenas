// Vista Ajustes: tarjetas con el título dentro (como NetPulse) en grid de 2
// columnas en pantalla ancha. Apariencia (tema/acento/densidad/animaciones),
// Mi sesión (idioma, contraseña, logout), push, zona admin (usuarios, copia
// de seguridad, umbrales, notificaciones) y Acerca de (con datos del sistema).
import { useEffect, useRef, useState } from 'react';
import { getProvider } from '../data';
import { errorMessage, useApp } from '../ui/store';
import { fmtBytes, fmtDuration, timeAgo } from '../ui/format';
import { Seg, Select, Spinner, Switch, Badge } from '../components/ui';
import { Logo, IconCode, IconList, IconHome, IconShield, IconDownload, IconCheck, IconSun, IconMoon, IconMonitor } from '../components/icons';
import { useModal } from '../components/Modal';
import { usePush } from '../data/push';
import {
  ACCENTS, getAccent, setAccent, getDensity, setDensity,
  getReduceMotion, setReduceMotion,
} from '../ui/theme';
import type { AccentId, Density, ThemeMode } from '../ui/theme';
import type { I18nKey } from '../ui/i18n';
import type { BackupStatus, PushAlertTipo, PushPreference, Settings as SettingsData } from '../data/types';

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

// Mini-preview de un tema estilo NetPulse: mini-UI (barra superior, sidebar,
// barra de acento, bloque) pintada con las VARIABLES CSS REALES scopeando
// data-theme en el propio contenedor — cero valores duplicados.
function ThemePreview({ mode }: { mode: ThemeMode }) {
  const half = (
    <div className="tpv-half">
      <div className="tpv-top" />
      <div className="tpv-row">
        <div className="tpv-side" />
        <div className="tpv-main">
          <div className="tpv-accent" />
          <div className="tpv-block" />
        </div>
      </div>
    </div>
  );
  return (
    <div className="tpv" aria-hidden="true">
      {mode !== 'dark' && <div className="tpv-scope" data-theme="light">{half}</div>}
      {mode !== 'light' && <div className="tpv-scope" data-theme="dark">{half}</div>}
    </div>
  );
}

// Etiqueta traducida de cada tipo de alerta (exhaustivo sobre PushAlertTipo).
const TIPO_LABEL: Record<PushAlertTipo, I18nKey> = {
  pool_capacity: 's_pt_pool_capacity',
  pool_status: 's_pt_pool_status',
  scrub_errors: 's_pt_scrub_errors',
  disk_temp: 's_pt_disk_temp',
  smart_status: 's_pt_smart_status',
};

// Opciones de hora 00–23 para el horario silencioso.
const HORAS = Array.from({ length: 24 }, (_, h) => ({
  v: String(h), label: `${String(h).padStart(2, '0')}:00`,
}));

// Repo público de la app (para "Comprobar actualizaciones").
const REPO = 'gnacho/easyzfs';
const REPO_URL = `https://github.com/${REPO}`;

// Comparación semver numérica ('v' opcional): 1.10.0 > 1.9.0.
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uptodate' }
  | { kind: 'available'; version: string; url: string }
  | { kind: 'error' };

// "Comprobar actualizaciones": GET anónima SOLO al pulsar el botón contra la
// última release del repo en GitHub (fallback a tags si no hay release).
// Nada de phone-home automático; no sale ningún dato de la instalación.
function useAppUpdate(currentVersion: string | undefined) {
  const { t } = useApp();
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });

  const check = async () => {
    if (!currentVersion) return;
    setState({ kind: 'checking' });
    try {
      let res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
      let tag = '';
      let url = `${REPO_URL}/releases`;
      if (res.ok) {
        const j = await res.json();
        tag = j.tag_name ?? '';
        url = j.html_url ?? url;
      } else if (res.status === 404) {
        // Sin release publicada: fallback al último tag
        res = await fetch(`https://api.github.com/repos/${REPO}/tags?per_page=1`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const tags = await res.json();
        tag = tags?.[0]?.name ?? '';
        url = `${REPO_URL}/releases/tag/${tag}`;
      } else {
        throw new Error(`HTTP ${res.status}`); // 403 = rate-limit 60/h por IP
      }
      if (tag && compareSemver(tag, currentVersion) > 0) {
        setState({ kind: 'available', version: tag.replace(/^v/, ''), url });
      } else {
        setState({ kind: 'uptodate' });
      }
    } catch {
      setState({ kind: 'error' });
    }
  };

  return { state, check, t };
}

// Fila "Comprobar actualizaciones" de la tarjeta Acerca de.
function UpdateCheck({ version }: { version: string | undefined }) {
  const { state, check, t } = useAppUpdate(version);
  return (
    <div style={{ marginTop: 14 }}>
      {state.kind === 'idle' && (
        <button className="btn" onClick={() => { void check(); }} disabled={!version}>
          {t('ab_checkupd')}
        </button>
      )}
      {state.kind === 'checking' && (
        <span className="muted">{t('ab_checking')}</span>
      )}
      {state.kind === 'uptodate' && (
        <span style={{ fontSize: 13, color: 'var(--ok)', fontWeight: 600 }} role="status">
          {t('ab_uptodate', { v: version ?? '' })}
        </span>
      )}
      {state.kind === 'available' && (
        <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }} role="status">
          {t('ab_newver', { v: state.version })}
          {' · '}
          <a href={state.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
            {t('ab_viewrel')}
          </a>
        </span>
      )}
      {state.kind === 'error' && (
        <span className="form-err" role="alert" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {t('ab_upderr')}
          <button className="btn sm" onClick={() => { void check(); }}>{t('ab_retry')}</button>
        </span>
      )}
    </div>
  );
}

// Tarjeta "Copia de seguridad" (zona admin): patrón ajuste-proceso — estado
// (último + próximo), configuración (switch + frecuencia + retención) y
// acciones (Forzar ahora / Exportar / Importar) en la misma tarjeta.
function BackupCard({ settings, onSave }: {
  settings: SettingsData;
  onSave: (patch: Partial<SettingsData>) => Promise<void>;
}) {
  const { t } = useApp();
  const [st, setSt] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => getProvider().getBackupStatus().then(setSt).catch(() => {});
  useEffect(() => {
    let alive = true;
    getProvider().getBackupStatus().then((s) => alive && setSt(s)).catch(() => {});
    return () => { alive = false; };
  }, []);

  const FREQS = [1, 6, 12, 24, 48, 72].map((h) => ({ v: String(h), label: t('bk_freq_h', { h }) }));

  const runNow = async () => {
    setBusy(true); setMsg(''); setErr('');
    try {
      const f = await getProvider().runBackup();
      setMsg(t('bk_done', { f: f.file }));
      load();
    } catch (e) { setErr(errorMessage(e, t)); }
    setBusy(false);
  };

  const doImport = async () => {
    if (!importFile) return;
    setBusy(true); setErr('');
    try {
      await getProvider().importBackup(importFile);
      // El server hace swap y reinicia el proceso; recargamos al cabo de unos
      // segundos para volver al login con la BD importada.
      setMsg(t('bk_import_restarting'));
      setTimeout(() => location.reload(), 4000);
    } catch (e) {
      setErr(errorMessage(e, t));
      setBusy(false);
      setImportFile(null);
    }
  };

  return (
    <div className="card pad admin-card">
      <h3 className="cardtitle">{t('bk_title')}</h3>

      {/* Estado */}
      <div className="kv"><span>{t('bk_last')}</span>
        <span>{st?.last
          ? <>{st.last.file} · {timeAgo(st.last.ts, t)} · {fmtBytes(st.last.bytes)}</>
          : t('bk_never')}</span>
      </div>
      {st?.next_run && (
        <div className="kv"><span>{t('bk_next')}</span><span>{timeAgo(st.next_run, t)}</span></div>
      )}
      {st?.running && <div className="kv"><span></span><span className="muted">{t('bk_running')}</span></div>}

      {/* Configuración */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14 }}>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{t('bk_enable')}</span>
        <Switch checked={settings.backup_enabled} ariaLabel={t('bk_enable')}
          onChange={(v) => { void onSave({ backup_enabled: v }); }} />
      </div>
      <div style={settings.backup_enabled ? undefined : { opacity: 0.4, pointerEvents: 'none' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}>
            <label>{t('bk_freq')}</label>
            <Select value={String(settings.backup_freq_hours)} ariaLabel={t('bk_freq')}
              options={FREQS}
              onChange={(v) => { void onSave({ backup_freq_hours: +v }); }} />
          </div>
          <div style={{ width: 130 }}>
            <label htmlFor="bk-ret">{t('bk_retention')}</label>
            <input id="bk-ret" type="number" min={1} max={30} value={settings.backup_retention_days}
              onChange={(e) => { void onSave({ backup_retention_days: +e.target.value }); }} />
          </div>
        </div>
      </div>

      {/* Acciones */}
      <div className="m-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn" disabled={busy} onClick={() => { void runNow(); }}>{t('bk_run')}</button>
        <a className="btn" href="/api/backup/download" download>{t('bk_export')}</a>
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>{t('bk_import')}</button>
        <input ref={fileRef} type="file" accept=".db,application/octet-stream" style={{ display: 'none' }}
          onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
      </div>

      {/* Importación: confirmación destructiva inline de dos pasos */}
      {importFile && (
        <div className="rebuildbar" style={{ marginTop: 12 }}>
          <span style={{ flex: 1, minWidth: 220 }}>{t('bk_import_q', { f: importFile.name })}</span>
          <button className="btn sm danger" disabled={busy} onClick={() => { void doImport(); }}>
            {t('bk_import_btn')}
          </button>
          <button className="btn sm" disabled={busy} onClick={() => setImportFile(null)}>{t('cancel')}</button>
        </div>
      )}
      {msg && <p style={{ fontSize: 13, color: 'var(--ok)', fontWeight: 600, marginTop: 10 }} role="status">{msg}</p>}
      {err && <p className="form-err" role="alert" style={{ marginTop: 10 }}>{err}</p>}
    </div>
  );
}

// Subsección de configuración de alertas (visible con push activado): switches
// por tipo + horario silencioso. Las críticas siempre llegan (texto visible).
function PushPrefs() {
  const { t } = useApp();
  const [prefs, setPrefs] = useState<PushPreference[] | null>(null);
  // Estado local del horario silencioso (start/end siempre números; al
  // desactivar se conservan para reactivar con los mismos valores).
  const [quiet, setQuiet] = useState<{ enabled: boolean; start: number; end: number } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    getProvider().getPushPreferences()
      .then((r) => alive && setPrefs(r.preferences)).catch(() => {});
    getProvider().getPushQuietHours()
      .then((q) => alive && setQuiet({ enabled: q.enabled, start: q.start ?? 22, end: q.end ?? 8 }))
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const toggleTipo = (tipo: PushAlertTipo, enabled: boolean) => {
    setPrefs((cur) => cur?.map((p) => (p.tipo === tipo ? { ...p, enabled } : p)) ?? cur);
    setErr('');
    getProvider().putPushPreference(tipo, enabled).catch((e) => setErr(errorMessage(e, t)));
  };

  const saveQuiet = (next: { enabled: boolean; start: number; end: number }) => {
    setQuiet(next);
    setErr('');
    if (next.enabled && next.start === next.end) {
      setErr(t('s_quiet_err')); // el servidor también lo valida (400 invalid_hours)
      return;
    }
    getProvider().putPushQuietHours(next).catch((e) => setErr(errorMessage(e, t)));
  };

  if (!prefs && !quiet) return null;
  return (
    <div style={{ marginTop: 16 }}>
      {prefs && (
        <>
          <label>{t('s_push_types')}</label>
          <p className="muted" style={{ marginTop: 0 }}>{t('s_push_types_d')}</p>
          {prefs.map((p) => (
            <div key={p.tipo} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0' }}>
              <span style={{ flex: 1, fontSize: 13.5 }}>{t(TIPO_LABEL[p.tipo])}</span>
              <Switch checked={p.enabled} ariaLabel={t(TIPO_LABEL[p.tipo])}
                onChange={(v) => toggleTipo(p.tipo, v)} />
            </div>
          ))}
        </>
      )}
      {quiet && (
        <>
          <label style={{ marginTop: 12 }}>{t('s_quiet')}</label>
          <p className="muted" style={{ marginTop: 0 }}>{t('s_quiet_d')}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0' }}>
            <span style={{ flex: 1, fontSize: 13.5 }}>{t('s_quiet_enable')}</span>
            <Switch checked={quiet.enabled} ariaLabel={t('s_quiet_enable')}
              onChange={(v) => saveQuiet({ ...quiet, enabled: v })} />
          </div>
          {quiet.enabled && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              <span className="muted">{t('s_quiet_from')}</span>
              <Select value={String(quiet.start)} ariaLabel={t('s_quiet_from')} options={HORAS}
                onChange={(v) => saveQuiet({ ...quiet, start: +v })} />
              <span className="muted">{t('s_quiet_to')}</span>
              <Select value={String(quiet.end)} ariaLabel={t('s_quiet_to')} options={HORAS}
                onChange={(v) => saveQuiet({ ...quiet, end: +v })} />
            </div>
          )}
        </>
      )}
      {err && <p className="form-err" role="alert" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}

// Sección "Notificaciones push": tarjeta explicativa ANTES del prompt nativo
// (qué alertas llegarán y que requiere la app cerrada para notar el efecto).
// El prompt nativo solo sale del gesto del botón "Activar alertas" (subscribe).
// Estados: activadas (con desactivar), denied (instrucciones, NO re-pedir),
// unsupported, iOS sin PWA (guía de instalación), demo y sin claves VAPID
// (nota informativa sin botón).
function PushSection() {
  const { t } = useApp();
  const { state, error, subscribe, unsubscribe } = usePush();

  return (
    <div className="card pad">
      <h3 className="cardtitle">{t('s_push')}</h3>
      <p className="muted">{t('s_push_d')}</p>

        {state === 'unknown' && (
          <p className="muted">{t('loading')}</p>
        )}

        {(state === 'idle' || state === 'subscribing' || state === 'error') && (
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <button className="btn primary" disabled={state === 'subscribing'}
              onClick={() => { void subscribe(); }}>
              {state === 'subscribing' ? t('s_push_enabling') : t('s_push_enable')}
            </button>
          </div>
        )}
        {state === 'error' && (
          <p className="form-err" role="alert">{t('s_push_error')}{error ? ` (${error})` : ''}</p>
        )}

        {state === 'subscribed' && (
          <>
            <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
              <Badge tone="ok" dot={false}>{t('s_push_on')}</Badge>
              <span className="muted">{t('s_push_on_d')}</span>
              <button className="btn sm" onClick={() => { void unsubscribe(); }}>{t('s_push_disable')}</button>
            </div>
            <PushPrefs />
          </>
        )}

        {state === 'denied' && (
          <p style={{ fontSize: 12.5, color: 'var(--warn)', marginTop: 10 }} role="alert">{t('s_push_denied')}</p>
        )}
        {state === 'unsupported' && (
          <p className="muted" style={{ marginTop: 10 }}>{t('s_push_unsupported')}</p>
        )}
        {state === 'needs-ios-install' && (
          <p className="muted" style={{ marginTop: 10 }}>{t('s_push_ios')}</p>
        )}
        {state === 'demo' && (
          <p className="muted" style={{ marginTop: 10 }}>{t('s_push_demo')}</p>
        )}
        {state === 'not-configured' && (
          <p className="muted" style={{ marginTop: 10 }}>{t('s_push_notcfg')}</p>
        )}
    </div>
  );
}

export default function Settings() {
  const { t, langMode, setLang, themeMode, themeEff, setTheme, isAdmin, user, logout, refresh } = useApp();
  const { openModal } = useModal();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [users, setUsers] = useState<Awaited<ReturnType<ReturnType<typeof getProvider>['getUsers']>> | null>(null);
  const [version, setVersion] = useState<Awaited<ReturnType<ReturnType<typeof getProvider>['getVersion']>> | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [accent, setAccentState] = useState<AccentId>(getAccent());
  const [density, setDensityState] = useState<Density>(getDensity());
  const [reduceMotion, setReduceMotionState] = useState(getReduceMotion());
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

  const themeOpts: { v: ThemeMode; label: string; icon: typeof IconSun }[] = [
    { v: 'light', label: t('s_theme_light'), icon: IconSun },
    { v: 'dark', label: t('s_theme_dark'), icon: IconMoon },
    { v: 'auto', label: t('s_theme_auto'), icon: IconMonitor },
  ];

  return (
    <div className="view settings-grid">
      {/* ---- Apariencia (estilo NetPulse: previews con variables reales) ---- */}
      <div className="card pad">
        <h3 className="cardtitle">{t('s_appear')}</h3>
        <label>{t('s_theme')}</label>
        <div className="themegrid" role="radiogroup" aria-label={t('s_theme')}>
          {themeOpts.map((o) => {
            const Ico = o.icon;
            return (
              <button key={o.v} type="button" role="radio" aria-checked={themeMode === o.v}
                className={`themecard${themeMode === o.v ? ' sel' : ''}`}
                onClick={() => setTheme(o.v)}>
                <ThemePreview mode={o.v} />
                <span className="lbl"><Ico size={13} />{o.label}</span>
                {themeMode === o.v && <span className="check"><IconCheck /></span>}
              </button>
            );
          })}
        </div>
        <label>{t('s_accent')}</label>
        <div className="swatches" role="group" aria-label={t('s_accent')}>
          {(Object.keys(ACCENTS) as AccentId[]).map((id) => (
            <button key={id} type="button" title={t(`acc_${id}`)} aria-label={t(`acc_${id}`)}
              className={`swatch${accent === id ? ' sel' : ''}`}
              aria-pressed={accent === id}
              onClick={() => { setAccent(id); setAccentState(id); }}>
              {/* el círculo pinta el color del tema EFECTIVO (el que se aplicará) */}
              <span style={{ background: ACCENTS[id][themeEff][0] }} />
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14 }}>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{t('s_rm')}</span>
            <span className="muted">{t('s_rm_d')}</span>
          </span>
          <Switch checked={reduceMotion} ariaLabel={t('s_rm')}
            onChange={(v) => { setReduceMotion(v); setReduceMotionState(v); }} />
        </div>
      </div>

      {/* ---- Notificaciones push (todos los usuarios) ---- */}
      <PushSection />

      {/* ---- Mi sesión: idioma + contraseña + logout ---- */}
      <div className="card pad">
        <h3 className="cardtitle">{t('s_session')}</h3>
        <label>{t('s_lang')}</label>
        <Select value={langMode} onChange={setLang} ariaLabel={t('s_lang')}
          options={[{ v: 'auto', label: t('s_lang_auto') }, { v: 'es', label: '🇪🇸 Español' }, { v: 'en', label: '🇬🇧 English' }]} />
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 16 }}>
          <button className="btn" onClick={() => openModal('mypass')}>{t('s_mypass')}</button>
          <button className="btn danger" onClick={logout}>{t('logout')}</button>
        </div>
      </div>

      {/* ---- Acerca de (con datos del sistema integrados) ---- */}
      {version && (
        <div className="card pad">
          <h3 className="cardtitle">{t('s_about')}</h3>
          <div className="about">
            <div className="logo"><Logo size={46} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{version?.name ?? 'EasyZFS'}</div>
              {version && (
                <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>
                  v{version.version} · build {version.build}
                </div>
              )}
              <div className="muted" style={{ marginTop: 2 }}>{t('s_about_d')}</div>
            </div>
          </div>

          <div className="abouttiles">
            <a className="abouttile" href={REPO_URL} target="_blank" rel="noreferrer">
              <span className="t-ico"><IconCode size={16} /></span>
              <b>{t('ab_code')}</b>
              <span>{t('ab_code_d')}</span>
            </a>
            <a className="abouttile" href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
              <span className="t-ico"><IconList size={16} /></span>
              <b>{t('ab_chlog')}</b>
              <span>{t('ab_chlog_d')}</span>
            </a>
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

          {/* Instalación PWA: SOLO visible si el navegador lo soporta
              (evento capturado, iOS con instrucciones o ya instalada);
              sin soporte no se renderiza nada (regla webapp-shell) */}
          {(installed || installEvt || isIOS()) && (
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
          )}

          <UpdateCheck version={version?.version} />

          {/* Sistema (datos del servidor, integrados en Acerca de) */}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div className="kv"><span>{t('ab_rt')}</span><span className="mono">{version.go} {version.os_arch}</span></div>
            <div className="kv"><span>{t('ab_up')}</span><span>{fmtDuration(version.uptime_sec)}</span></div>
            <div className="kv"><span>{t('ab_mem')}</span><span>{fmtBytes(version.rss_bytes)}</span></div>
            <div className="kv"><span>{t('ab_db')}</span><span>{fmtBytes(version.db_bytes)} · {version.db_path}</span></div>
            <div className="kv"><span>ZFS</span><span className="mono">{version.zfs_version}</span></div>
            <div className="kv"><span>{t('ab_lic')}</span><span>AGPL-3.0</span></div>
          </div>

          <div className="aboutfoot mono">
            {version?.name ?? 'EasyZFS'} v{version?.version ?? '0.1.0'} · {version?.zfs_version ?? 'OpenZFS'} · AGPL-3.0
          </div>
        </div>
      )}

      {/* ---- Zona de administración (tinte sutil; solo admin) ---- */}
      {isAdmin && <h2 className="zonehead">{t('s_admin_zone')}</h2>}

      {/* ---- Usuarios (solo admin; fila completa: contiene tabla) ---- */}
      {isAdmin && (
        <div className="card pad admin-card wide">
          <h3 className="cardtitle">{t('s_users')}
            <span className="actions" style={{ float: 'right' }}>
              <button className="btn sm primary" onClick={() => openModal('newuser')}>+ {t('s_newuser')}</button>
            </span>
          </h3>
          <div>
            {(users ?? []).map((u) => (
              <div className="rowitem" key={u.user}>
                <div className="grow">
                  <div className="t1" style={{ fontSize: 14 }}>
                    {u.user}
                    {u.user === user?.user && <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500 }}>{t('you')}</span>}
                    <span className={`rolebadge ${u.role}`}>{u.role === 'admin' ? t('mu_r_admin') : t('mu_r_user')}</span>
                  </div>
                  <div className="t2">
                    {t('s_last_login')}: {timeAgo(u.last_login, t)} · {u.sessions}{' '}
                    {u.sessions === 1 ? t('s_session_one') : t('s_sessions')}
                  </div>
                </div>
                <Select value={u.language ?? 'auto'} ariaLabel={t('s_lang')}
                  options={[{ v: 'auto', label: t('s_lang_auto') }, { v: 'es', label: '🇪🇸 Español' }, { v: 'en', label: '🇬🇧 English' }]}
                  onChange={(v) => {
                    const lang = v as 'auto' | 'es' | 'en';
                    setUsers((cur) => cur?.map((x) => (x.user === u.user ? { ...x, language: lang } : x)) ?? cur);
                    getProvider().setUserLanguage(u.user, lang).catch(() => {});
                  }} />
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

      {/* ---- Copia de seguridad de la BD (solo admin) ---- */}
      {isAdmin && <BackupCard settings={settings} onSave={saveSettings} />}

      {/* ---- Umbrales (solo admin) ---- */}
      {isAdmin && (
        <div className="card pad admin-card">
          <h3 className="cardtitle">{t('s_thresh')}</h3>
          <p className="muted">{t('s_thresh_d')}</p>
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
      )}

      {/* ---- Notificaciones webhook (solo admin) ---- */}
      {isAdmin && (
        <div className="card pad admin-card">
          <h3 className="cardtitle">{t('s_notif')}</h3>
          <label htmlFor="nf-hook">{t('s_webhook')}</label>
          <input id="nf-hook" placeholder={t('s_webhook_ph')} value={settings.webhook}
            onChange={(e) => setSettings({ ...settings, webhook: e.target.value })} />
          <label className="checklabel" style={{ marginTop: 16 }}>
            <input type="checkbox" checked={settings.notify_scrub_errors}
              onChange={(e) => setSettings({ ...settings, notify_scrub_errors: e.target.checked })} />
            {t('s_n_scrub')}
          </label>
          <label className="checklabel">
            <input type="checkbox" checked={settings.notify_smart_change}
              onChange={(e) => setSettings({ ...settings, notify_smart_change: e.target.checked })} />
            {t('s_n_smart')}
          </label>
          <div className="m-actions">
            <button className="btn primary" onClick={() => saveSettings({})}>{t('save')}</button>
          </div>
        </div>
      )}

      {msg && <p style={{ fontSize: 13, color: 'var(--ok)', fontWeight: 600, marginTop: 12 }} role="status">{msg}</p>}
      {err && <p className="form-err" role="alert">{err}</p>}

    </div>
  );
}
