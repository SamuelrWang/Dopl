import type { ApiRequestOpts } from "./api-envelope";

/**
 * THE cache-key factory for every `apiRequest`-backed query.
 *
 * `use-api-query-core.ts:54` builds `[path, workspaceId, query]` and nothing
 * else ever named that tuple, so a mutation that wanted to write into a read's
 * cache had to re-type the array by hand at the call site — which is why this
 * repo had zero `setQueryData` and ~86 await-then-refetch write sites instead.
 * A hand-typed key that drifts by one character is a silent no-op: the write
 * lands in a cache entry no observer is subscribed to, the screen does not
 * change, and nothing fails. Hence one factory, imported by both sides.
 *
 * TWO SHAPES, and the difference is load-bearing:
 *
 *  - `entry(opts)` is the EXACT tuple one read built. Use it to assert against
 *    a specific cache entry (tests, `getQueryData`).
 *  - `all` is the one-element PREFIX `[path]`. TanStack matches keys by array
 *    prefix, so this reaches every workspace / query-param variant of the same
 *    resource in one call. Optimistic writes and invalidations use it, because
 *    the writer usually does NOT know which variants a reader mounted (the
 *    channel list, for instance, is cached twice — with and without
 *    `?include=archived` — and a tool-profile toggle must patch both).
 *
 * Framework-free on purpose (no React, no Next): the desktop SPA imports this
 * verbatim, exactly as it imports `query-defaults.ts`.
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

/**
 * Wrap a path in its key factories. Features build the path (they own their
 * URL vocabulary) and get the two key shapes back, so no feature ever writes
 * an array literal that has to match `use-api-query-core` by eye.
 */
export function apiResource(path: string): ApiResourceKeys {
  return {
    path,
    all: apiPathKey(path),
    entry: (opts: ApiQueryKeyOpts = {}) => apiQueryKey(path, opts),
  };
}
