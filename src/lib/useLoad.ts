import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

/** Load data on mount / when deps change; `reload()` re-runs it. Ignores stale responses. */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const run = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);

  const reload = useCallback(async () => {
    const id = ++run.current;
    setLoading(true);
    try {
      const v = await load();
      if (id === run.current) { setData(v); setError(null); }
    } catch (e) {
      if (id === run.current) setError(e);
    } finally {
      if (id === run.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => { void reload(); }, [reload]);

  return { data, error, loading, reload };
}
