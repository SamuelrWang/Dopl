/**
 * The install, drawn: a macOS DMG Finder window — Dopl icon, Applications
 * alias — with a cursor that picks the icon up and drags it across. Loops with
 * a long beat of rest.
 *
 * ⚠ TIMELINE LIVES IN THE STYLESHEET (`install-animation.css`), not here —
 * every node below is static with a class, and every keyframe track shares one
 * `--gs-t` clock so they cannot drift. No JS on the main thread during the
 * download.
 *
 * ⚠ The cursor and ghost each ride TWO nested wrappers — an X mover inside a Y
 * mover — with different easings per axis. That is what makes the drag read as
 * a hand (a shallow arc, decelerating onto its targets) instead of a point
 * sliding down a wire; a single translate track cannot curve.
 *
 * Decorative: `aria-hidden`, every fact restated in the numbered steps.
 */

/** Only real asset in the drawing — same mark the dock shows. */
const APP_ICON = "/favicons/android-chrome-512x512.png";

export function InstallAnimation() {
  return (
    <div className="gs-glass-pad" aria-hidden="true">
      <div className="gs-dmg">
        <div className="gs-dmg-bar">
          <span className="gs-lights">
            <i className="gs-light gs-light--close" />
            <i className="gs-light gs-light--min" />
            <i className="gs-light gs-light--zoom" />
          </span>
          <span className="gs-dmg-title">Dopl</span>
        </div>

        <div className="gs-dmg-body">
          <div className="gs-well gs-well--app">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={APP_ICON} alt="" className="gs-app-icon" draggable={false} />
            <span className="gs-well-label">Dopl</span>
          </div>

          <ArrowIcon />

          <div className="gs-well gs-well--apps">
            <FolderIcon />
            <span className="gs-well-label">Applications</span>
            <span className="gs-check">
              <CheckIcon />
            </span>
          </div>

          {/* Translucent copy of the app icon that makes the trip. */}
          <div className="gs-ghost-y">
            <div className="gs-ghost-x">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={APP_ICON} alt="" className="gs-ghost" draggable={false} />
            </div>
          </div>

          <div className="gs-cursor-y">
            <div className="gs-cursor-x">
              <CursorIcon />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The real macOS arrow: black body, white outline, tip at the svg origin so
 *  the movers' translate IS the tip position. */
function CursorIcon() {
  return (
    <svg className="gs-cursor" viewBox="0 0 17 24" aria-hidden="true">
      <path
        d="M1 1v17.4l4.6-4.2 2.8 6.5 3.1-1.3-2.8-6.4 6.2-.6L1 1Z"
        fill="#0b0b0c"
        stroke="#ffffff"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="gs-arrow"
      viewBox="0 0 62 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 8h52" strokeDasharray="4 5" />
      <path d="m50 3 6 5-6 5" />
    </svg>
  );
}

/** Applications alias — macOS-blue folder. */
function FolderIcon() {
  return (
    <svg className="gs-folder-icon" viewBox="0 0 24 20" aria-hidden="true">
      <path
        d="M1 3.6A2.6 2.6 0 0 1 3.6 1h5.2c.69 0 1.35.27 1.84.76L12.2 3.2h8.2A2.6 2.6 0 0 1 23 5.8v1.6H1V3.6Z"
        fill="#3f9bf4"
      />
      <path d="M1 7.4h22v9A2.6 2.6 0 0 1 20.4 19H3.6A2.6 2.6 0 0 1 1 16.4v-9Z" fill="#5eaef7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ffffff"
      strokeWidth="3.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 13 4.5 4.5L19 7" />
    </svg>
  );
}
