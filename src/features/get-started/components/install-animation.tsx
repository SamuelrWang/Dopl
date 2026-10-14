/**
 * The install, drawn: a macOS DMG Finder window — Dopl icon, a dashed block
 * arrow, the Applications alias — with a cursor that presses the icon, drags a
 * translucent copy of it onto the folder and lets go. Loops with a long beat of
 * rest.
 *
 * ⚠ TIMELINE LIVES IN THE STYLESHEET (`install-animation.css`), not here —
 * every node below is static with a class, and every keyframe track shares one
 * `--gs-t` clock so they cannot drift. No JS on the main thread during the
 * download.
 *
 * ⚠ THE DRAGGED COPY RIDES INSIDE THE HAND (Samuel, 2026-10-14: "It doesn't
 * actually drag the actual icon"). `.gs-ghost` is a CHILD of the same two
 * movers as the cursor (`.gs-hand-y` > `.gs-hand-x`), so cursor and copy share
 * one transform at every frame BY CONSTRUCTION — never give the copy its own
 * translate tracks again; two tracks with matched percentages still drift
 * apart the moment their easings differ.
 *
 * ⚠ The movers are an X track inside a Y track with different easings per
 * axis — that is what makes the drag an arc, not a point sliding down a wire.
 *
 * ⚠ The window IS the glass's white card — inset by the slot's
 * `--glass-card-inset`, sized by the glass, never by this markup — and the
 * drawing rides a fixed-size `.gs-stage` scaled to the body. See the
 * stylesheet's header.
 *
 * Decorative: `aria-hidden`, every fact restated in the numbered steps.
 */

import { DemoCursorGlyph } from "@/features/marketing/components/demo-cursor";

/** Same mark the dock shows. */
const APP_ICON = "/favicons/android-chrome-512x512.png";
/** THE REAL macOS Applications folder — extracted from this platform's own
 *  `CoreTypes.bundle › ApplicationsFolderIcon.icns`, 256px webp. */
const APPS_FOLDER_ICON = "/img/get-started/applications-folder.webp";

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
          <div className="gs-stage">
            <div className="gs-well gs-well--app">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={APP_ICON} alt="" className="gs-app-icon" draggable={false} />
              <span className="gs-well-label">Dopl</span>
            </div>

            <ArrowIcon />

            <div className="gs-well gs-well--apps">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={APPS_FOLDER_ICON} alt="" className="gs-folder-icon" draggable={false} />
              <span className="gs-well-label">Applications</span>
              <span className="gs-check">
                <CheckIcon />
              </span>
            </div>

            {/* The hand: cursor + the translucent copy it carries, on ONE pair
                of movers. The copy is first so the pointer paints over it. */}
            <div className="gs-hand-y">
              <div className="gs-hand-x">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={APP_ICON} alt="" className="gs-ghost" draggable={false} />
                <div className="gs-pointer">
                  <DemoCursorGlyph />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Hollow block arrow, dashed — the "drag this way" mark DMGs draw between the
 *  app and the alias. Not a system asset (every DMG draws its own); this one is
 *  ours. viewBox is 1:1 with stage px. */
function ArrowIcon() {
  return (
    <svg className="gs-arrow" viewBox="0 0 70 34" fill="none" aria-hidden="true">
      <path
        d="M1.5 11.5H44V2l24.5 15L44 32v-9.5H1.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        strokeLinejoin="round"
      />
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
