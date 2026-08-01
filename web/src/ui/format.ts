// Formato numérico es-ES (coma decimal) y unidades IEC (GiB/TiB).
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

const KiB = 1024, MiB = KiB ** 2, GiB = KiB ** 3, TiB = KiB ** 4;

// Bytes → "4,9 TiB" / "180 GiB" / "128 MiB"
export function fmtBytes(b: number): string {
  if (!b) return '0 B';
  const abs = Math.abs(b);
  if (abs >= TiB) return `${nf2.format(b / TiB)} TiB`;
  if (abs >= GiB) return `${abs / GiB >= 100 ? nf0.format(b / GiB) : nf1.format(b / GiB)} GiB`;
  if (abs >= MiB) return `${nf0.format(b / MiB)} MiB`;
  if (abs >= KiB) return `${nf0.format(b / KiB)} KiB`;
  return `${b} B`;
}

// "5,2 de 8,1 TiB" (misma unidad para ambos valores)
export function fmtBytesPair(used: number, total: number): string {
  // Grandes volúmenes con 1 decimal ("4,9 de 7,2 TiB"), pequeños con 2 ("0,31 de 0,93 TiB")
  if (total >= 2 * TiB) return `${nf1.format(used / TiB)} de ${nf1.format(total / TiB)} TiB`;
  if (total >= TiB / 2) return `${nf2.format(used / TiB)} de ${nf2.format(total / TiB)} TiB`;
  if (total >= GiB) return `${nf0.format(used / GiB)} de ${nf0.format(total / GiB)} GiB`;
  return `${fmtBytes(used)} de ${fmtBytes(total)}`;
}

export function fmtPct(p: number): string {
  return `${nf0.format(p)}%`;
}

export function fmtInt(n: number): string {
  return nf0.format(n);
}

// "1,42x" para ratios de compresión
export function fmtRatio(r: number): string {
  return `${nf2.format(r)}x`;
}

// Tiempo relativo en español: "hace 6 días", "hoy 06:00", "mañana 06:00"
export function timeAgo(ts: string, t?: (k: string) => string): string {
  const tt = t ?? ((k: string) => k);
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diffMs >= 0 && diffMs < 60_000) return tt('now');
  if (diffMs >= 0 && diffMs < 3600_000) return `${tt('ago_prefix')} ${Math.floor(diffMs / 60_000)} min`;
  if (sameDay(d, now)) return diffMs >= 0 ? `${tt('today')} ${hm}` : `${tt('today')} ${hm}`;
  const tomorrow = new Date(now.getTime() + 86400_000);
  if (sameDay(d, tomorrow)) return `${tt('tomorrow')} ${hm}`;
  const yesterday = new Date(now.getTime() - 86400_000);
  if (sameDay(d, yesterday)) return `${tt('yesterday')} ${hm}`;
  const days = Math.floor(Math.abs(diffMs) / 86400_000);
  if (diffMs > 0 && days < 30) return `${tt('ago_prefix')} ${days} ${days === 1 ? tt('day') : tt('days')}`;
  if (diffMs < 0 && days < 30) return `${tt('in_prefix')} ${days} ${days === 1 ? tt('day') : tt('days')}`;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

// Fecha corta: "1 ago 06:00"
export function fmtDateTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date} ${hm}`;
}

// Segundos → "17 días 4 h" / "12 min"
export function fmtDuration(sec: number): string {
  if (sec <= 0) return '0 min';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} ${d === 1 ? 'día' : 'días'}${h > 0 ? ` ${h} h` : ''}`;
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
