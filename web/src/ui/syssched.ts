// syssched.ts — conversión entre el preset "fácil" del editor de tareas del
// sistema (frecuencia + hora) y la sintaxis nativa de cada origen: cron de
// 5 campos u OnCalendar de systemd. Funciones PURAS (sin efectos laterales)
// para que sean testeables fuera de la UI.

export type SysFreq = 'hourly' | 'daily' | 'weekly' | 'monthly';
export type SysWd = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type SysSource = 'cron' | 'systemd';

// Estado del editor (misma forma que SchedState de Modals.tsx).
export interface SysSchedState {
  freq: SysFreq;
  minute: string;   // hourly: minuto dentro de la hora ('00'-'59')
  time: string;     // resto: 'HH:MM'
  weekday: SysWd;   // weekly
  monthday: number; // monthly (1-28)
}

export const SYS_WEEKDAYS: readonly SysWd[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const SYS_SCHED_DEFAULT: SysSchedState = {
  freq: 'daily', minute: '15', time: '06:00', weekday: 'sun', monthday: 1,
};

const DOW_CRON: Record<SysWd, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DOW_CAL: Record<SysWd, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const CAL_DOW: Record<string, SysWd> = { mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat', sun: 'sun' };

const pad2 = (n: number) => String(n).padStart(2, '0');
const isNum = (x: string) => /^\d+$/.test(x);

function parseHM(time: string): [number, number] {
  const [h, m] = time.split(':').map((x) => parseInt(x, 10));
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
}

const clampMinute = (s: string) => Math.min(59, Math.max(0, parseInt(s, 10) || 0));

// buildCron — preset → cron de 5 campos ('15 * * * *', '0 6 * * *',
// '0 3 * * 0', '0 2 1 * *').
export function buildCron(s: SysSchedState): string {
  const [h, m] = parseHM(s.time);
  switch (s.freq) {
    case 'hourly': return `${clampMinute(s.minute)} * * * *`;
    case 'daily': return `${m} ${h} * * *`;
    case 'weekly': return `${m} ${h} * * ${DOW_CRON[s.weekday]}`;
    case 'monthly': return `${m} ${h} ${s.monthday} * *`;
  }
}

// buildOnCalendar — preset → OnCalendar de systemd ('*-*-* *:15:00',
// '*-*-* 06:00:00', 'Sun *-*-* 03:00:00', '*-*-01 02:00:00').
export function buildOnCalendar(s: SysSchedState): string {
  const [h, m] = parseHM(s.time);
  const hm = `${pad2(h)}:${pad2(m)}:00`;
  switch (s.freq) {
    case 'hourly': return `*-*-* *:${pad2(clampMinute(s.minute))}:00`;
    case 'daily': return `*-*-* ${hm}`;
    case 'weekly': return `${DOW_CAL[s.weekday]} *-*-* ${hm}`;
    case 'monthly': return `*-*-${pad2(s.monthday)} ${hm}`;
  }
}

// buildSysSchedule — preset → sintaxis del origen de la tarea.
export function buildSysSchedule(s: SysSchedState, source: SysSource): string {
  return source === 'cron' ? buildCron(s) : buildOnCalendar(s);
}

// parseCron — cron (@atajo o 5 campos con valores simples) → preset.
// null si no encaja (rangos, listas, pasos, nombres de mes/día…): esos casos
// se muestran en modo avanzado con el valor original.
export function parseCron(raw: string): SysSchedState | null {
  const sc = raw.trim();
  if (sc.startsWith('@')) {
    switch (sc) {
      case '@hourly': return { ...SYS_SCHED_DEFAULT, freq: 'hourly', minute: '00' };
      case '@daily':
      case '@midnight': return { ...SYS_SCHED_DEFAULT, freq: 'daily', time: '00:00' };
      case '@weekly': return { ...SYS_SCHED_DEFAULT, freq: 'weekly', weekday: 'sun', time: '00:00' };
      case '@monthly': return { ...SYS_SCHED_DEFAULT, freq: 'monthly', monthday: 1, time: '00:00' };
      default: return null; // @yearly/@annually/@reboot no tienen preset
    }
  }
  const f = sc.split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = f;
  if (mon !== '*') return null;
  const okHM = isNum(hour) && +hour <= 23 && isNum(min) && +min <= 59;
  const hm = `${pad2(+hour)}:${pad2(+min)}`;
  if (dom === '*' && dow === '*') {
    if (hour === '*' && isNum(min) && +min <= 59) {
      return { ...SYS_SCHED_DEFAULT, freq: 'hourly', minute: pad2(+min) };
    }
    if (okHM) return { ...SYS_SCHED_DEFAULT, freq: 'daily', time: hm };
    return null;
  }
  if (dom === '*' && okHM && isNum(dow)) {
    const d = +dow % 7; // cron: 0 y 7 = domingo
    const wd = (Object.keys(DOW_CRON) as SysWd[]).find((k) => DOW_CRON[k] === d);
    return wd ? { ...SYS_SCHED_DEFAULT, freq: 'weekly', weekday: wd, time: hm } : null;
  }
  if (dow === '*' && okHM && isNum(dom) && +dom >= 1 && +dom <= 28) {
    return { ...SYS_SCHED_DEFAULT, freq: 'monthly', monthday: +dom, time: hm };
  }
  return null;
}

// parseOnCalendar — OnCalendar simple de systemd → preset; null si no encaja.
export function parseOnCalendar(raw: string): SysSchedState | null {
  const sc = raw.trim();
  switch (sc.toLowerCase()) {
    case 'hourly': return { ...SYS_SCHED_DEFAULT, freq: 'hourly', minute: '00' };
    case 'daily': return { ...SYS_SCHED_DEFAULT, freq: 'daily', time: '00:00' };
    case 'weekly': return { ...SYS_SCHED_DEFAULT, freq: 'weekly', weekday: 'mon', time: '00:00' }; // systemd: Mon 00:00
    case 'monthly': return { ...SYS_SCHED_DEFAULT, freq: 'monthly', monthday: 1, time: '00:00' };
  }
  // hourly: '*-*-* *:MM[:SS]'
  const hor = /^\*-\*-\*\s+\*:(\d{1,2})(?::\d{1,2})?$/.exec(sc);
  if (hor && +hor[1] <= 59) {
    return { ...SYS_SCHED_DEFAULT, freq: 'hourly', minute: pad2(+hor[1]) };
  }
  // [Dow] AAAA-MM-DD HH:MM[:SS] solo con comodines/números simples.
  const m = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?(\*)-(\*)-(\*|\d{1,2})\s+(\d{1,2}):(\d{2})(?::\d{1,2})?$/i.exec(sc);
  if (!m) return null;
  const [, dowRaw, , , dom, hh, mm] = m;
  const h = +hh, min = +mm;
  if (h > 23 || min > 59) return null;
  const time = `${pad2(h)}:${pad2(min)}`;
  const wd = dowRaw ? CAL_DOW[dowRaw.toLowerCase()] : undefined;
  if (dom === '*') {
    if (wd) return { ...SYS_SCHED_DEFAULT, freq: 'weekly', weekday: wd, time };
    return { ...SYS_SCHED_DEFAULT, freq: 'daily', time };
  }
  if (!wd && +dom >= 1 && +dom <= 28) {
    return { ...SYS_SCHED_DEFAULT, freq: 'monthly', monthday: +dom, time };
  }
  return null;
}

// parseSysSchedule — schedule actual de una tarea del sistema → preset
// según su origen; null si no es un caso simple (modo avanzado).
export function parseSysSchedule(raw: string, source: SysSource): SysSchedState | null {
  return source === 'cron' ? parseCron(raw) : parseOnCalendar(raw);
}
