"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import type { AssignableRole } from "../types";
import { formatRelativeTime } from "../format-last-active";
import { Avatar, RoleSelect } from "./member-bits";

interface JoinRequestView {
  id: string;
  userId: string;
  requestedAt: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface Props {
  workspaceSlug: string;
  /** Only admins can read the queue — gate the fetch. */
  enabled: boolean;
  /** Fired after an approval/decline so the parent can refresh members. */
  onResolved: () => void;
}

/**
 * Pending join requests from the shareable link — the admin approval
 * queue. Each row: requester identity, role picker (default Member),
 * Approve / Decline. Renders nothing while empty.
 */
export function JoinRequestsBanner({ workspaceSlug, enabled, onResolved }: Props) {
  const [requests, setRequests] = useState<JoinRequestView[]>([]);
  const [roles, setRoles] = useState<Record<string, AssignableRole>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/join-requests`, {
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const body = (await res.json()) as { requests: JoinRequestView[] };
        if (!cancelled) setRequests(body.requests ?? []);
      })
      .catch(() => {
        /* queue is re-fetched on next refresh */
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, enabled, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  async function resolve(
    request: JoinRequestView,
    action: "approve" | "decline"
  ) {
    setBusyId(request.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/join-requests/${encodeURIComponent(request.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "approve"
              ? { action, role: roles[request.id] ?? "member" }
              : { action }
          ),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to resolve");
      }
      refresh();
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  if (!enabled || requests.length === 0) return null;

  return (
    <section className="rounded-lg border border-sky-500/30 bg-sky-500/[0.06] px-3 py-2.5">
      <h3 className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-sky-700/90 mb-1.5">
        <UserPlus size={11} />
        {requests.length} join request{requests.length > 1 ? "s" : ""} awaiting approval
      </h3>
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <ul className="divide-y divide-sky-500/10">
        {requests.map((r) => (
          <li key={r.id} className="py-2 flex items-center gap-3">
            <Avatar
              person={{
                userId: r.userId,
                email: r.email,
                displayName: r.displayName,
                avatarUrl: r.avatarUrl,
              }}
              size="xs"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary truncate">
                {r.displayName || r.email || r.userId}
              </p>
              <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/50">
                {r.email && r.displayName ? `${r.email} · ` : ""}requested{" "}
                {formatRelativeTime(r.requestedAt)}
              </p>
            </div>
            <RoleSelect
              value={roles[r.id] ?? "member"}
              disabled={busyId === r.id}
              onChange={(role) => setRoles((prev) => ({ ...prev, [r.id]: role }))}
            />
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={() => void resolve(r, "approve")}
              className="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-medium bg-emerald-500/10 border border-emerald-600/30 text-emerald-700 hover:brightness-105 transition-all disabled:opacity-40 cursor-pointer"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={() => void resolve(r, "decline")}
              className="shrink-0 text-[10px] uppercase tracking-wider text-text-secondary/50 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer"
            >
              Decline
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

