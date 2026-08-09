"use client";

import { useCallback, useEffect } from "react";
import {
  keepPreviousData,
  useQuery,
  type DefaultError,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { ApiRequestOpts } from "@/shared/api/api-envelope";

/**
 * The GET-hook contract, parameterized by transport — the one implementation
 * behind `@/shared/hooks/use-api-query` (web) and `#/hooks/use-api-query`
 * (desktop SPA).
 *
 * The two apps have different `apiRequest` transports under an IDENTICAL
 * contract, which is why the hook was forked byte-for-byte at the start of the
 * desktop migration. A fork is the wrong shape for that: the cache-key contract
 * `[path, workspaceId, query]` is what the whole request-dedup story rests on,
 * and a fix to one copy gave the other no signal to mirror it (2026-08-03 fleet
 * audit, duplication-quality). Passing the request function in costs one
 * argument and removes the drift entirely.
 */

export type ApiRequestFn = <T>(
  path: string,
  opts?: Pick<ApiRequestOpts, "workspaceId" | "query" | "signal">
) => Promise<T>;

export interface UseApiQueryOpts<T, S = T>
  extends Pick<ApiRequestOpts, "workspaceId" | "query"> {
  /** Map the raw response body to the hook's data shape. */
  select?: (body: T) => S;
  /** Pause the query (e.g. while the workspace id is unresolved). */
  enabled?: boolean;
  /** Override the provider default (ms). OMIT it to inherit
   *  `QUERY_DEFAULT_OPTIONS.staleTime` (30s) — passing `undefined` explicitly
   *  is the same as omitting it here, and `0` means "always revalidate", not
   *  "unset" (see `definedOnly` / F-163). */
  staleTime?: number;
  /** Refetch interval in ms for polling endpoints. */
  refetchInterval?: number;
  /** Keep the prior key's data visible while a new key's query loads
   *  (TanStack `placeholderData: keepPreviousData`) — avoids a blank
   *  flash when the query key changes for the same logical view. */
  keepPreviousData?: boolean;
}

/** The tuple this hook registers a query under — `@/shared/api/query-keys`
 *  builds the same one for the write side (`path` is nullable only here,
 *  where a disabled query still needs a key). */
type ApiQueryKeyTuple = readonly [
  path: string | null,
  workspaceId: string | undefined,
  query: ApiRequestOpts["query"],
];

/**
 * Drop every key whose value is `undefined`.
 *
 * THE ONLY REASON THIS EXISTS (F-163, 2026-08-07). TanStack resolves a query's
 * options by SPREAD — `{...defaultOptions.queries, ...options}` — so a key that
 * is PRESENT with the value `undefined` OVERRIDES the client default instead of
 * falling back to it. This hook forwarded `staleTime: opts.staleTime`
 * unconditionally, which silently deleted `QUERY_DEFAULT_OPTIONS.staleTime`
 * (30s, `@/shared/api/query-defaults`) for every caller that did not name one
 * — nearly all of them, on BOTH clients. Every such query was stale the instant
 * it landed, so `refetchOnMount` fired on every remount, `refetchOnWindowFocus`
 * on every focus, and freshly SEEDED cache entries were re-fetched anyway.
 *
 * Structural, not one `if`: the same trap applies to every option forwarded out
 * of `opts`, and the next option added would have inherited it silently.
 *
 * `0` IS NOT "UNSET". An explicit `staleTime: 0` (the consent inbox, the invite
 * link, the channel transcript) must still beat the 30s default — hence
 * `!== undefined` and never a truthiness test.
 */
function definedOnly<T extends object>(options: T): Partial<T> {
  const defined: Partial<T> = {};
  for (const key of Object.keys(options) as (keyof T)[]) {
    if (options[key] !== undefined) defined[key] = options[key];
  }
  return defined;
}

/** `path === null` disables the query; a caller's own `enabled` narrows it
 *  further. Shared by the options builder and the hook so the two can never
 *  disagree about whether a query is live. */
function resolveEnabled(path: string | null, opts: { enabled?: boolean }): boolean {
  return path !== null && (opts.enabled ?? true);
}

/**
 * The exact options `useApiQueryWith` hands TanStack. Exported so a test can
 * assert what a query is ACTUALLY resolved with
 * (`queryClient.defaultQueryOptions(...)`) rather than what the hook appears
 * to pass — the distinction F-163 lived in.
 */
export function buildApiQueryOptions<T, S = T>(
  request: ApiRequestFn,
  path: string | null,
  opts: UseApiQueryOpts<T, S> = {}
): UseQueryOptions<T, DefaultError, S, ApiQueryKeyTuple> {
  return {
    queryKey: [path, opts.workspaceId, opts.query] as const,
    queryFn: ({ signal }) =>
      request<T>(path as string, {
        workspaceId: opts.workspaceId,
        query: opts.query,
        signal,
      }),
    enabled: resolveEnabled(path, opts),
    // EVERY caller-supplied option goes through `definedOnly` — an option the
    // caller did not name must be ABSENT, not present-and-undefined, or it
    // deletes the client default (see above).
    ...definedOnly({
      select: opts.select,
      staleTime: opts.staleTime,
      refetchInterval: opts.refetchInterval,
      placeholderData: opts.keepPreviousData ? keepPreviousData : undefined,
    }),
  };
}

/**
 * The query key is `[path, workspaceId, query]` — pass the same args from any
 * component and they share one cache entry + one in-flight request. Invalidate
 * after mutations via `queryClient.invalidateQueries({ queryKey: [path] })`.
 */
export function useApiQueryWith<T, S = T>(
  request: ApiRequestFn,
  path: string | null,
  opts: UseApiQueryOpts<T, S> = {}
) {
  const enabled = resolveEnabled(path, opts);
  const query = useQuery(buildApiQueryOptions<T, S>(request, path, opts));

  // SELF-HEAL a stranded query (2026-08-03, root cause of the app-shell
  // stale-segment flake): when an observer's key switches inside the same
  // commit as a redirect navigation, TanStack v5 can leave the NEW query at
  // status "pending" with fetchStatus "idle" — created, enabled, and never
  // dispatched. In the app that is a navigation stuck on a loading screen
  // forever. An enabled+pending+idle query has exactly one legal next step
  // (fetch), so nudging it is always safe; the short delay lets the normal
  // dispatch win every ordinary mount.
  const stranded = enabled && query.isPending && query.fetchStatus === "idle";
  const strandedRefetch = query.refetch;
  useEffect(() => {
    if (!stranded) return;
    const timer = setTimeout(() => void strandedRefetch(), 50);
    return () => clearTimeout(timer);
  }, [stranded, strandedRefetch]);

  // TanStack v5 refetch() IGNORES `enabled` — on a null-path/disabled
  // query it would fire a real request at a garbage URL. Restore the
  // old hooks' contract: refetch on a disabled query is a no-op.
  const rawRefetch = query.refetch;
  const refetch = useCallback<typeof rawRefetch>(
    (...args) => (enabled ? rawRefetch(...args) : Promise.resolve(undefined as never)),
    [enabled, rawRefetch]
  );

  return { ...query, refetch };
}
