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
 * `POST /api/join/[token]`'s answer, structurally. `RequestJoinResult` in
 * `../server/join-links` is the authority, but that module is `server-only` and
 * this is a client component — so the shape is restated rather than imported.
 */
type JoinOutcome =
  | { outcome: "already_member"; workspaceSlug: string; workspacePublicId: string }
  | { outcome: "requested" | "already_pending" };

/**
 * Join-link landing card. Mirrors the accept-invite card, but joining
 * files an admin-approval request instead of granting membership:
 *   - signed out → sign-in CTA bouncing through /login back to this page
 *   - signed in  → "Request to join"; on success the card says the request
 *     is with an admin and to open the desktop app once it lands
 *   - already a member → the desktop handoff, straight into the workspace
 *
 * NOTHING HERE NAVIGATES ANY MORE. Both branches used to `router.push` an SPA
 * path — `/{slug}-{publicId}` and the post-auth landing — and the first of
 * those is a URL the retirement map 302s to `/get-started`, so a member
 * arriving through this card was shown a download page instead of their
 * workspace. The product lives in the desktop app; the outcome of a join is a
 * `dopl://` handoff (`desktop-handoff-panel.tsx`), not a page.
 *
 * THE ALREADY-MEMBER BRANCH IS ALSO THE APPROVED-REQUEST BRANCH. A requester
 * who comes back to the same link after an admin approves them clicks the same
 * button, and `requestJoin` answers `already_member` — so the approved moment
 * needs no new endpoint and no polling, only this card being honest about the
 * answer it already gets.
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
