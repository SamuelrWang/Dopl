"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DOWNLOAD_URL } from "@/features/marketing/constants";
import { Logo } from "@/features/marketing/components/logo";
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
 */
export function GetStartedScreen({ asset }: GetStartedScreenProps) {
  const sink = useAutoDownload();

  return (
    <div className="lp gs">
      <section className="gs-panel">
        <header className="gs-brand">
          <Logo />
        </header>

        <div className="gs-copy">
          <h1 className="gs-title">Open Dopl in 3 steps:</h1>

          <ol className="gs-steps">
            <li>Open your Downloads folder.</li>
            <li>
              {asset ? (
                <>
                  Double-click <code>{asset}</code>.
                </>
              ) : (
                <>Double-click the Dopl installer you just downloaded.</>
              )}
            </li>
            <li>Drag Dopl into Applications, open it, and sign in.</li>
          </ol>

          <p className="gs-retry">
            Not working?{" "}
            {/* ⚠ REAL link, not a re-run of the effect: auto-start fails
                silently (`useAutoDownload`), so recovery must be a user click —
                also the only navigation allowed to leave this page. */}
            <a href={DOWNLOAD_URL}>Try again</a>.
          </p>
        </div>

        {/* Live region: the download starts silently, so this is the only
            thing that says so. */}
        <footer className="gs-footer">
          <p className="gs-status" role="status">
            <span className="gs-status-dot" aria-hidden="true" />
            <span>
              Downloading <span className="gs-status-file">{asset ?? "the Dopl installer"}</span>
            </span>
          </p>
          <p className="gs-foot">macOS on Apple silicon.</p>
        </footer>
      </section>

      <section className="gs-field">
        <InstallAnimation />
      </section>

      {sink}
    </div>
  );
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
