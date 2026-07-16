"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvitationStatus } from "../types";

interface Props {
  /**
   * Server-resolved invitation status. The token-stripped variant from
   * the public API endpoint — accepting still requires the token from
   * the URL.
   */
  status: Omit<InvitationStatus, "invitation"> & {
    invitation: Omit<InvitationStatus["invitation"], "token">;
  };
  token: string;
  /** True when the request had no Supabase session — show a sign-in CTA. */
  needsAuth: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

/**
 * Accept-invite landing card. Shows the workspace + inviter context, then:
 *   - if the invitee is signed in → Accept button hits the API
 *   - if not → Sign in CTA that bounces through /login and back here
 *   - if the link is dead (expired/revoked/used) → friendly explainer
 */
export function AcceptInviteCard({ status, token, needsAuth }: Props) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dead = status.expired || status.revoked || status.alreadyAccepted;
  const reason = status.revoked
    ? "This invitation has been revoked."
    : status.expired
      ? "This invitation has expired."
      : status.alreadyAccepted
        ? "This invitation has already been used."
        : null;

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/invitations/${encodeURIComponent(token)}/accept`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to accept");
      }
      const { workspaceSlug, workspacePublicId } = (await res.json()) as {
        workspaceSlug: string;
        workspacePublicId: string;
      };
      router.push(`/${workspaceSlug}-${workspacePublicId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setAccepting(false);
    }
  }

  return (
    <div className="rounded-xl bg-surface-raised-2 border border-border-default p-7 max-w-md w-full">
      <p className="text-micro uppercase tracking-wider text-text-muted font-mono">
        Workspace invitation
      </p>
      <h1 className="mt-2 text-display font-semibold text-text-primary">
        {status.workspace.name}
      </h1>
      <p className="mt-2 text-lead text-text-tertiary">
        {status.inviter.email ? (
          <>
            <span className="text-text-primary">{status.inviter.email}</span> invited
            you as{" "}
            <span className="text-text-primary">
              {ROLE_LABELS[status.invitation.invitedRole] ??
                status.invitation.invitedRole}
            </span>
            .
          </>
        ) : (
          <>
            You&apos;ve been invited as{" "}
            <span className="text-text-primary">
              {ROLE_LABELS[status.invitation.invitedRole] ??
                status.invitation.invitedRole}
            </span>
            .
          </>
        )}
      </p>

      {dead ? (
        <div className="mt-6 rounded-md bg-danger/10 border border-danger/20 p-3">
          <p className="text-small text-danger">{reason}</p>
          <p className="text-caption text-text-muted mt-1.5">
            Ask the workspace admin to send a fresh invitation.
          </p>
        </div>
      ) : needsAuth ? (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-caption text-text-tertiary">
            Sign in to accept. We&apos;ll bring you back here.
          </p>
          <Link
            href={`/login?redirectTo=${encodeURIComponent(`/invite/${token}`)}`}
            className="h-9 px-4 rounded-md bg-surface-cta text-text-on-cta text-small font-medium hover:bg-surface-cta/90 transition-colors inline-flex items-center justify-center"
          >
            Sign in to accept
          </Link>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {error && <p className="text-small text-danger">{error}</p>}
          <button
            type="button"
            onClick={accept}
            disabled={accepting}
            className="h-9 px-4 rounded-md bg-surface-cta text-text-on-cta text-small font-medium hover:bg-surface-cta/90 disabled:opacity-40 transition-colors"
          >
            {accepting ? "Joining..." : `Join ${status.workspace.name}`}
          </button>
        </div>
      )}

      <p className="mt-6 text-micro uppercase tracking-wider text-text-muted font-mono">
        Expires {new Date(status.invitation.expiresAt).toLocaleString()}
      </p>
    </div>
  );
}
