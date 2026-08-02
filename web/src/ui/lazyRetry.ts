// lazyRetry.ts — React.lazy tolerante a despliegues. Las vistas son chunks
// con hash (Vite); si se despliega una versión nueva con la app abierta, el
// index.html viejo en memoria referencia chunks que ya no existen en el
// servidor → el import() dinámico falla. Ante ese fallo, recargamos la página
// UNA vez por sesión (el index.html nuevo llega con no-cache). Si tras la
// recarga sigue fallando, el error sube al ErrorBoundary (nunca pantalla
// negra).
import { lazy } from 'react';
import type { ComponentType } from 'react';

const RELOAD_FLAG = 'easyzfs-chunk-reload';

export function lazyRetry<T extends ComponentType<Record<string, never>>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const m = await factory();
      // Import OK: resetea el flag para permitir un futuro reintento
      sessionStorage.removeItem(RELOAD_FLAG);
      return m;
    } catch (err) {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1');
        location.reload();
        // Nunca resuelve: la recarga sustituye el documento entero
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
