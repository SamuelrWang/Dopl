"use client";

/**
 * useMyAccess — single-fetch hook that returns the caller's effective
 * access on every resource in a workspace, used by the sidebar to badge
 * each KB/skill row with a read-vs-edit icon.
 *
 * Backed by GET /api/workspaces/[slug]/my-access. The response carries a
 * role-derived `defaultLevel` plus any per-resource `overrides`. Look
 * up a specific resource via the returned `resolve()` helper rather
 * than indexing the array yourself.
 *
 * Pattern matches the existing client hooks (useEffect + fetch +
 * cancelled flag, `tick`-based refresh).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccessLevel,
  ResourceType,
} from "@/features/members/access-defaults";

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
