"use client";

/**
 * useMyAccess — single-fetch hook that returns the caller's effective
 * access on every resource in a workspace.
 *
 * Backed by GET /api/workspaces/[slug]/my-access. The response carries a
 * role-derived `defaultLevel` plus any per-resource `overrides`. Look
 * up a specific resource via the returned `resolve()` helper rather
 * than indexing the array yourself.
 *
 * Use the `MyAccessProvider` + `useMyAccessContext` flow at the
 * application shell so multiple consumers (sidebar nav, KB/skill
 * detail pages, canvas panels) share one fetch instead of duplicating.
 * The bare `useMyAccess(workspaceSegment)` hook is still exported for
 * tests or one-off callers who don't have a provider in scope.
 *
 * Pattern matches the existing client hooks (useEffect + fetch +
 * cancelled flag, `tick`-based refresh).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AccessLevel } from "@/features/teams/access-levels";

/** Resource kinds the badge UI may ask about. Teams-mode resolution only
 *  produces knowledge_base/workflow entries; skill/canvas fall through to
 *  the role default. */
type ResourceType = "knowledge_base" | "skill" | "canvas" | "workflow";

interface MyAccessPayload {
  defaultLevel: AccessLevel;
  overrides: Array<{
    resourceType: ResourceType;
    resourceId: string;
    level: AccessLevel;
  }>;
}

export interface UseMyAccessResult {
  data: MyAccessPayload | null;
  loading: boolean;
  /** Resolve the effective access level for one resource. Returns
   *  `defaultLevel` when there's no override. Returns null until the
   *  hook has a value (caller should treat as "edit" / hide icon). */
  resolve: (resourceType: ResourceType, resourceId: string) => AccessLevel | null;
  refetch: () => void;
}

export function useMyAccess(workspaceSegment: string | null): UseMyAccessResult {
  const [data, setData] = useState<MyAccessPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [tick, setTick] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!workspaceSegment) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(
      `/api/workspaces/${encodeURIComponent(workspaceSegment)}/my-access`,
      { credentials: "same-origin" }
    )
      .then(async (res) => {
        if (cancelledRef.current) return;
        if (!res.ok) {
          // 403 (not a member) or 404 (workspace not found) — quietly
          // treat as "no info" so the sidebar just doesn't badge.
          setData(null);
          return;
        }
        const json = (await res.json()) as MyAccessPayload;
        if (cancelledRef.current) return;
        setData(json);
      })
      .catch(() => {
        if (cancelledRef.current) return;
        setData(null);
      })
      .finally(() => {
        if (cancelledRef.current) return;
        setLoading(false);
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [workspaceSegment, tick]);

  // Index overrides by `${type}:${id}` for cheap lookups.
  const overrideIndex = useMemo(() => {
    const m = new Map<string, AccessLevel>();
    if (data) {
      for (const o of data.overrides) {
        m.set(`${o.resourceType}:${o.resourceId}`, o.level);
      }
    }
    return m;
  }, [data]);

  const resolve = useCallback(
    (resourceType: ResourceType, resourceId: string): AccessLevel | null => {
      if (!data) return null;
      return (
        overrideIndex.get(`${resourceType}:${resourceId}`) ?? data.defaultLevel
      );
    },
    [data, overrideIndex]
  );

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, resolve, refetch };
}

// ── Context-based shared instance ──────────────────────────────────────

const MyAccessCtx = createContext<UseMyAccessResult | null>(null);

/**
 * App-shell provider — call once at the top of the chrome layout
 * (`layout-shell.tsx`). All descendants that need access info should
 * read via `useMyAccessContext()` so the request is shared. Without
 * the provider, `useMyAccessContext` returns a no-op shape (data null,
 * resolve always null, refetch a no-op) so consumers don't crash on
 * pages that don't have a workspace in scope.
 *
 * Audit A-021: refetches automatically when the window regains focus,
 * so an admin change in another tab is reflected without a hard
 * reload. The ideal would be a Supabase realtime subscription on
 * `workspace_resource_access` but the focus pattern is enough for
 * v1 (access changes are rare; same-tab admin actions already call
 * `access.refetch()` explicitly).
 */
export function MyAccessProvider({
  workspaceSegment,
  children,
}: {
  workspaceSegment: string | null;
  children: ReactNode;
}) {
  const value = useMyAccess(workspaceSegment);
  const refetchRef = useRef(value.refetch);
  useEffect(() => {
    refetchRef.current = value.refetch;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onFocus() {
      refetchRef.current();
    }
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return <MyAccessCtx.Provider value={value}>{children}</MyAccessCtx.Provider>;
}

const NO_OP_RESULT: UseMyAccessResult = {
  data: null,
  loading: false,
  resolve: () => null,
  refetch: () => {},
};

export function useMyAccessContext(): UseMyAccessResult {
  return useContext(MyAccessCtx) ?? NO_OP_RESULT;
}
