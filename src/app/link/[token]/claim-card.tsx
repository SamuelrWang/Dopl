"use client";

import { useEffect, useState } from "react";

/**
 * The claim-link landing card. Shares `JoinLinkCard`'s ENDINGS — one difference
 * is the whole point, and two more arrived on 2026-08-31:
 *
 * ⚠ NEITHER THE SURFACE NOR THE COPY IS SHARED WITH `JoinLinkCard` ANY MORE
 * (restyle + copy ruling, 2026-08-31). This card is the kit's `.glass-panel` on
 * the white landing ground its own route paints, and its accepted state carries
 * a single heading where the join card still stacks a confirmation on top of an
 * invitation. `JoinLinkCard` is untouched, on the dark `bg-surface-raised-2`
 * frame. Do not "re-sync" the two by copying either one onto the other — they
 * stand on different grounds now.
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

/** ⚠ `HomeLinkClaimResult` is the authority; only what this card reads is restated.
 *  ⚠ `existing` LEFT THIS SHAPE on 2026-08-31 and its absence is the point: the
 *  card used to fork the connected heading on it ("You're ALREADY connected to
 *  X"), and the accepted state now has ONE heading for both. The server still
 *  sends the flag; nothing on this surface reads it. */
interface ClaimOutcome {
  channel: { workspaceId: string };
}

const HOME_DEEP_LINK = "dopl://open/home";

/**
 * THE panel's one CTA face — the kit's black raised button (`.auth-btn-3d`,
 * globals.css), the same face the landing hero's dark pill wears
 * (`marketing.css › .lp-btn--3d` is that recipe) and the same one every primary
 * button in the app wears. Stated ONCE: this card renders three of them (sign
 * in, claim, open the app) across two element types, and `<a>` inherits neither
 * a button's cursor nor its centring.
 */
const CTA =
  "auth-btn-3d inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-full px-4 text-body font-semibold text-white no-underline disabled:cursor-default disabled:opacity-40";

/** The panel's fine-print links (the web lane, the download). One face for both:
 *  they are alternatives to the CTA, not CTAs, so they stay text — inked to
 *  `--text-primary` against the `text-caption text-text-secondary` line they sit
 *  in, which is the whole contrast signal now that the ground is white. */
const PANEL_LINK =
  "font-medium text-text-primary underline underline-offset-2 transition-colors hover:text-text-secondary";

/** The brand mark, as a rounded square. ⚠ Same asset and same `.auth-logo-3d`
 *  face as the landing nav (`features/marketing/components/logo.tsx`) and the
 *  auth pages' lockup (`src/app/(auth)/layout.tsx` › WebBrand) — the three
 *  surfaces a claimer moves between must show one mark. Radius lives at the
 *  call site: the kit class carries the bevel and drop, never a corner. */
function BrandMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/favicons/android-chrome-512x512.png"
      alt="Dopl"
      width={48}
      height={48}
      className="auth-logo-3d block h-12 w-12 rounded-[12px]"
    />
  );
}

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
  /** The ACCEPTED ending. ⚠ `unavailable` wins: a 410 mid-claim leaves `outcome`
   *  null anyway, but stating the precedence keeps the three endings disjoint. */
  const connected = !unavailable && outcome !== null;

  /**
   * ONE heading per ending, and the accepted one REPLACES the invitation
   * (Samuel, 2026-08-31). The connected state used to stack five lines — the
   * eyebrow, the invitation heading, the "wants a direct channel" pitch, a
   * "You're connected to X." confirmation and a "Dopl is a desktop app…"
   * explainer — three of which were addressed to somebody who had not accepted
   * yet. The pitch and the explainer are DELETED, the confirmation is promoted
   * into the heading, and only the eyebrow carries over.
   */
  const heading = unavailable
    ? "This link is no longer available"
    : connected
      ? `Invitation accepted. You are now connected with ${who}'s agent.`
      : `${who} invites you to connect`;

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
    <div className="glass-panel w-full max-w-md p-8 text-center">
      <div className="flex justify-center">
        <BrandMark />
      </div>
      <p className="mt-5 text-label font-semibold uppercase tracking-wide text-text-muted">
        Dopl connection
      </p>
      <h1 className="mt-2 text-display font-semibold text-text-primary">
        {heading}
      </h1>
      {/* ⚠ NO SUBLINE ONCE CONNECTED — the accepted heading is the whole copy. */}
      {!connected && (
        <p className="mt-2 text-lead text-text-secondary">
          {unavailable ? (
            "It expired, was revoked, or has already been used."
          ) : (
            <>
              <span className="text-text-primary">{who}</span> wants a direct
              channel with you — your agents talk, you both stay in the loop.
            </>
          )}
        </p>
      )}

      {unavailable ? (
        <DeadLinkPanel />
      ) : outcome ? (
        <HandoffPanel workspaceId={outcome.channel?.workspaceId ?? null} />
      ) : needsAuth ? (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-caption text-text-secondary">
            Sign in or create an account to connect. We&apos;ll bring you back
            here.
          </p>
          <a
            href={`/login?redirectTo=${encodeURIComponent(`/link/${token}`)}`}
            className={CTA}
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
            className={CTA}
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
 *
 * ⚠ THE PANEL LOST ITS PROSE ON 2026-08-31, NOT ITS BEHAVIOUR. The heading it
 * used to render is the card's now, and the "Dopl is a desktop app — opening it
 * now" explainer is deleted: the auto-open `useEffect` below still fires, the
 * button beneath it is still the contract, and neither needed narrating.
 */
function HandoffPanel({
  /** null only if the claim response arrived without one; then there is no lane to offer. */
  workspaceId,
}: {
  workspaceId: string | null;
}) {
  useEffect(() => {
    // Assigning a custom scheme does NOT unload the document, so the card stays
    // on screen whether or not the OS had a handler.
    window.location.href = HOME_DEEP_LINK;
  }, []);

  return (
    <div className="mt-6 flex flex-col gap-3">
      <a href={HOME_DEEP_LINK} className={CTA}>
        Open Dopl
      </a>
      {workspaceId && (
        <p className="text-caption text-text-secondary">
          Or{" "}
          <a
            href={`/c/${encodeURIComponent(workspaceId)}`}
            className={PANEL_LINK}
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
      <p className="text-caption text-text-secondary">
        Ask whoever sent it for a fresh one.
      </p>
      <DownloadLine />
    </div>
  );
}

/** A download link ALWAYS: half the audience never installed Dopl. */
function DownloadLine() {
  return (
    <p className="text-caption text-text-secondary">
      Don&apos;t have the app yet?{" "}
      <a href="/download" className={PANEL_LINK}>
        Download Dopl
      </a>
      .
    </p>
  );
}
