"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssignableRole } from "../types";

export interface JoinRequestView {
  id: string;
  userId: string;
  requestedAt: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Pending join-link requests + approve/decline actions. Fetches only
 * when `enabled` (the endpoint is admin-gated server-side); disabled
 * callers get an empty list and no network traffic.
 */
export function useJoinRequests(workspaceSlug: string, enabled: boolean) {
  const [requests, setRequests] = useState<JoinRequestView[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/join-requests`, {
      credentials: "same-origin",
    })
      .then(async (res) => (res.ok ? res.json() : { requests: [] }))
      .then((body: { requests?: JoinRequestView[] }) => {
        if (!cancelled) setRequests(body.requests ?? []);
      })
      .catch(() => {
        if (!cancelled) setRequests([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, enabled, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const resolve = useCallback(
    async (requestId: string, action: "approve" | "decline", role: AssignableRole) => {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/join-requests/${encodeURIComponent(requestId)}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "approve" ? { action, role } : { action }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string } | string;
        };
        const err = body?.error;
        throw new Error(
          (typeof err === "string" ? err : err?.message) || "Request failed"
        );
      }
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    },
    [workspaceSlug]
  );

  // Disabled callers (non-admins) always see an empty queue — state is
  // kept but never surfaced, so flipping roles mid-session stays clean.
  return { requests: enabled ? requests : [], refresh, resolve };
}
