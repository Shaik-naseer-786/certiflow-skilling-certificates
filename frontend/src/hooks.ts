import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

// Loads data and re-loads it every few seconds, so officers see changes without refreshing.
// (Polling keeps the architecture simple; see README "known limitations".)
export function usePolling<T>(path: string, intervalMs = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);

  useEffect(() => {
    load();
    const t = setInterval(load, intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);

  return { data, error, reload: load };
}
