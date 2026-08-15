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
import { isRetiredResourceType, type AccessLevel } from "@/features/teams/access-levels";

/** Resource kinds the badge UI may ask about. Teams-mode resolution only
 *  produces knowledge_base entries; skill falls through to the role
 *  default. */
type ResourceType = "knowledge_base" | "skill";

interface Override<T extends string> {
  resourceType: T;
  resourceId: string;
  level: AccessLevel;
}

/** What the endpoint actually sends. ⚠ `workflow` grants are still valid
 *  rows in the DB and the route still emits them; `selectAccess` drops them
 *  on arrival so nothing downstream resolves against a retired resource. */
interface MyAccessWire {
  defaultLevel: AccessLevel;
  overrides: Array<Override<ResourceType | "workflow">>;
}

interface MyAccessPayload {
  defaultLevel: AccessLevel;
  overrides: Array<Override<ResourceType>>;
}

// Hand-rolled `.filter`, not `withoutRetiredResources`: this one NARROWS the
// element type (drops `"workflow"` from the union) and the shared helper is
// type-preserving. Predicate is still the shared one, so un-retiring stays a
// single edit in `teams/access-levels`.
const selectAccess = (body: MyAccessWire): MyAccessPayload => ({
  defaultLevel: body.defaultLevel,
  overrides: (body.overrides ?? []).filter(
    (o): o is Override<ResourceType> => !isRetiredResourceType(o.resourceType)
  ),
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
  const query = useApiQuery<MyAccessWire, MyAccessPayload>(
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
