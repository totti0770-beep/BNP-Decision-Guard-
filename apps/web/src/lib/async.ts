'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncResult<T> {
  data: T | null;
  error: string | null;
  /** True only on the first load, so refreshes don't blank the screen. */
  loading: boolean;
  /** True while a refetch runs over already-rendered data. */
  refreshing: boolean;
  reload: () => void;
}

/**
 * Standard load → render lifecycle for the data screens.
 *
 * Every screen previously did `api(...).then(setState)` with no error branch
 * and no loading branch, so a failed request rendered an empty table with no
 * explanation. Centralising it means each screen gets all three states for
 * free and they behave identically.
 *
 * Two correctness details:
 * - **Stale responses are dropped.** Filters change per keystroke, so requests
 *   overlap; without the sequence guard a slow early response can land after a
 *   fast later one and show results for a filter the user has moved on from.
 * - **Refreshes keep the previous data on screen** (`refreshing`, not
 *   `loading`), so re-filtering doesn't flash a skeleton over a populated list.
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
): AsyncResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [nonce, setNonce] = useState(0);

  const seq = useRef(0);
  const hasData = useRef(false);

  // The fetcher is re-created on every render by callers; deps are the real
  // trigger, so we intentionally key the effect on them rather than on fn.
  const fn = useRef(fetcher);
  fn.current = fetcher;

  useEffect(() => {
    const mine = ++seq.current;
    setPending(true);
    fn.current()
      .then((res) => {
        if (mine !== seq.current) return;
        setData(res);
        setError(null);
        hasData.current = true;
      })
      .catch((e: unknown) => {
        if (mine !== seq.current) return;
        setError(e instanceof Error ? e.message : 'Request failed');
      })
      .finally(() => {
        if (mine === seq.current) setPending(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    data,
    error,
    loading: pending && !hasData.current,
    refreshing: pending && hasData.current,
    reload,
  };
}

/**
 * Debounces a rapidly-changing value (search boxes). Without this, every
 * keystroke in the audit and policy filters fired its own request.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
