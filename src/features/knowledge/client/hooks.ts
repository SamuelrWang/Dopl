"use client";

/**
 * Custom hooks for client-side data fetching against the knowledge API.
 *
 * Pattern: `useEffect` → `fetch` → `useState` with a `cancelled` flag —
 * matches the existing `useWorkspaces` convention in
 * the app-shell rail. Each hook returns a
 * `refetch()` callback so callers can revalidate after mutations.
 *
 * Status enum: `idle | loading | success | error`. Components check
 * `data` for content vs `error` for failure messaging.
 *
 * NOTE: Item 5 may swap these for React Query / SWR. Logged in
 * [docs/ENGINEERING.md](docs/ENGINEERING.md) under "Known debt".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";
import {
  KnowledgeApiError,
  fetchBases,
  fetchEntry,
  fetchTree,
} from "./api";

export type FetchStatus = "idle" | "loading" | "success" | "error";

interface Result<T> {
  data: T | null;
  error: KnowledgeApiError | null;
  status: FetchStatus;
  refetch: () => void;
}

/**
 * Optional SSR seed. When the parent has already loaded the data on the
 * server (e.g. a Next.js server component fetched the first entry), it
 * can pass it in to skip the initial client-side fetch — the hook seeds
 * `data` and consumes the seed once. Subsequent key changes (or
 * explicit `refetch()`) hit the network normally.
 */
interface UseFetchOptions<T> {
  initialData?: T;
  initialKey?: string;
}

function toApiError(err: unknown): KnowledgeApiError {
  if (err instanceof KnowledgeApiError) return err;
  return new KnowledgeApiError(
    500,
    "INTERNAL_ERROR",
    err instanceof Error ? err.message : "Unknown error"
  );
}

/**
 * Last successful result per cache key. Survives unmount/remount so
 * route navigations within the knowledge area re-render instantly with
 * the previous data while a background refetch revalidates
 * (stale-while-revalidate). Keys already namespace by workspace/base,
 * so nothing leaks across contexts.
 */
const memoryCache = new Map<string, unknown>();

/**
 * Generic loader hook. Reuses the cancellation + state pattern across
 * every hook below.
 *
 * - `key`: cache key. When falsy, the hook sits idle and never fires.
 * - `loader`: closure called when key/tick changes.
 * - `options.initialData` + `options.initialKey`: optional SSR seed —
 *   if both are provided AND `key === initialKey` on first effect run,
 *   the seed is consumed and the initial fetch is skipped. Subsequent
 *   key changes or explicit `refetch()` calls fetch normally.
 *
 * Status is *derived* from `data`/`error` to avoid the React 19
 * `setState-in-effect` lint that fires on a synchronous status
 * transition at effect start. During a refetch (same key, bumped
 * tick), `data` keeps its previous value until new data arrives — a
 * feature (no flicker). On a **key change** (e.g. workspace switch),
 * `data` is cleared so the previous context's content doesn't leak
 * into the new one — see the `lastKeyRef` block below.
 */
function useFetch<T>(
  key: string | null | undefined,
  loader: () => Promise<T>,
  options?: UseFetchOptions<T>
): Result<T> {
  // Capture the seed once at mount. Refs survive React 19 StrictMode's
  // double-invoke of effects, so the consume-flag below works correctly
  // in dev too.
  const initialDataRef = useRef(options?.initialData);
  const initialKeyRef = useRef(options?.initialKey);
  const seedConsumedRef = useRef(false);

  const [data, setData] = useState<T | null>(() => {
    if (
      initialDataRef.current !== undefined &&
      initialKeyRef.current === key
    ) {
      return initialDataRef.current;
    }
    // Warm-start from the last successful fetch for this key (route
    // remounts) — the effect below still revalidates in the background.
    if (key && memoryCache.has(key)) return memoryCache.get(key) as T;
    return null;
  });
  const [error, setError] = useState<KnowledgeApiError | null>(null);
  // Bump to force a refetch.
  const [tick, setTick] = useState(0);

  // Reset cached `data` + `error` when the cache key changes. The
  // previous values belong to a different logical context (e.g. a
  // different workspace) and would otherwise leak across the boundary —
  // the user would see another workspace's KBs / entries until the new
  // fetch resolved. Tick-driven refetches (same key) intentionally do
  // NOT trigger this reset; they keep the no-flicker behavior.
  // Pattern: React's documented "derive state from props" — set state
  // during render, conditional on a ref-tracked previous value.
  const lastKeyRef = useRef(key);
  if (lastKeyRef.current !== key) {
    lastKeyRef.current = key;
    setData(key && memoryCache.has(key) ? (memoryCache.get(key) as T) : null);
    setError(null);
  }
  // Hold the latest loader in a ref so the in-flight effect always
  // sees the freshest closure (caller param changes apply to refetch).
  // Updated via an effect to satisfy react-hooks/refs.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    if (!key) return;
    // First effect run after mount with an SSR seed for THIS key —
    // skip the network round-trip; `data` was already seeded above.
    if (
      !seedConsumedRef.current &&
      initialDataRef.current !== undefined &&
      initialKeyRef.current === key
    ) {
      seedConsumedRef.current = true;
      memoryCache.set(key, initialDataRef.current);
      return;
    }
    let cancelled = false;
    loaderRef
      .current()
      .then((next) => {
        if (cancelled) return;
        memoryCache.set(key, next);
        setError(null);
        setData(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(toApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const status: FetchStatus = !key
    ? "idle"
    : error
      ? "error"
      : data !== null
        ? "success"
        : "loading";
  return { data, error, status, refetch };
}

// ─── Hooks ──────────────────────────────────────────────────────────

export function useKnowledgeBases(workspaceId?: string): Result<KnowledgeBase[]> {
  // Use the workspace id as the cache key so switching workspaces
  // re-fetches. Fall back to a sentinel so the hook still fires when
  // no id is provided (uses the user's default workspace).
  return useFetch<KnowledgeBase[]>(workspaceId ?? "default", () =>
    fetchBases(workspaceId)
  );
}

export function useKnowledgeTree(
  baseId: string | null | undefined,
  workspaceId?: string
): Result<{
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}> {
  return useFetch(
    baseId ? `${workspaceId ?? "default"}:${baseId}` : null,
    () => fetchTree(baseId as string, workspaceId)
  );
}

export function useKnowledgeEntry(
  entryId: string | null | undefined,
  workspaceId?: string,
  options?: { initialData?: KnowledgeEntry; initialEntryId?: string }
): Result<KnowledgeEntry> {
  const key = entryId ? `${workspaceId ?? "default"}:${entryId}` : null;
  const initialKey =
    options?.initialEntryId !== undefined
      ? `${workspaceId ?? "default"}:${options.initialEntryId}`
      : undefined;
  return useFetch(
    key,
    () => fetchEntry(entryId as string, workspaceId),
    { initialData: options?.initialData, initialKey }
  );
}
