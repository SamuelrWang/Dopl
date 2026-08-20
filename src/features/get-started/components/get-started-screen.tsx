"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DOWNLOAD_URL } from "@/features/marketing/constants";
import { AUTH_GLASS_SLOT_ID } from "@/shared/layout/auth-split";
import { InstallAnimation } from "./install-animation";

export interface GetStartedScreenProps {
  /** dmg name from the release feed, resolved server-side; null when the feed
   *  could not be read — a NORMAL answer, copy just stops naming a file.
   *  See `shared/version/mac-download.ts`. */
  asset: string | null;
}

/** Paint budget before the download starts. */
const AUTOSTART_DELAY_MS = 500;

/**
 * "Open Dopl in 3 steps" — where a web sign-in lands. Two audiences: new
 * accounts from landing "Get Started", and returning users bounced off a
 * retired app route (this page is the retirement plan's `/retired`) — hence
 * instruction copy. Heading promises three steps, so keep exactly three.
 *
 * ⚠ This is the FORM-COLUMN HALF of the shared `(auth)` split layout — the
 * banner, glass and brand live in `src/app/(auth)/layout.tsx` and persist
 * across the `/authenticate` → here navigation, which is what makes that
 * transition seamless. The install animation is PORTALED onto the layout's
 * glass (`AUTH_GLASS_SLOT_ID`); rendering it inline here would put it in the
 * left column. Styling lives in `../get-started.css`, matched to the auth
 * form column's type.
 */
export function GetStartedScreen({ asset }: GetStartedScreenProps) {
  const sink = useAutoDownload();

  return (
    <>
      <div className="gs-copy">
        <h1 className="gs-title">Open Dopl in 3 steps</h1>

        <ol className="gs-steps">
          <Step n={1}>Open your Downloads folder.</Step>
          <Step n={2}>
            {asset ? (
              <>
                Double-click <code className="gs-code">{asset}</code>.
              </>
            ) : (
              <>Double-click the Dopl installer you just downloaded.</>
            )}
          </Step>
          <Step n={3}>Drag Dopl into Applications, open it, and sign in.</Step>
        </ol>

        <div className="gs-retry">
          <span className="gs-retry-note">Not working?</span>
          {/* ⚠ REAL link, not a re-run of the effect: auto-start fails silently
              (`useAutoDownload`), so recovery must be a user click. Kit pill —
              `auth-btn-3d` is the auth surfaces' button face. */}
          <a href={DOWNLOAD_URL} className="auth-btn-3d gs-retry-btn">
            Try again
          </a>
        </div>
      </div>

      <GlassSlot>
        <InstallAnimation />
      </GlassSlot>

      {sink}
    </>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="gs-step">
      <span className="gs-step-n">{n}</span>
      <span className="gs-step-body">{children}</span>
    </li>
  );
}

/** Project children onto the shared layout's glass panel. Mount-gated: the
 *  slot is layout-owned DOM, only findable client-side. The rAF defer keeps the
 *  lookup out of the effect's synchronous body (react-hooks/set-state-in-effect)
 *  and costs one frame nobody sees — the panel fades in over 500ms anyway. */
function GlassSlot({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setTarget(document.getElementById(AUTH_GLASS_SLOT_ID));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return target ? createPortal(children, target) : null;
}

/**
 * Starts the download once after mount; returns the element doing it.
 *
 * ⚠ Zero-sized same-origin IFRAME — never `location.assign` or `<a download>`.
 * Sad path: asset name is cached 10min, so a release inside that window makes
 * `/releases/latest/download/<stale name>` a GitHub 404 PAGE (so is the
 * resolver's releases-page fallback). Top-level navigation COMMITS to it and
 * the instructions are gone; an iframe hits `X-Frame-Options: deny` and fails
 * silently. `<a download>` drops its attribute across a cross-origin redirect.
 *
 * ⚠ NOT `sandbox`ed, NOT `display:none`: Chrome blocks downloads from sandboxed
 * frames without `allow-downloads`; display:none frames may never load.
 *
 * Fires once — src is state on a timer cleanup cancels, so StrictMode's double
 * mount schedules twice and lands once.
 */
function useAutoDownload(): ReactNode {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    // Beat so the page paints before the download shelf animates over it.
    const timer = window.setTimeout(() => setSrc(DOWNLOAD_URL), AUTOSTART_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!src) return null;
  return <iframe className="gs-sink" src={src} title="Dopl download" tabIndex={-1} aria-hidden="true" />;
}
