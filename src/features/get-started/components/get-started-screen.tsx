"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DOWNLOAD_URL } from "@/features/marketing/constants";
import { Logo } from "@/features/marketing/components/logo";
import { InstallAnimation } from "./install-animation";

export interface GetStartedScreenProps {
  /**
   * The real dmg name from the release feed (`Dopl-1.8.4-arm64.dmg`), resolved
   * server-side, or null when the feed could not be read. Null is a normal
   * answer and the copy simply stops naming a file — see
   * `shared/version/mac-download.ts`.
   */
  asset: string | null;
}

/** How long the page gets to paint before the download starts. */
const AUTOSTART_DELAY_MS = 500;

/**
 * "Open Dopl in 3 steps" — the page a web sign-in lands on.
 *
 * TWO AUDIENCES, ONE PAGE. A brand-new account arrives here from the landing
 * page's "Get Started"; after the website retirement's Stage B flip, a returning
 * signed-in user bounced off a retired app route arrives here too
 * (docs/migration-research/website-retirement-plan.md §2.2 — this page is that
 * plan's `/retired`). Both are being told the same thing and both need the same
 * file, so the copy is an instruction rather than a congratulation.
 *
 * THE SHAPE IS THE REFERENCE'S, THE STEPS ARE OURS. Two full-height fields:
 * instructions on the dark left, the install drawn on the deep right. The
 * heading promises three steps, so there are three — the fourth ("open Dopl and
 * sign in") folds into the drag, because it is the same motion at the same
 * moment and a list that outruns its own heading is worse than a long line.
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
            {/* A REAL LINK, not a re-run of the effect. The auto-start is
                deliberately silent when it fails (see `useAutoDownload`), so the
                recovery has to be a click the person makes themselves — and a
                click is also the one navigation that is ALLOWED to leave this
                page, because they chose it. */}
            <a href={DOWNLOAD_URL}>Try again</a>.
          </p>
        </div>

        {/* The reference's bottom-left ornament slot, carrying signal instead:
            the download starts by itself and without a sound, so the live
            region that says so is what anchors this corner. */}
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
 * Starts the download once, shortly after mount, and returns the element that
 * does it.
 *
 * A ZERO-SIZED SAME-ORIGIN IFRAME, NOT `location.assign`, AND THE DIFFERENCE IS
 * NOT THEORETICAL. Both start the download identically on the happy path:
 * `/download` is same-origin, 307s to a GitHub release asset, and the asset
 * comes back `content-disposition: attachment`, so the browser takes the file
 * and never commits the navigation. They differ entirely on the SAD path, and
 * the sad path was live while this was being written — the resolver's asset name
 * is cached for ten minutes, a release published inside that window makes the
 * cached name wrong, and `/releases/latest/download/<yesterday's name>` is a
 * GitHub 404 PAGE, not a file. A top-level navigation to that page commits: the
 * visitor is thrown onto a GitHub 404 and the install instructions are gone. In
 * an iframe the same response is `X-Frame-Options: deny`, the frame fails
 * silently, and the page — including "Not working? Try again" — is still on
 * screen. The same holds for the resolver's designed fallback to the releases
 * page, which is HTML too.
 *
 * `<a download>` was the third option and the worst: the attribute is dropped
 * across a cross-origin redirect, so its behaviour on exactly these responses is
 * browser-specific.
 *
 * The frame is NOT `sandbox`ed and NOT `display:none` — Chrome blocks downloads
 * from sandboxed frames without `allow-downloads`, and a display:none frame is
 * not guaranteed to load at all. Zero-size and inert is the shape that both
 * loads and downloads.
 *
 * FIRES ONCE. The src is state, set on a timer the cleanup cancels, so React
 * StrictMode's double mount schedules twice and lands once.
 */
function useAutoDownload(): ReactNode {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    // A beat, so the page has painted before the browser's download shelf
    // animates in over it. Arriving to a download bar and no explanation is the
    // experience this page exists to replace.
    const timer = window.setTimeout(() => setSrc(DOWNLOAD_URL), AUTOSTART_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!src) return null;
  return <iframe className="gs-sink" src={src} title="Dopl download" tabIndex={-1} aria-hidden="true" />;
}
