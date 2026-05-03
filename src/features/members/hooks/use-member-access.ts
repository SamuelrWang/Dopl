"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccessLevel, ResourceType } from "../server/access";

export interface AccessOverride {
  resourceType: ResourceType;
  resourceId: string;
  level: AccessLevel;
}

export interface ResourceEntry {
  type: ResourceType;
  id: string;
  name: string;
}

export interface MatrixData {
  resources: ResourceEntry[];
  overrides: Map<string, AccessLevel>;
}

interface UseMemberAccessResult {
  data: MatrixData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Optimistically apply an override and persist via PUT. Reverts on failure. */
  setLevel: (
    resourceType: ResourceType,
    resourceId: string,
    level: AccessLevel
  ) => Promise<void>;
}

function overrideKey(type: ResourceType, id: string): string {
  return `${type}:${id}`;
}

interface RawKb {
  id: string;
  name: string;
  deletedAt?: string | null;
}

interface RawSkill {
  id: string;
  name: string;
}

interface RawCanvas {
  id: string;
  name: string;
}

/**
 * Loads everything the access matrix needs for one member: the full
 * resource list (KBs, skills, canvases) and the member's override rows.
 * Stays open while the dropdown is expanded, so writes round-trip and
 * re-fetch.
 */
export function useMemberAccess(
  workspaceSlug: string,
  workspaceId: string,
  targetUserId: string,
  enabled: boolean
): UseMemberAccessResult {
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const slug = encodeURIComponent(workspaceSlug);
    const userId = encodeURIComponent(targetUserId);
    const wsHeader = { "X-Workspace-Id": workspaceId };

    Promise.all([
      fetch(`/api/knowledge/bases`, { headers: wsHeader }),
      fetch(`/api/skills`, { headers: wsHeader }),
      fetch(`/api/workspaces/${slug}/canvases`),
      fetch(`/api/workspaces/${slug}/members/${userId}/access`),
    ])
      .then(async ([kbRes, skillRes, canvasRes, accessRes]) => {
        if (!accessRes.ok) {
          const body = await accessRes.json().catch(() => ({}));
          throw new Error(
            body?.error?.message || body?.error || "Failed to load access"
          );
        }
        const [kbBody, skillBody, canvasBody, accessBody] = await Promise.all([
          kbRes.ok ? kbRes.json() : { bases: [] },
          skillRes.ok ? skillRes.json() : { skills: [] },
          canvasRes.ok ? canvasRes.json() : { canvases: [] },
          accessRes.json(),
        ]);
        return { kbBody, skillBody, canvasBody, accessBody };
      })
      .then(({ kbBody, skillBody, canvasBody, accessBody }) => {
        if (cancelled) return;
        const resources: ResourceEntry[] = [];
        for (const kb of (kbBody.bases ?? []) as RawKb[]) {
          if (kb.deletedAt) continue;
          resources.push({ type: "knowledge_base", id: kb.id, name: kb.name });
        }
        for (const s of (skillBody.skills ?? []) as RawSkill[]) {
          resources.push({ type: "skill", id: s.id, name: s.name });
        }
        for (const c of (canvasBody.canvases ?? []) as RawCanvas[]) {
          resources.push({ type: "canvas", id: c.id, name: c.name });
        }
        const overrides = new Map<string, AccessLevel>();
        for (const o of (accessBody.overrides ?? []) as AccessOverride[]) {
          overrides.set(overrideKey(o.resourceType, o.resourceId), o.level);
        }
        setData({ resources, overrides });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setData({ resources: [], overrides: new Map() });
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, workspaceId, targetUserId, enabled, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const setLevel = useCallback(
    async (resourceType: ResourceType, resourceId: string, level: AccessLevel) => {
      const slug = encodeURIComponent(workspaceSlug);
      const userId = encodeURIComponent(targetUserId);
      const key = overrideKey(resourceType, resourceId);

      // Optimistic update via functional setState — captures the
      // pre-toggle level for revert without depending on a stale
      // closure of `data`. Concurrent toggles each track their own
      // (key, previous) pair.
      let previous: AccessLevel | undefined;
      setData((prev) => {
        if (!prev) return prev;
        previous = prev.overrides.get(key);
        const next = new Map(prev.overrides);
        next.set(key, level);
        return { resources: prev.resources, overrides: next };
      });

      try {
        const res = await fetch(
          `/api/workspaces/${slug}/members/${userId}/access`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resourceType, resourceId, level }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body?.error?.message || body?.error || "Failed to save"
          );
        }
      } catch (err) {
        // Revert only if this row is still showing our optimistic
        // value. If the user toggled this same row again in the
        // meantime, leave their newer value alone.
        setData((prev) => {
          if (!prev) return prev;
          if (prev.overrides.get(key) !== level) return prev;
          const reverted = new Map(prev.overrides);
          if (previous === undefined) reverted.delete(key);
          else reverted.set(key, previous);
          return { resources: prev.resources, overrides: reverted };
        });
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    },
    [workspaceSlug, targetUserId]
  );

  return { data, loading, error, refresh, setLevel };
}
