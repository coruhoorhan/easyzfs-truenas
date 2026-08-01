// Controles básicos del sistema visual: Badge, Meter, Seg, Switch, Spinner
import type { ReactNode } from 'react';
import { fmtPct } from '../ui/format';

export type Tone = 'ok' | 'warn' | 'err' | 'info';

export function Badge({ tone, children, dot = true, style }: {
  tone: Tone; children: ReactNode; dot?: boolean; style?: React.CSSProperties;
}) {
  return (
    <span className={`badge ${tone}`} style={style}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

// Barra de capacidad con umbrales aviso/crítico (80/90 por defecto)
export function Meter({ pct, warnAt = 80, critAt = 90 }: { pct: number; warnAt?: number; critAt?: number }) {
  const cls = pct >= critAt ? 'crit' : pct >= warnAt ? 'warn' : '';
  return (
    <div className={`meter ${cls}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

// Grupo segmentado (topologías, frecuencias…)
export function Seg<T extends string>({ options, value, onChange, ariaLabel }: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.v} type="button" className={o.v === value ? 'on' : ''}
          aria-pressed={o.v === value} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Interruptor on/off accesible
export function Switch({ checked, onChange, ariaLabel, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; ariaLabel: string; disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled}
        aria-label={ariaLabel} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
    </label>
  );
}

export function Spinner({ label }: { label: string }) {
  return <div className="empty" role="status">{label}</div>;
}

// Pie de tarjeta KPI con valor opcional de porcentaje
export function KpiCard({ label, value, small, foot, meter }: {
  label: string; value: ReactNode; small?: string; foot?: ReactNode; meter?: number;
}) {
  return (
    <div className="card kpi">
      <div className="lbl">{label}</div>
      <div className="val">{value}{small ? <> <small>{small}</small></> : null}</div>
      {meter !== undefined && <Meter pct={meter} />}
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

export function pctLabel(used: number, total: number): string {
  return fmtPct(total > 0 ? (used / total) * 100 : 0);
}
