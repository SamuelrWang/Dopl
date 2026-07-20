"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import type { AssignableRole } from "../types";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { ApiError } from "@/shared/api/api-client";
import { UpgradeModal } from "@/features/billing/components/upgrade-modal";
import { useJoinRequests, type JoinRequestView } from "../hooks/use-join-requests";
import { Avatar, RoleSelect } from "./member-bits";

interface Props {
  workspaceSlug: string;
  /** Scopes the Solo member-limit upgrade modal; the 402 degrades to
   *  inline text when absent. */
  workspaceId?: string;
  /** Only admins can read the queue — gate the fetch. */
  enabled: boolean;
  /** Fired after an approval/decline so the parent can refresh members. */
  onResolved: () => void;
}

/**
 * Pending join requests from the shareable link — the admin approval
 * queue. Each row: requester identity, role picker (default Member),
 * Approve / Decline. Renders nothing while empty. Data flows through
 * useJoinRequests — the same query cache entry as the members view.
 */
export function JoinRequestsBanner({
  workspaceSlug,
  workspaceId,
  enabled,
  onResolved,
}: Props) {
  const { requests, resolve: resolveRequest } = useJoinRequests(workspaceSlug, enabled);
  const [roles, setRoles] = useState<Record<string, AssignableRole>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  async function resolve(
    request: JoinRequestView,
    action: "approve" | "decline"
  ) {
    setBusyId(request.id);
    setError(null);
    try {
      await resolveRequest(request.id, action, roles[request.id] ?? "member");
      onResolved();
    } catch (err) {
      // Solo plan is single-member — approving is blocked server-side.
      // Offer the in-place Team upgrade instead of a dead-end error line.
      if (
        err instanceof ApiError &&
        err.code === "SOLO_MEMBER_LIMIT" &&
        workspaceId
      ) {
        setUpgradeOpen(true);
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setBusyId(null);
    }
  }

  if (!enabled || requests.length === 0) return null;

  return (
    <section className="rounded-lg border border-border-strong bg-card-surface-subtle px-3 py-2.5">
      <h3 className="flex items-center gap-1.5 text-label uppercase tracking-wider text-text-secondary mb-1.5">
        <UserPlus size={11} />
        {requests.length} join request{requests.length > 1 ? "s" : ""} awaiting approval
      </h3>
      {error && <p className="text-small text-danger mb-2">{error}</p>}
      <ul className="divide-y divide-border-subtle">
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
              <p className="text-body text-text-primary truncate">
                {r.displayName || r.email || r.userId}
              </p>
              <p className="text-label uppercase tracking-wider text-text-muted">
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
              className="shrink-0 px-2.5 py-1 rounded-md text-caption font-medium bg-bg-inset border border-border-strong text-text-primary hover:brightness-105 transition-all disabled:opacity-40 cursor-pointer"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busyId === r.id}
              onClick={() => void resolve(r, "decline")}
              className="shrink-0 text-label uppercase tracking-wider text-text-muted hover:text-danger transition-colors disabled:opacity-40 cursor-pointer"
            >
              Decline
            </button>
          </li>
        ))}
      </ul>

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        workspaceId={workspaceId}
        variant="add-member"
      />
    </section>
  );
}

