// Shell principal: sidebar (desktop) / bottom-nav (móvil), header con alertas y tema,
// barra de modo demo y vistas con code-splitting (React.lazy).
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { AppProvider, useApp, alertTargetView } from './ui/store';
import type { ViewId } from './ui/store';
import { ModalProvider, ModalHost } from './components/ModalHost';
import { Logo, IconHome, IconPool, IconData, IconSnap, IconTask, IconDisk, IconGear, IconBell, IconMoon, IconSun, IconChev } from './components/icons';
import { Spinner } from './components/ui';
import { getProvider } from './data';
import { subscribeEvents } from './data/events';
import { timeAgo } from './ui/format';
import { toggleTheme } from './ui/theme';
import type { Alert } from './data/types';
import Login from './views/Login';

// Code-splitting por vista
const Dashboard = lazy(() => import('./views/Dashboard'));
const Pools = lazy(() => import('./views/Pools'));
const Datasets = lazy(() => import('./views/Datasets'));
const Snapshots = lazy(() => import('./views/Snapshots'));
const Tasks = lazy(() => import('./views/Tasks'));
const Disks = lazy(() => import('./views/Disks'));
const Settings = lazy(() => import('./views/Settings'));

const NAV: { id: ViewId; icon: ComponentType<{ size?: number }>; adminOnly?: boolean }[] = [
  { id: 'dash', icon: IconHome },
  { id: 'pools', icon: IconPool },
  { id: 'data', icon: IconData },
  { id: 'snaps', icon: IconSnap },
  { id: 'tasks', icon: IconTask },
  { id: 'disks', icon: IconDisk },
  { id: 'settings', icon: IconGear, adminOnly: true },
];

// Panel desplegable de alertas (campanita)
function AlertsPanel({ onClose }: { onClose: () => void }) {
  const { t, navigate } = useApp();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const load = () => getProvider().getAlerts().then(setAlerts).catch(() => {});
  useEffect(() => {
    load();
    // Nuevas alertas en tiempo real
    return subscribeEvents((ev) => { if (ev.type === 'alert.new') load(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const ack = async (id: number) => {
    await getProvider().ackAlert(id).catch(() => {});
    setAlerts((cur) => cur.map((a) => (a.id === id ? { ...a, acked: true } : a)));
  };
  const ackAll = async () => {
    for (const a of alerts.filter((x) => !x.acked)) await getProvider().ackAlert(a.id).catch(() => {});
    load();
  };

  const pending = alerts.filter((a) => !a.acked);
  return (
    <div className="alertpanel" ref={ref} role="dialog" aria-label={t('al_title')}>
      <div className="rowitem" style={{ padding: '11px 16px' }}>
        <b style={{ fontSize: 14 }}>{t('al_title')}</b>
        {pending.length > 0 && (
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={ackAll}>{t('al_ack_all')}</button>
        )}
      </div>
      {pending.length === 0 && <div className="empty">{t('al_none')}</div>}
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {pending.map((a) => {
          const tone = a.level === 'crit' ? 'err' : a.level === 'warn' ? 'warn' : 'info';
          const view = alertTargetView(a.target);
          const go = view ? () => { navigate(view); onClose(); } : undefined;
          return (
            <div className={`alert${view ? ' clickable' : ''}`} key={a.id}
              role={view ? 'link' : undefined} tabIndex={view ? 0 : undefined}
              title={view ? t('al_goto') : undefined}
              onClick={go}
              onKeyDown={go ? (e) => { if (e.key === 'Enter') go(); } : undefined}>
              <div className="ico" style={{ background: `var(--${tone}-soft)`, color: `var(--${tone})` }}>
                {a.level === 'crit' ? '!' : a.level === 'warn' ? '⚠' : 'i'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 13 }}>{a.message}</b>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                  {a.source} · {timeAgo(a.ts, t)}
                </div>
              </div>
              <button className="btn sm" onClick={(e) => { e.stopPropagation(); ack(a.id); }}>{t('al_ack')}</button>
              {view && <span className="chev"><IconChev /></span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Shell() {
  const { t, route, navigate, demo, exitDemo, user, isAdmin, themeEff, ready } = useApp();
  const [showAlerts, setShowAlerts] = useState(false);
  const [hasPending, setHasPending] = useState(false);

  // Punto indicador si hay alertas sin leer (espera a que el provider esté listo)
  useEffect(() => {
    if (!ready || !user) return;
    let alive = true;
    getProvider().getAlerts()
      .then((a) => alive && setHasPending(a.some((x) => !x.acked)))
      .catch(() => {});
    return subscribeEvents((ev) => {
      if (ev.type === 'alert.new') setHasPending(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user]);

  if (!ready) {
    return <div className="splash"><Logo size={42} /><div>{t('login_checking')}</div></div>;
  }
  if (!user) return <Login />;

  const navItems = NAV.filter((n) => !n.adminOnly || isAdmin);
  const active = navItems.some((n) => n.id === route) ? route : 'dash';

  const view = (() => {
    switch (active) {
      case 'dash': return <Dashboard />;
      case 'pools': return <Pools />;
      case 'data': return <Datasets />;
      case 'snaps': return <Snapshots />;
      case 'tasks': return <Tasks />;
      case 'disks': return <Disks />;
      case 'settings': return <Settings />;
    }
  })();

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <Logo size={30} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-.02em' }}>EasyZFS</div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>{user.user} · {user.role}</div>
            </div>
          </div>
          <nav>
            {navItems.map((n) => {
              const Ico = n.icon;
              return (
                <a key={n.id} href={`#/${n.id}`} className={n.id === active ? 'active' : ''}
                  aria-current={n.id === active ? 'page' : undefined}>
                  <Ico />{t(n.id as never)}
                </a>
              );
            })}
          </nav>
        </aside>

        <main className="main">
          {demo && (
            <div className="demobar" role="status">
              <span className="dot" />
              <span>{t('demobar')}</span>
              <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={exitDemo}>
                {t('demobar_exit')}
              </button>
            </div>
          )}
          <header className="top">
            <div>
              <h1>{t(active as never)}</h1>
              <div className="sub">{t(`sub_${active}` as never)}</div>
            </div>
            <div className="head-actions">
              <button className="iconbtn" title={t('a11y_alerts')} aria-label={t('a11y_alerts')}
                style={{ position: 'relative' }} onClick={() => { setShowAlerts((v) => !v); setHasPending(false); }}>
                <IconBell />
                {hasPending && <span className="ping" />}
              </button>
              <button className="iconbtn" title={t('a11y_theme')} aria-label={t('a11y_theme')} onClick={toggleTheme}>
                {themeEff === 'dark' ? <IconSun /> : <IconMoon />}
              </button>
              {showAlerts && <AlertsPanel onClose={() => setShowAlerts(false)} />}
            </div>
          </header>

          <Suspense fallback={<Spinner label={t('loading')} />}>
            {view}
          </Suspense>
        </main>
      </div>

      <nav className="bottomnav" aria-label="principal">
        {navItems.slice(0, 5).map((n) => {
          const Ico = n.icon;
          return (
            <button key={n.id} className={n.id === active ? 'active' : ''} onClick={() => navigate(n.id)}>
              <Ico size={22} />
              <span>{t(n.id as never)}</span>
            </button>
          );
        })}
      </nav>

      <ModalHost />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <ModalProvider>
        <Shell />
      </ModalProvider>
    </AppProvider>
  );
}
