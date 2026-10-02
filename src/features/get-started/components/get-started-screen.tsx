"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DOWNLOAD_URL } from "@/features/marketing/constants";
import { AUTH_GLASS_SLOT_ID } from "@/shared/layout/auth-split";
import { InstallAnimation } from "./install-animation";

export interface GetStartedScreenProps {
  /** dmg name from the release feed (`shared/version/mac-download.ts`); null is
   *  a NORMAL answer — copy just stops naming a file. */
  asset: string | null;
  /** `dopl://open/{segment}` when this visit named a workspace (`?workspace=`).
   *  ⚠ Already VALIDATED by the page — this component never parses a URL. */
  openLink?: string | null;
}

/** Paint budget before the download starts. */
const AUTOSTART_DELAY_MS = 500;

/**
 * "Open Dopl in 3 steps" — where a web sign-in lands (new accounts, and users
 * bounced off a retired app route). Heading promises three steps; keep three.
 *
 * ⚠ FORM-COLUMN HALF of the `(auth)` split layout (`src/app/(auth)/layout.tsx`
 * owns banner/glass/brand). The install animation is PORTALED onto the glass
 * (`AUTH_GLASS_SLOT_ID`); inline it would land in the left column.
 */
export function GetStartedScreen({
  asset,
  openLink = null,
}: GetStartedScreenProps) {
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
          {/* ⚠ REAL link: auto-start fails silently, so recovery is a click. */}
          <a href={DOWNLOAD_URL} className="auth-btn-3d gs-retry-btn">
            Try again
          </a>
        </div>

        {/* 🔒 The workspace this visit named (2026-09-10): an invite accepted
            with no app finishes here, or the invitation is forgotten.
            ⚠ NOT auto-navigated — a protocol launch would interrupt the
            in-flight download. Below the steps: it is not a fourth step. */}
        {openLink && (
          <div className="gs-retry">
            <span className="gs-retry-note">Already installed?</span>
            <a href={openLink} className="auth-btn-3d gs-retry-btn">
              Open the workspace
            </a>
          </div>
        )}
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

/** Portal children onto the layout's glass panel (client-only DOM). rAF keeps
 *  the setState out of the effect body (react-hooks/set-state-in-effect). */
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
 * ⚠ Zero-sized IFRAME — never `location.assign` or `<a download>`. A stale
 * cached asset name 404s on GitHub: top-level navigation would commit to that
 * page and lose the instructions; an iframe hits `X-Frame-Options: deny` and
 * fails silently. `<a download>` drops across a cross-origin redirect.
 *
 * ⚠ NOT `sandbox`ed (blocks downloads), NOT `display:none` (may never load).
 * Timer cleanup makes StrictMode's double mount land once.
 */
function useAutoDownload(): ReactNode {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    // Let the page paint before the download shelf animates over it.
    const timer = window.setTimeout(() => setSrc(DOWNLOAD_URL), AUTOSTART_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!src) return null;
  return <iframe className="gs-sink" src={src} title="Dopl download" tabIndex={-1} aria-hidden="true" />;
}
