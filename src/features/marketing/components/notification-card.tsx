/**
 * The banner's opening beat: a Dopl desktop notification, seated top-right of
 * the picture, sized and laid out like a real macOS notification (app icon at
 * the left, app/title line, message body, "now" at the right).
 *
 * The copy is a REAL product surface — a channels consent request, where one
 * member's agent asks for approval before posting into a channel it does not
 * own. It is the thing the scene then clicks.
 *
 * Purely presentational. Its box is the glass wrapper (driven by
 * use-banner-scrub.ts) and its fade is `--lp-notif-opacity` on the scene; this
 * component owns neither. The icon is the existing favicon asset — the same one
 * `logo.tsx` uses for the brand lockup — so no new asset enters the tree.
 */
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
