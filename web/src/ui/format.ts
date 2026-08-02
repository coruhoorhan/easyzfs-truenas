// Formato numérico/fechas según el idioma activo (es-ES/en-US vía getCurrentLang)
// y unidades IEC (GiB/TiB). Los textos relativos usan el diccionario i18n.
import { getCurrentLang, t as translate } from './i18n';

// Locale Intl derivado del idioma de la UI (no hardcodeado)
function locale(): string {
  return getCurrentLang() === 'en' ? 'en-US' : 'es-ES';
}

// Formatters cacheados por idioma+decimales (se recrean al cambiar de idioma)
const nfCache = new Map<string, Intl.NumberFormat>();
function nf(maxFrac: number): Intl.NumberFormat {
  const key = `${locale()}:${maxFrac}`;
  let f = nfCache.get(key);
  if (!f) { f = new Intl.NumberFormat(locale(), { maximumFractionDigits: maxFrac }); nfCache.set(key, f); }
  return f;
}

const KiB = 1024, MiB = KiB ** 2, GiB = KiB ** 3, TiB = KiB ** 4;

// Bytes → "4,9 TiB" / "180 GiB" / "128 MiB"
export function fmtBytes(b: number): string {
  if (!b) return '0 B';
  const abs = Math.abs(b);
  if (abs >= TiB) return `${nf(2).format(b / TiB)} TiB`;
  if (abs >= GiB) return `${abs / GiB >= 100 ? nf(0).format(b / GiB) : nf(1).format(b / GiB)} GiB`;
  if (abs >= MiB) return `${nf(0).format(b / MiB)} MiB`;
  if (abs >= KiB) return `${nf(0).format(b / KiB)} KiB`;
  return `${b} B`;
}

// Par usado/total con la misma unidad: { used: '4,9', total: '7,2 TiB' }.
// Quien lo muestra compone con la clave i18n ('de'/'of'): nada de split(' de ').
export function fmtBytesPair(used: number, total: number): { used: string; total: string } {
  // Grandes volúmenes con 1 decimal, pequeños con 2 ("0,31" de "0,93 TiB")
  if (total >= 2 * TiB) return { used: nf(1).format(used / TiB), total: `${nf(1).format(total / TiB)} TiB` };
  if (total >= TiB / 2) return { used: nf(2).format(used / TiB), total: `${nf(2).format(total / TiB)} TiB` };
  if (total >= GiB) return { used: nf(0).format(used / GiB), total: `${nf(0).format(total / GiB)} GiB` };
  return { used: fmtBytes(used), total: fmtBytes(total) };
}

export function fmtPct(p: number): string {
  return `${nf(0).format(p)}%`;
}

export function fmtInt(n: number): string {
  return nf(0).format(n);
}

// "1,42x" para ratios de compresión
export function fmtRatio(r: number): string {
  return `${nf(2).format(r)}x`;
}

type TFunc = (k: string, vars?: Record<string, string | number>) => string;

// Tiempo relativo según idioma: "hace 6 días"/"6 days ago", "hoy 06:00", "mañana 06:00".
// Las plantillas (ago_tpl/in_tpl) llevan el orden de palabras de cada idioma.
export function timeAgo(ts: string, t?: TFunc): string {
  const tt: TFunc = t ?? (translate as TFunc);
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diffMs >= 0 && diffMs < 60_000) return tt('now');
  if (diffMs >= 0 && diffMs < 3600_000) return tt('ago_tpl', { x: `${Math.floor(diffMs / 60_000)} min` });
  if (sameDay(d, now)) return `${tt('today')} ${hm}`;
  const tomorrow = new Date(now.getTime() + 86400_000);
  if (sameDay(d, tomorrow)) return `${tt('tomorrow')} ${hm}`;
  const yesterday = new Date(now.getTime() - 86400_000);
  if (sameDay(d, yesterday)) return `${tt('yesterday')} ${hm}`;
  const days = Math.floor(Math.abs(diffMs) / 86400_000);
  if (diffMs > 0 && days < 30) return tt('ago_tpl', { x: `${days} ${days === 1 ? tt('day') : tt('days')}` });
  if (diffMs < 0 && days < 30) return tt('in_tpl', { x: `${days} ${days === 1 ? tt('day') : tt('days')}` });
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

// Fecha corta: "1 ago 06:00" / "Aug 1 06:00" (según idioma)
export function fmtDateTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date} ${hm}`;
}

// Segundos → "17 días 4 h" / "17 days 4 h" / "12 min"
export function fmtDuration(sec: number): string {
  if (sec <= 0) return '0 min';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} ${translate(d === 1 ? 'fmt_day' : 'fmt_days')}${h > 0 ? ` ${h} h` : ''}`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

// Parsea tamaños tipo "500G", "1T", "2048M" a bytes (para cuotas/zvols)
export function parseSize(s: string): number {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([KMGT]?I?B?)?\s*$/i.exec(s);
  if (!m) return 0;
  const val = parseFloat(m[1].replace(',', '.'));
  const unit = (m[2] ?? '').toUpperCase().replace('IB', '').replace('B', '');
  const mult: Record<string, number> = { '': 1, K: KiB, M: MiB, G: GiB, T: TiB };
  return Math.round(val * (mult[unit] ?? 0));
}
