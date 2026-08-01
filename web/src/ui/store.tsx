// Estado global de la app: sesión, ruta, modo demo, idioma y tema.
// Router ligero basado en hash (#/vista).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionUser } from '../data/types';
import { getProvider, initProvider, enterDemoSession, exitDemoSession } from '../data';
import { AUTH_EXPIRED_EVENT, connectSSE, disconnectSSE } from '../data/events';
import { ApiError } from '../data/types';
import { initLang, onLangChange, setLangMode, t as translate, getLangMode } from './i18n';
import type { LangMode, I18nKey } from './i18n';
import { applyTheme, applyDensity, onThemeChange, startThemeWatcher, effectiveTheme, setThemeMode, getThemeMode } from './theme';
import type { ThemeMode } from './theme';

export type ViewId = 'dash' | 'pools' | 'data' | 'snaps' | 'tasks' | 'disks' | 'settings';
export const VIEWS: ViewId[] = ['dash', 'pools', 'data', 'snaps', 'tasks', 'disks', 'settings'];

function parseHash(): ViewId {
  const h = location.hash.replace(/^#\/?/, '') as ViewId;
  return VIEWS.includes(h) ? h : 'dash';
}

interface AppCtx {
  ready: boolean;            // provider inicializado
  demo: boolean;
  user: SessionUser | null;
  route: ViewId;
  navigate: (v: ViewId) => void;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  enterDemo: () => Promise<void>;
  exitDemo: () => void;
  // Sobrecargada: acepta claves del diccionario y también strings genéricos
  // (para helpers como timeAgo/describeSchedule que construyen claves dinámicas)
  t: ((k: I18nKey, vars?: Record<string, string | number>) => string) & ((k: string) => string);
  langMode: LangMode;
  setLang: (m: LangMode) => void;
  themeMode: ThemeMode;
  themeEff: 'light' | 'dark';
  setTheme: (m: ThemeMode) => void;
  isAdmin: boolean;
  // Contador para forzar refresco de datos tras mutaciones
  refresh: () => void;
  dataVersion: number;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [demo, setDemo] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [route, setRoute] = useState<ViewId>(parseHash());
  const [langMode, setLangModeState] = useState<LangMode>(getLangMode());
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getThemeMode());
  const [themeEff, setThemeEff] = useState<'light' | 'dark'>(effectiveTheme());
  const [dataVersion, setDataVersion] = useState(0);

  // Arranque: idioma, tema, provider y sesión existente
  useEffect(() => {
    initLang();
    applyTheme(); // aplica también el acento guardado (depende del tema efectivo)
    applyDensity();
    startThemeWatcher();
    const offLang = onLangChange(() => setLangModeState(getLangMode()));
    const offTheme = onThemeChange(() => {
      setThemeModeState(getThemeMode());
      setThemeEff(effectiveTheme());
    });
    (async () => {
      const { demo: d } = await initProvider();
      setDemo(d);
      try {
        setUser(await getProvider().me());
      } catch {
        setUser(null); // sin sesión → pantalla de login
      }
      setReady(true);
    })();
    return () => { offLang(); offTheme(); };
  }, []);

  // Router por hash
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((v: ViewId) => {
    location.hash = `/${v}`;
  }, []);

  const login = useCallback(async (u: string, p: string) => {
    const s = await getProvider().login(u, p);
    setUser(s);
    connectSSE(); // reabre el stream con la sesión recién creada
  }, []);

  const logout = useCallback(async () => {
    disconnectSSE(); // corta el stream antes de cerrar la sesión
    try { await getProvider().logout(); } catch { /* la sesión local se cierra igual */ }
    if (demo) { exitDemoSession(); setDemo(false); } // cerrar sesión en demo también sale del demo
    setUser(null);
    location.hash = '/dash';
  }, [demo]);

  // Sesión expirada (401 global en http.ts o 3 fallos 401 del SSE):
  // fuerza logout y vuelta al login. Solo aplica a sesiones reales (no demo)
  // y con sesión activa (evita bucles con el propio logout).
  const stateRef = useRef({ user, demo, logout });
  stateRef.current = { user, demo, logout };
  useEffect(() => {
    const onExpired = () => {
      const s = stateRef.current;
      if (s.demo || !s.user) return;
      void s.logout();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  // Sesión demo local (provider mock, usuario "demo"); no llama al backend
  const enterDemo = useCallback(async () => {
    await enterDemoSession();
    setDemo(true);
    try { setUser(await getProvider().me()); } catch { setUser(null); }
    setDataVersion((v) => v + 1);
  }, []);

  // Cierra la sesión demo y vuelve a la pantalla de login (provider HTTP)
  const exitDemo = useCallback(() => {
    exitDemoSession();
    setDemo(false);
    setUser(null);
    location.hash = '/dash';
    setDataVersion((v) => v + 1);
  }, []);

  const t = useCallback(
    ((k: I18nKey, vars?: Record<string, string | number>) => translate(k, vars)) as AppCtx['t'],
    // langMode fuerza nueva identidad al cambiar idioma
    [langMode],
  );

  const setLang = useCallback((m: LangMode) => setLangMode(m), []);
  const setTheme = useCallback((m: ThemeMode) => setThemeMode(m), []);
  const refresh = useCallback(() => setDataVersion((v) => v + 1), []);

  const value = useMemo<AppCtx>(() => ({
    ready, demo, user, route, navigate, login, logout, enterDemo, exitDemo,
    t, langMode, setLang, themeMode, themeEff, setTheme,
    isAdmin: user?.role === 'admin',
    refresh, dataVersion,
  }), [ready, demo, user, route, navigate, login, logout, enterDemo, exitDemo, t, langMode, setLang, themeMode, themeEff, setTheme, refresh, dataVersion]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp fuera de AppProvider');
  return ctx;
}

// Helper: vista destino de una alerta según su campo target del backend
// ("disks:nvme1n1" → Discos, "pools:tank" → Pools, "tasks" → Tareas, "settings" → Ajustes)
export function alertTargetView(target?: string): ViewId | null {
  if (!target) return null;
  const kind = target.split(':')[0] as ViewId;
  return VIEWS.includes(kind) ? kind : null;
}

// Helper: traduce errores de API a mensajes legibles
export function errorMessage(e: unknown, t: AppCtx['t']): string {
  if (e instanceof ApiError) {
    if (e.code === 'confirm_required') return e.message;
    if (e.status === 401) return t('login_error');
    if (e.status === 403) return t('no_permission');
    return e.message;
  }
  return (e as Error)?.message ?? String(e);
}
