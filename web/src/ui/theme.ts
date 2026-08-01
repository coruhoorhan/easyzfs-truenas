// Tema claro/oscuro: automático por hora (oscuro 20:00–08:00) + override manual.
// Persiste en localStorage ('zfc-theme': 'light' | 'dark' | null = auto).
export type ThemeMode = 'auto' | 'light' | 'dark';

const THEME_KEY = 'zfc-theme';
const subs = new Set<() => void>();

export function isAutoDark(date = new Date()): boolean {
  const h = date.getHours();
  return h >= 20 || h < 8;
}

export function getThemeMode(): ThemeMode {
  return (localStorage.getItem(THEME_KEY) as ThemeMode) || 'auto';
}

export function effectiveTheme(mode: ThemeMode = getThemeMode()): 'light' | 'dark' {
  if (mode === 'auto') return isAutoDark() ? 'dark' : 'light';
  return mode;
}

export function applyTheme(): void {
  const eff = effectiveTheme();
  document.documentElement.dataset.theme = eff === 'dark' ? 'dark' : '';
  // theme-color dinámico según el tema efectivo
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', eff === 'dark' ? '#0e1210' : '#f6f6f3');
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

// Re-evalúa el tema automático cada minuto por si cambia la hora
export function startThemeWatcher(): void {
  setInterval(() => {
    if (getThemeMode() === 'auto') applyTheme();
  }, 60_000);
}
