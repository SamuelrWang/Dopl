"use client";

/**
 * Custom hooks for client-side data fetching against the knowledge API.
 *
 * Pattern: `useEffect` → `fetch` → `useState` with a `cancelled` flag —
 * matches the existing `useWorkspaces` convention in
 * [sidebar.tsx](src/shared/layout/sidebar.tsx). Each hook returns a
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
  fetchTrash,
  fetchTree,
} from "./api";

export type FetchStatus = "idle" | "loading" | "success" | "error";

interface Result<T> {
  data: T | null;
  error: KnowledgeApiError | null;
  status: FetchStatus;
  refetch: () => void;
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
 * Generic loader hook. Reuses the cancellation + state pattern across
 * every hook below.
 *
 * - `key`: cache key. When falsy, the hook sits idle and never fires.
 * - `loader`: closure called when key/tick changes.
 *
 * Status is *derived* from `data`/`error` to avoid the React 19
 * `setState-in-effect` lint that fires on a synchronous status
 * transition at effect start. During a refetch, `data` keeps its
 * previous value until new data arrives — a feature (no flicker).
 */
function useFetch<T>(
  key: string | null | undefined,
  loader: () => Promise<T>
): Result<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<KnowledgeApiError | null>(null);
  // Bump to force a refetch.
  const [tick, setTick] = useState(0);
  // Hold the latest loader in a ref so the in-flight effect always
  // sees the freshest closure (caller param changes apply to refetch).
  // Updated via an effect to satisfy react-hooks/refs.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loaderRef
      .current()
      .then((next) => {
        if (cancelled) return;
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
  workspaceId?: string
): Result<KnowledgeEntry> {
  return useFetch(
    entryId ? `${workspaceId ?? "default"}:${entryId}` : null,
    () => fetchEntry(entryId as string, workspaceId)
  );
}

export function useKnowledgeTrash(
  baseId?: string,
  workspaceId?: string
): Result<{
  bases: KnowledgeBase[];
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}> {
  const key = `${workspaceId ?? "default"}:${baseId ?? "all"}`;
  return useFetch(key, () => fetchTrash(baseId, workspaceId));
}
