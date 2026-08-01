// Bus de eventos en tiempo real.
// En modo HTTP: EventSource a /api/events (SSE).
// En modo mock: el propio MockProvider emite eventos sintéticos por aquí.
import type { AppEvent } from './types';

type Listener = (ev: AppEvent) => void;

const listeners = new Set<Listener>();
let es: EventSource | null = null;

export function subscribeEvents(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitEvent(ev: AppEvent): void {
  listeners.forEach((fn) => {
    try { fn(ev); } catch { /* listener defectuoso no rompe el bus */ }
  });
}

// Conecta al stream SSE real. Devuelve función de desconexión.
export function connectSSE(): () => void {
  disconnectSSE();
  try {
    es = new EventSource('/api/events');
    const types: AppEvent['type'][] = [
      'pool.status', 'scrub.progress', 'disk.temp', 'alert.new', 'job.finished', 'overview',
    ];
    for (const t of types) {
      es.addEventListener(t, (m) => {
        try {
          const data = JSON.parse((m as MessageEvent).data) as Record<string, unknown>;
          emitEvent({ type: t, ...data } as AppEvent);
        } catch { /* payload inválido: ignorar */ }
      });
    }
  } catch {
    es = null;
  }
  return disconnectSSE;
}

export function disconnectSSE(): void {
  if (es) { es.close(); es = null; }
}
