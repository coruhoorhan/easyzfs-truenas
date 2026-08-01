// Apariencia: tema claro/oscuro/sistema, color de acento y densidad.
// - Tema: 'light' | 'dark' | 'auto' (= sigue prefers-color-scheme del SO).
// - Acento: 4 colores con valores distintos para claro/oscuro; se aplican
//   como variables CSS (--accent, --accent-soft) en <html>.
// - Densidad: 'cozy' | 'compact' (compacta = html font-size 13.5px + zoom).
// Todo persiste en localStorage (claves zfc-theme / zfc-accent / zfc-density).
export type ThemeMode = 'auto' | 'light' | 'dark';
export type AccentId = 'cyan' | 'steel' | 'emerald' | 'amber';
export type Density = 'cozy' | 'compact';

const THEME_KEY = 'zfc-theme';
const ACCENT_KEY = 'zfc-accent';
const DENSITY_KEY = 'zfc-density';
const subs = new Set<() => void>();

// [color, soft] por tema. emerald = verde original de la app.
export const ACCENTS: Record<AccentId, { light: [string, string]; dark: [string, string] }> = {
  cyan:    { light: ['#0e7c93', '#dff0f4'], dark: ['#4cc3d9', '#13292f'] },
  steel:   { light: ['#3a6ea5', '#e2ebf4'], dark: ['#7ba7d9', '#1b2634'] },
  emerald: { light: ['#2f7d5f', '#e3f0e9'], dark: ['#5cb893', '#1d2f27'] },
  amber:   { light: ['#a8741f', '#f6ecd9'], dark: ['#d9a84e', '#33291a'] },
};

// ---- Tema ----
export function getThemeMode(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function effectiveTheme(mode: ThemeMode = getThemeMode()): 'light' | 'dark' {
  if (mode === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

export function applyTheme(): void {
  const eff = effectiveTheme();
  document.documentElement.dataset.theme = eff === 'dark' ? 'dark' : '';
  // theme-color dinámico según el tema efectivo
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', eff === 'dark' ? '#0e1210' : '#f6f6f3');
  applyAccent(); // el acento tiene valores distintos por tema
}

export function setThemeMode(mode: ThemeMode): void {
  if (mode === 'auto') localStorage.removeItem(THEME_KEY);
  else localStorage.setItem(THEME_KEY, mode);
  applyTheme();
  subs.forEach((f) => f());
}

// Botón del header: alterna claro/oscuro manualmente (override)
export function toggleTheme(): void {
  setThemeMode(effectiveTheme() === 'dark' ? 'light' : 'dark');
}

export function onThemeChange(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

// En modo sistema, re-aplica el tema cuando cambia prefers-color-scheme
export function startThemeWatcher(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getThemeMode() === 'auto') {
      applyTheme();
      subs.forEach((f) => f());
    }
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else mq.addListener(onChange); // Safari antiguo
}

// ---- Acento ----
export function getAccent(): AccentId {
  const v = localStorage.getItem(ACCENT_KEY) as AccentId | null;
  return v && ACCENTS[v] ? v : 'emerald';
}

export function applyAccent(): void {
  const [accent, soft] = ACCENTS[getAccent()][effectiveTheme()];
  const st = document.documentElement.style;
  st.setProperty('--accent', accent);
  st.setProperty('--accent-soft', soft);
  // --ok NO sigue al acento: es semántico (salud OK). Si ok=accent, con el
  // acento amber un estado sano y un aviso serían indistinguibles.
}

export function setAccent(id: AccentId): void {
  localStorage.setItem(ACCENT_KEY, id);
  applyAccent();
}

// ---- Densidad ----
export function getDensity(): Density {
  return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'cozy';
}

export function applyDensity(): void {
  const el = document.documentElement;
  if (getDensity() === 'compact') {
    el.dataset.density = 'compact';
    el.style.fontSize = '13.5px';
  } else {
    el.removeAttribute('data-density');
    el.style.fontSize = '';
  }
}

export function setDensity(d: Density): void {
  localStorage.setItem(DENSITY_KEY, d);
  applyDensity();
}
