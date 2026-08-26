"use client";

import { useEffect, useState } from "react";

/**
 * The claim-link landing card. Mirrors `JoinLinkCard` — same surface, same
 * copy rhythm, same endings — with one difference that is the whole point:
 *
 * ⚠ THE HANDOFF IS `dopl://open/home`, NOT a workspace. A relationship lives in
 * a hidden `kind='link'` CONTAINER, which the desktop rail filters out on
 * purpose; the surface that shows it is the account HOME page. Handing over the
 * container's segment would open a workspace the app declines to list.
 *
 * ⚠ REVERSED 2026-08-25 by `docs/specs/guest-web-channel.md` (owner ruling).
 * This block used to read "NOTHING HERE NAVIGATES THE WEB APP", because the web
 * tree could not render a workspace at all. It can now: a successful claim ALSO
 * offers the guest lane at `/c/<workspaceId>`, so a claimer with no desktop app
 * has somewhere to go. What did NOT change: the dead endings (arrived dead, or a
 * 410 mid-claim) still navigate nowhere and still show no deep link, and the
 * card still binds NO router — the web lane is a plain anchor, so the full page
 * load lands on the Next route's own auth and membership fence.
 */

/** ⚠ `HomeLinkClaimResult` is the authority; only what this card reads is restated. */
interface ClaimOutcome {
  existing: boolean;
  channel: { workspaceId: string };
}

const HOME_DEEP_LINK = "dopl://open/home";

export function LinkClaimCard({
  creatorName,
  dead,
  token,
  /** True when the request had no Supabase session — show a sign-in CTA. */
  needsAuth,
}: {
  creatorName: string | null;
  /** Expired, revoked or exhausted: a real URL with nothing left behind it. */
  dead: boolean;
  token: string;
  needsAuth: boolean;
}) {
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A 410 mid-claim is the SAME ending as arriving at a dead link — somebody
  // else took the last use between the page load and the click.
  const [gone, setGone] = useState(false);
  const [outcome, setOutcome] = useState<ClaimOutcome | null>(null);

  const who = creatorName ?? "Someone";
  const unavailable = dead || gone;

  async function claim() {
    setClaiming(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/home/link/${encodeURIComponent(token)}/claim`,
        { method: "POST" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body?.error?.code === "LINK_UNAVAILABLE") {
          setGone(true);
          return;
        }
        throw new Error(body?.error?.message || "Could not connect");
      }
      setOutcome(body as ClaimOutcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="rounded-xl bg-surface-raised-2 border border-border-default p-7 max-w-md w-full">
      <p className="text-micro uppercase tracking-wider text-text-muted font-mono">
        Dopl connection
      </p>
      <h1 className="mt-2 text-display font-semibold text-text-primary">
        {unavailable ? "This link is no longer available" : `${who} invites you to connect`}
      </h1>
      <p className="mt-2 text-lead text-text-tertiary">
        {unavailable ? (
          "It expired, was revoked, or has already been used."
        ) : (
          <>
            <span className="text-text-primary">{who}</span> wants a direct
            channel with you — your agents talk, you both stay in the loop.
          </>
        )}
      </p>

      {unavailable ? (
        <DeadLinkPanel />
      ) : outcome ? (
        <HandoffPanel
          heading={
            outcome.existing
              ? `You're already connected to ${who}.`
              : `You're connected to ${who}.`
          }
          workspaceId={outcome.channel?.workspaceId ?? null}
        />
      ) : needsAuth ? (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-caption text-text-tertiary">
            Sign in or create an account to connect. We&apos;ll bring you back
            here.
          </p>
          <a
            href={`/login?redirectTo=${encodeURIComponent(`/link/${token}`)}`}
            className="h-9 px-4 rounded-md bg-surface-cta text-text-on-cta text-small font-medium hover:bg-surface-cta/90 transition-colors inline-flex items-center justify-center"
          >
            Connect
          </a>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {error && <p className="text-small text-danger">{error}</p>}
          <button
            type="button"
            onClick={claim}
            disabled={claiming}
            className="h-9 px-4 rounded-md bg-surface-cta text-text-on-cta text-small font-medium hover:bg-surface-cta/90 disabled:opacity-40 transition-colors"
          >
            {claiming ? "Connecting…" : `Connect with ${who}`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * ⚠ THE BUTTON IS THE CONTRACT, auto-open is the enhancement: browsers refuse
 * protocol launches with no user gesture, silently and per-engagement-state.
 * Same shape as `workspaces/components/desktop-handoff-panel.tsx`, which cannot
 * be reused verbatim — it builds a WORKSPACE deep link, and this one is Home.
 *
 * ⚠ AND THE WEB LANE IS ALWAYS ON SCREEN, never a timer: attempting a custom
 * scheme tells you nothing about whether it landed, so the only honest fallback
 * is a link the claimer can see the whole time. It is a plain `<a href>` on
 * purpose — a full page load hands `/c/<id>` to its own server-side fence.
 */
function HandoffPanel({
  heading,
  /** null only if the claim response arrived without one; then there is no lane to offer. */
  workspaceId,
}: {
  heading: string;
  workspaceId: string | null;
}) {
  useEffect(() => {
    // Assigning a custom scheme does NOT unload the document, so the card stays
    // on screen whether or not the OS had a handler.
    window.location.href = HOME_DEEP_LINK;
  }, []);

  return (
    <div className="mt-6 flex flex-col gap-3">
      <p className="text-small font-medium text-text-primary">{heading}</p>
      <p className="text-caption text-text-tertiary">
        Dopl is a desktop app — opening it now. If nothing happens, use the
        button below.
      </p>
      <a
        href={HOME_DEEP_LINK}
        className="h-9 px-4 rounded-md bg-surface-cta text-text-on-cta text-small font-medium hover:bg-surface-cta/90 transition-colors inline-flex items-center justify-center"
      >
        Open Dopl
      </a>
      {workspaceId && (
        <p className="text-caption text-text-tertiary">
          Or{" "}
          <a
            href={`/c/${encodeURIComponent(workspaceId)}`}
            className="underline underline-offset-2 hover:text-text-secondary"
          >
            open this channel in your browser
          </a>
          .
        </p>
      )}
      <DownloadLine />
    </div>
  );
}

/** ⚠ NO DEEP LINK: nothing was claimed, so the app has nothing to open to. */
function DeadLinkPanel() {
  return (
    <div className="mt-6 flex flex-col gap-3">
      <p className="text-caption text-text-tertiary">
        Ask whoever sent it for a fresh one.
      </p>
      <DownloadLine />
    </div>
  );
}

/** A download link ALWAYS: half the audience never installed Dopl. */
function DownloadLine() {
  return (
    <p className="text-caption text-text-muted">
      Don&apos;t have the app yet?{" "}
      <a
        href="/download"
        className="underline underline-offset-2 hover:text-text-secondary"
      >
        Download Dopl
      </a>
      .
    </p>
  );
}
