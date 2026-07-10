"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  workspaceName: string;
  inviterName: string | null;
  inviterEmail: string | null;
  token: string;
  /** True when the request had no Supabase session — show a sign-in CTA. */
  needsAuth: boolean;
}

/**
 * Join-link landing card. Mirrors the accept-invite card, but joining
 * files an admin-approval request instead of granting membership:
 *   - signed out → sign-in CTA bouncing through /login back to this page
 *   - signed in  → "Request to join"; on success the visitor is routed
 *     to their own workspace where the awaiting-approval popup picks up
 *   - already a member → straight into the workspace
 */
export function JoinLinkCard({
  workspaceName,
  inviterName,
  inviterEmail,
  token,
  needsAuth,
}: Props) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (body.outcome === "already_member") {
        router.push(`/${body.workspaceSlug}-${body.workspacePublicId}`);
      } else {
        // Land in the visitor's own workspace — /canvas resolves their
        // default workspace + canvas, where the awaiting-approval popup
        // (driven by /api/me/join-requests) is mounted. "/" would dump
        // them on the public marketing page with no feedback.
        router.push("/canvas");
      }
      router.refresh();
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
        An admin will approve your request once you ask to join.
      </p>

      {needsAuth ? (
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
