// labels.ts — traducción de estados crudos de ZFS a texto humano i18n.
// Fuente única: cualquier estado que venga del backend (pool/vdev/smart).

const STATUS_KEY: Record<string, string> = {
  ONLINE: 'st_online',
  DEGRADED: 'st_degraded',
  FAULTED: 'st_faulted',
  OFFLINE: 'st_offline',
  UNAVAIL: 'st_unavail',
  REMOVED: 'st_removed',
  CANT_OPEN: 'st_cant_open',
};

// statusLabel — 'DEGRADED' → 'Degradado' (según idioma); desconocidos pasan tal cual.
export function statusLabel(s: string, t: (k: string) => string): string {
  const k = STATUS_KEY[s];
  return k ? t(k) : s;
}
