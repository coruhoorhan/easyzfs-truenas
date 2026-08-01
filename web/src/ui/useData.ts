// Hook de carga de datos: re-ejecuta al cambiar dataVersion (refresh global)
// y permite recargas manuales. Las vistas además se suscriben a eventos.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getProvider } from '../data';
import type { DataProvider } from '../data/provider';
import { useApp } from './store';

export function useData<T>(fn: (p: DataProvider) => Promise<T>, deps: unknown[] = []): {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: React.Dispatch<React.SetStateAction<T | null>>;
} {
  const { dataVersion } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    fn(getProvider())
      .then((d) => { if (seq.current === my) { setData(d); setError(null); setLoading(false); } })
      .catch((e) => { if (seq.current === my) { setError(e); setLoading(false); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { reload(); }, [reload, dataVersion]);

  return { data, error, loading, reload, setData };
}
