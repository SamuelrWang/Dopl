"use client";

import { useState } from "react";
import { DesktopHandoffPanel, JoinPendingPanel } from "./desktop-handoff-panel";

interface Props {
  workspaceName: string;
  inviterName: string | null;
  inviterEmail: string | null;
  token: string;
  /** True when the request had no Supabase session — show a sign-in CTA. */
  needsAuth: boolean;
}

/**
 * `POST /api/join/[token]`'s answer. ⚠ `RequestJoinResult` in
 * `../server/join-links` is the authority but is `server-only`, so the shape is
 * restated here and must be kept in sync.
 */
type JoinOutcome =
  | { outcome: "already_member"; workspaceSlug: string; workspacePublicId: string }
  | { outcome: "requested" | "already_pending" };

/**
 * Join-link landing card. Mirrors accept-invite, but joining files an
 * admin-approval request instead of granting membership:
 *   - signed out → sign-in CTA bouncing through /login back here
 *   - signed in  → "Request to join"; success says it is with an admin
 *   - already a member → desktop handoff, straight into the workspace
 *
 * ⚠ NOTHING HERE NAVIGATES. Both branches used to `router.push` an SPA path,
 * and `/{slug}-{publicId}` is 302'd to `/get-started`. The outcome of a join is
 * a `dopl://` handoff (`desktop-handoff-panel.tsx`), not a page.
 *
 * The already-member branch is ALSO the approved-request branch: a requester
 * returning after approval gets `already_member` from `requestJoin`, so the
 * approved moment needs no new endpoint and no polling.
 */
export function JoinLinkCard({
  workspaceName,
  inviterName,
  inviterEmail,
  token,
  needsAuth,
}: Props) {
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<JoinOutcome | null>(null);

  const inviter = inviterName ?? inviterEmail;

  async function requestJoin() {
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(`/api/join/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error?.message || body?.error || "Failed to request");
      }
      setOutcome(body as JoinOutcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setJoining(false);
    }
  }

  return (
    <div className="rounded-xl bg-surface-raised-2 border border-border-default p-7 max-w-md w-full">
      <p className="text-micro uppercase tracking-wider text-text-muted font-mono">
        Workspace invitation
      </p>
      <h1 className="mt-2 text-display font-semibold text-text-primary">
        {workspaceName}
      </h1>
      <p className="mt-2 text-lead text-text-tertiary">
        {inviter ? (
          <>
            <span className="text-text-primary">{inviter}</span> has invited you
            to join <span className="text-text-primary">{workspaceName}</span>.
          </>
        ) : (
          <>
            You&apos;ve been invited to join{" "}
            <span className="text-text-primary">{workspaceName}</span>.
          </>
        )}{" "}
        {/* Dropped once the answer is in hand — it is either already wrong
            (they were a member all along) or superseded by the panel below. */}
        {!outcome && "An admin will approve your request once you ask to join."}
      </p>

      {outcome?.outcome === "already_member" ? (
        <DesktopHandoffPanel
          workspace={{
            slug: outcome.workspaceSlug,
            publicId: outcome.workspacePublicId,
          }}
          heading={`You're already a member of ${workspaceName}.`}
        />
      ) : outcome ? (
        <JoinPendingPanel
          heading={
            outcome.outcome === "already_pending"
              ? `Your request to join ${workspaceName} is already with an admin.`
              : `Request sent to the ${workspaceName} admins.`
          }
        />
      ) : needsAuth ? (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-caption text-text-tertiary">
            Sign in or create an account to join. We&apos;ll bring you back here.
          </p>
          <a
            href={`/login?redirectTo=${encodeURIComponent(`/join/${token}`)}`}
            className="h-9 px-4 rounded-md bg-surface-cta text-text-on-cta text-small font-medium hover:bg-surface-cta/90 transition-colors inline-flex items-center justify-center"
          >
            Join workspace
          </a>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {error && <p className="text-small text-danger">{error}</p>}
          <button
            type="button"
            onClick={requestJoin}
            disabled={joining}
            className="h-9 px-4 rounded-md bg-surface-cta text-text-on-cta text-small font-medium hover:bg-surface-cta/90 disabled:opacity-40 transition-colors"
          >
            {joining ? "Requesting…" : `Request to join ${workspaceName}`}
          </button>
        </div>
      )}
    </div>
  );
}
