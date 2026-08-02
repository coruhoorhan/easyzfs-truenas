// updatecheck.ts — aviso proactivo de versión nueva. Sondea /api/version al
// cargar, al volver a la pestaña (visibilitychange) y cada 10 minutos; si la
// firma versión+build del servidor cambia respecto a la que cargó la app
// (se desplegó una versión nueva con la app abierta), la shell muestra un
// banner persistente para recargar. GET autenticada a nuestro propio
// servidor: no sale ningún dato de la instalación.
import { useEffect, useState } from 'react';
import { getProvider } from '../data';

const POLL_MS = 10 * 60 * 1000;

let initialSig: string | null = null;

// enabled = sesión real iniciada (nunca en demo: ahí la versión es mock).
export function useUpdateAvailable(enabled: boolean): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!enabled || available) return;
    const check = async () => {
      try {
        const v = await getProvider().getVersion();
        const sig = `${v.version}+${v.build}`;
        if (initialSig === null) initialSig = sig;
        else if (initialSig !== sig) setAvailable(true);
      } catch { /* sin red o sesión caducada: se reintenta en el próximo tick */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    void check();
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, available]);

  return available;
}
