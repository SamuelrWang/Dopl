/** Faux macOS notification. Box comes from the glass wrapper
 *  (use-banner-scrub.ts), fade from `--lp-notif-opacity` on the scene. While
 *  the glass grows, the card is pinned at its SEAT geometry
 *  (`--lp-notif-w/dx/dy`, same file) so it only fades — nothing slides or
 *  re-wraps (Samuel 2026-10-14). */
export function NotificationCard() {
  return (
    <div className="lp-banner-notif">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/favicons/android-chrome-512x512.png"
        alt=""
        className="lp-banner-notif-mark"
        width={38}
        height={38}
        draggable={false}
      />
      <div className="lp-banner-notif-body">
        <p className="lp-banner-notif-title">Dopl: Agent Request</p>
        {/* Matches the demo it opens into (`banner-demo/demo-transcript.ts`):
            #tech-debt, where Cleanup Planner launches three coders on session
            teardown (Samuel 2026-10-14; the old line was an older demo's). */}
        <p className="lp-banner-notif-msg">
          Orchestrator agent asks to launch 3 coders in #tech-debt to fix session teardown.
        </p>
      </div>
      <span className="lp-banner-notif-time">now</span>
    </div>
  );
}
