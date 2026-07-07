"use client";

import { useCallback, useEffect, useState } from "react";

export interface UseApiGetResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Generic GET-and-refresh hook — the single implementation behind the
 * workspace data hooks (members, teams, invitations, access matrix, …).
 *
 * - `url: null` disables the fetch (data resets to null, loading false).
 * - `select` maps the parsed JSON body to the hook's data shape.
 * - `refresh()` re-fetches; while a refresh is in flight the previous
 *   data is kept (loading flips true) so lists don't flash empty.
 * - On failure `data` is left as-is and `error` is set — consumers
 *   decide whether stale data is acceptable to keep showing.
 */
export function useApiGet<T>(
  url: string | null,
  select: (body: unknown) => T
): UseApiGetResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(url !== null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // `select` is intentionally not a dependency — treat it like an
  // initializer (call sites pass inline lambdas that never change
  // behavior between renders).
  const selectRef = { current: select };
  selectRef.current = select;

  useEffect(() => {
    if (url === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url, { credentials: "same-origin" })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = (body as { error?: { message?: string } | string })?.error;
          const message =
            typeof err === "string" ? err : err?.message || "Request failed";
          throw new Error(message);
        }
        if (!cancelled) {
          setData(selectRef.current(body));
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Request failed");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, refresh };
}
