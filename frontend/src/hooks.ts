import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

// Loads data and re-loads it every few seconds, so officers see changes without refreshing.
// (Polling keeps the architecture simple; see README "known limitations".)
export function usePolling<T>(path: string, intervalMs = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(''); // the previous answer, so an identical one does not re-render the page

  const load = useCallback(async () => {
    try {
      const body = await api<T>(path);
      const text = JSON.stringify(body);
      if (text !== last.current) {
        last.current = text;
        setData(body);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);

  useEffect(() => {
    last.current = '';
    load();
    const t = setInterval(load, intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);

  return { data, error, reload: load };
}
