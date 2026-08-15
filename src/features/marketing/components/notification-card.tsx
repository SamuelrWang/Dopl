/** Faux macOS notification. Box comes from the glass wrapper
 *  (use-banner-scrub.ts), fade from `--lp-notif-opacity` on the scene. */
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
        <p className="lp-banner-notif-title">Dopl — Agent request</p>
        <p className="lp-banner-notif-msg">
          Alex&apos;s agent asks to post in #launch: &ldquo;Runbook ready for review —
          approve?&rdquo;
        </p>
      </div>
      <span className="lp-banner-notif-time">now</span>
    </div>
  );
}
