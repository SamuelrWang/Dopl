"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkspaceInvitationView } from "../types";

interface UseInvitationsResult {
  invitations: WorkspaceInvitationView[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Loads pending workspace invitations for the admin members panel. Skips
 * the fetch when `enabled` is false (non-admins can't read this list).
 * Filters out accepted/revoked rows so the UI only shows actionable
 * invites.
 */
export function useInvitations(
  workspaceSlug: string,
  enabled: boolean
): UseInvitationsResult {
  const [invitations, setInvitations] =
    useState<WorkspaceInvitationView[] | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setInvitations(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/invitations`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body?.error?.message || body?.error || "Failed to load invitations"
          );
        }
        return res.json() as Promise<{ invitations: WorkspaceInvitationView[] }>;
      })
      .then((body) => {
        if (cancelled) return;
        setInvitations(
          (body.invitations ?? []).filter((i) => !i.acceptedAt && !i.revokedAt)
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setInvitations([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, enabled, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { invitations, loading, error, refresh };
}
