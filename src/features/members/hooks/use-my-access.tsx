"use client";

/**
 * Caller's effective access on every resource in a workspace, one fetch.
 * Backed by GET /api/workspaces/[slug]/my-access. Look resources up via the
 * returned `resolve()` helper, not by indexing the array.
 * ⚠ Use `MyAccessProvider` + `useMyAccessContext` at the app shell so all
 * consumers share one cache entry. Focus revalidation is the query layer's,
 * and only fires when stale.
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { type AccessLevel } from "@/features/teams/access-levels";

/** Resource kinds the badge UI may ask about. Teams-mode resolution only
 *  produces knowledge_base entries; skill falls through to the role
 *  default. */
type ResourceType = "knowledge_base" | "skill";

interface Override<T extends string> {
  resourceType: T;
  resourceId: string;
  level: AccessLevel;
}

/**
 * What the endpoint actually sends.
 *
 * ⚠ **IT CARRIED `| "workflow"` AND A NARROWING FILTER UNTIL 2026-09-02
 * (F-466).** `team_resource_access.resource_type` kept the value in its CHECK
 * after the feature was dropped (`20260811120000`), so a surviving row could
 * reach this hook with no live code between. Ruling B4 moved the route onto
 * `resource_grants`, whose CHECK refuses it — the wire union is the resource
 * union now, and there is nothing to narrow from.
 */
interface MyAccessPayload {
  defaultLevel: AccessLevel;
  overrides: Array<Override<ResourceType>>;
}

const selectAccess = (body: MyAccessPayload): MyAccessPayload => ({
  defaultLevel: body.defaultLevel,
  overrides: body.overrides ?? [],
});

export interface UseMyAccessResult {
  data: MyAccessPayload | null;
  loading: boolean;
  /** Resolve the effective access level for one resource. Returns
   *  `defaultLevel` when there's no override. Returns null until the
   *  hook has a value (caller should treat as "edit" / hide icon). */
  resolve: (resourceType: ResourceType, resourceId: string) => AccessLevel | null;
  refetch: () => void;
}

function useMyAccess(workspaceSegment: string | null): UseMyAccessResult {
  const query = useApiQuery<MyAccessPayload, MyAccessPayload>(
    workspaceSegment
      ? `/api/workspaces/${encodeURIComponent(workspaceSegment)}/my-access`
      : null,
    { select: selectAccess }
  );

  // 403 (not a member) / 404 (no workspace) → "no info", so the sidebar just
  // doesn't badge. Query retry already skips 4xx.
  const data = query.data ?? null;

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

  const refetchQuery = query.refetch;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);

  return {
    data,
    loading: workspaceSegment !== null && query.isPending,
    resolve,
    refetch,
  };
}

// ── Context-based shared instance ──────────────────────────────────────

const MyAccessCtx = createContext<UseMyAccessResult | null>(null);

/** App-shell provider — call once at the top of `layout-shell.tsx`;
 *  descendants read via `useMyAccessContext()` so the request is shared.
 *  Without it the context returns a no-op shape (data null, resolve null),
 *  so consumers don't crash on pages with no workspace in scope. */
export function MyAccessProvider({
  workspaceSegment,
  children,
}: {
  workspaceSegment: string | null;
  children: ReactNode;
}) {
  const value = useMyAccess(workspaceSegment);
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
