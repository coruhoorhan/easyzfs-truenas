// Controles básicos del sistema visual: Badge, Meter, Seg, Switch, Spinner
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fmtPct } from '../ui/format';
import { IconChev } from './icons';

export type Tone = 'ok' | 'warn' | 'err' | 'info';

// Select — desplegable propio (listbox). El <select> nativo pinta su popup con
// los colores del SO/navegador (LibreWolf RFP, Chrome/Linux), ignorando el tema
// de la app; este va con los tokens y se ve igual en todas partes.
export function Select<T extends string>({ options, value, onChange, ariaLabel }: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.v === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.v === value);
    const next = options[(i + dir + options.length) % options.length];
    onChange(next.v);
  };

  return (
    <div className="sel" ref={ref}>
      <button type="button" className="sel-btn" aria-label={ariaLabel}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); open ? move(1) : setOpen(true); }
          if (e.key === 'ArrowUp') { e.preventDefault(); open ? move(-1) : setOpen(true); }
        }}>
        <span>{current.label}</span>
        <span className={`sel-chev${open ? ' up' : ''}`}><IconChev /></span>
      </button>
      {open && (
        <div className="sel-pop" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <button key={o.v} type="button" role="option" aria-selected={o.v === value}
              className={`sel-opt${o.v === value ? ' on' : ''}`}
              onClick={() => { onChange(o.v); setOpen(false); }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

// InfoBubble — "?" con burbuja explicativa al pasar el ratón (tokens del tema).
export function InfoBubble({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <span className="infobubble" tabIndex={0} aria-label={title}>
      ?
      <span className="infobubble-pop" role="tooltip">
        {title && <b style={{ display: 'block', marginBottom: 6 }}>{title}</b>}
        {children}
      </span>
    </span>
  );
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
