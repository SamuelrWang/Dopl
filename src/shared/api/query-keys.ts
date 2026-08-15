import type { ApiRequestOpts } from "./api-envelope";

/**
 * THE cache-key factory for every `apiRequest`-backed query. ⚠ Never hand-type
 * the tuple at a call site: a key that drifts by one character is a SILENT
 * no-op — the write lands in an entry no observer is subscribed to, the screen
 * does not change, and nothing fails.
 *
 * ⚠ Two shapes, and the difference is load-bearing:
 *  - `entry(opts)` — the EXACT tuple one read built (tests, `getQueryData`).
 *  - `all` — the one-element PREFIX `[path]`. TanStack matches by array prefix,
 *    so this reaches every workspace / query-param variant in one call.
 *    Optimistic writes and invalidations use it because the writer usually does
 *    NOT know which variants a reader mounted (the channel list is cached twice,
 *    with and without `?include=archived`).
 *
 * ⚠ Framework-free (no React, no Next) — the desktop SPA imports this verbatim.
 */

/** The `query` half of the tuple — `apiRequest`'s own param shape. */
export type ApiQueryParams = ApiRequestOpts["query"];

/** The tuple `useApiQuery` registers a query under. */
export type ApiQueryKey = readonly [
  path: string,
  workspaceId: string | undefined,
  query: ApiQueryParams,
];

/** Every cache entry for a path, whatever workspace / params it was read with. */
export type ApiPathKey = readonly [path: string];

export interface ApiQueryKeyOpts {
  workspaceId?: string;
  query?: ApiQueryParams;
}

/** The exact key for one read. Must stay identical to `useApiQueryWith`. */
export function apiQueryKey(
  path: string,
  opts: ApiQueryKeyOpts = {}
): ApiQueryKey {
  return [path, opts.workspaceId, opts.query] as const;
}

/** The prefix key covering every variant of one path. */
export function apiPathKey(path: string): ApiPathKey {
  return [path] as const;
}

/** One resource's keys, built from its already-resolved URL. */
export interface ApiResourceKeys {
  /** The URL the read hits. */
  readonly path: string;
  /** Prefix key — every workspace / query variant of this path. */
  readonly all: ApiPathKey;
  /** The exact key one read registered. */
  entry(opts?: ApiQueryKeyOpts): ApiQueryKey;
}

/** Wrap a path in its key factories: features own their URL vocabulary and get
 *  both key shapes back, so no feature writes an array literal that must match
 *  `use-api-query-core` by eye. */
export function apiResource(path: string): ApiResourceKeys {
  return {
    path,
    all: apiPathKey(path),
    entry: (opts: ApiQueryKeyOpts = {}) => apiQueryKey(path, opts),
  };
}
