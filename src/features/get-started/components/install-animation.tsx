/**
 * The install, drawn: a browser downloads the dmg, the disk image mounts, the
 * app is dragged into Applications. Loops with a beat of rest.
 *
 * WHY DIVS AND KEYFRAMES AND NOT A VIDEO, A GIF OR LOTTIE. This is a picture of
 * two grey windows and a cursor. As markup it is a few kilobytes that ship with
 * the HTML, stay crisp at any density, inherit the page's own hairlines and
 * greys from `get-started.css`, and have a reduced-motion state that is one
 * media query rather than a second asset. As an mp4 or a json payload it is a
 * network request that can be slow, a fixed resolution that can be blurry, a
 * palette that drifts from the page the day either changes, and — with Lottie —
 * a runtime dependency in the critical path of a page whose entire job is to
 * hand somebody a file.
 *
 * THE TIMELINE LIVES IN THE STYLESHEET, NOT HERE. Every element below is a
 * static node with a class; nine independent keyframe tracks share the single
 * `--gs-dur` clock so they cannot drift apart. There is no JS driving it, which
 * means it costs nothing on the main thread while the download is starting.
 *
 * DECORATIVE. `aria-hidden` — every fact it depicts is also written out in the
 * numbered steps beside it, which is the version a screen reader gets.
 */
export function InstallAnimation() {
  return (
    <div className="gs-stage-frame" aria-hidden="true">
      <div className="gs-stage">
        <MockBrowser />
        <DownloadChip />
        <MockDiskImage />
        <CursorIcon />
      </div>
    </div>
  );
}

/** Toolbar + a blank page. The only live part is the downloads button. */
function MockBrowser() {
  return (
    <div className="gs-browser">
      <div className="gs-toolbar">
        <span className="gs-lights">
          <i className="gs-light" />
          <i className="gs-light" />
          <i className="gs-light" />
        </span>
        <span className="gs-urlbar" />
        <span className="gs-tray">
          <TrayIcon />
        </span>
      </div>
      <div className="gs-page-body">
        <span className="gs-skel" style={{ width: "62%" }} />
        <span className="gs-skel" style={{ width: "84%" }} />
        <span className="gs-skel" style={{ width: "48%" }} />
        <span className="gs-skel" style={{ width: "70%" }} />
      </div>
    </div>
  );
}

/**
 * The download row that drops out of the toolbar. The name here is the
 * VERSION-LESS one on purpose: this is a drawing, it loops forever, and it must
 * not be able to contradict the real file name resolved for the copy beside it.
 */
function DownloadChip() {
  return (
    <div className="gs-chip">
      <div className="gs-chip-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/favicons/android-chrome-512x512.png" alt="" width={20} height={20} style={{ borderRadius: 5 }} />
        <span className="gs-chip-name">Dopl-arm64.dmg</span>
      </div>
      <div className="gs-chip-track">
        <div className="gs-chip-bar" />
      </div>
    </div>
  );
}

/** The mounted volume: the app on the left, the Applications alias on the right. */
function MockDiskImage() {
  return (
    <div className="gs-dmg">
      <div className="gs-dmg-bar">
        <span className="gs-lights">
          <i className="gs-light" />
          <i className="gs-light" />
          <i className="gs-light" />
        </span>
        <span className="gs-dmg-title">Dopl</span>
      </div>
      <div className="gs-dmg-body">
        <div className="gs-tile gs-tile--app">
          {/* The real app icon, the same mark the login screen and the dock
              show — a drawing of an install that shows a placeholder is a
              drawing of somebody else's install. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/favicons/android-chrome-512x512.png"
            alt=""
            width={64}
            height={64}
            className="gs-app-icon"
          />
        </div>
        <span className="gs-tile-label gs-tile-label--app">Dopl</span>

        <ArrowIcon />

        <div className="gs-tile gs-tile--folder">
          <FolderIcon />
        </div>
        <span className="gs-tile-label gs-tile-label--folder">Applications</span>

        <span className="gs-check">
          <CheckIcon />
        </span>
      </div>
    </div>
  );
}

function CursorIcon() {
  return (
    <svg className="gs-cursor" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 2.5 19.2 11.3a.6.6 0 0 1-.2 1.1l-6 1.2a.6.6 0 0 0-.4.3l-2.7 5.5a.6.6 0 0 1-1.1-.1L4.3 3.2a.6.6 0 0 1 .7-.7Z" />
      <path d="M5 2.5 19.2 11.3a.6.6 0 0 1-.2 1.1l-6 1.2a.6.6 0 0 0-.4.3l-2.7 5.5a.6.6 0 0 1-1.1-.1L4.3 3.2a.6.6 0 0 1 .7-.7Z" fill="none" stroke="#fff" strokeWidth="1.3" />
    </svg>
  );
}

function TrayIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="gs-arrow" viewBox="0 0 62 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 8h56" strokeDasharray="4 5" />
      <path d="m52 3 6 5-6 5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#7c828f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 13 4.5 4.5L19 7" />
    </svg>
  );
}
