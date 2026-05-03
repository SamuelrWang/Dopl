"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceMemberView } from "../types";

interface UseMembersResult {
  members: WorkspaceMemberView[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Loads the workspace members list and hydrates email/displayName/avatar.
 * Uses the same useEffect+fetch+tick pattern as `useWorkspaces` in the
 * sidebar so consumers can call `refresh()` after mutations and the
 * hook re-fetches.
 */
export function useMembers(workspaceSlug: string): UseMembersResult {
  const [members, setMembers] = useState<WorkspaceMemberView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body?.error?.message || body?.error || "Failed to load members"
          );
        }
        return res.json() as Promise<{ members: WorkspaceMemberView[] }>;
      })
      .then((body) => {
        if (cancelled) return;
        setMembers(body.members ?? []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setMembers([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { members, loading, error, refresh };
}
