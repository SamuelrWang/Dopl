/**
 * The install, drawn: a macOS DMG Finder window — Dopl icon, a dashed block
 * arrow, the Applications alias — with a cursor that clicks the Dopl icon,
 * PICKS IT UP, carries it onto the folder and drops it in. Loops with a long
 * beat of rest.
 *
 * ⚠ TIMELINE LIVES IN THE STYLESHEET (`install-animation.css`), not here —
 * every node below is static with a class, and every keyframe track shares one
 * `--gs-t` clock so they cannot drift. No JS on the main thread during the
 * download.
 *
 * ⚠ THE DRAGGED THING IS THE ICON ITSELF (Samuel, 2026-10-14: "the logo
 * doesn't move … I want it to look like it clicks … that should pick up the
 * logo"). There is ONE Dopl icon and no copy: at rest it sits in its well, and
 * it lives inside the DRAG movers (`.gs-drag-y` > `.gs-drag-x`), which are
 * zero except while it is carried. The pointer rides the SAME drag movers plus
 * its own APPROACH movers (`.gs-hand-y` > `.gs-hand-x`) for the fly-in and the
 * exit — and the approach tracks are exactly zero for the whole carry. So
 * during the drag, pointer and icon share one transform BY CONSTRUCTION. A
 * translucent copy on the hand while the original stayed put read as "the
 * logo doesn't move" — never bring a second icon back.
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

import type { CSSProperties } from "react";
import { DemoCursorGlyph } from "@/features/marketing/components/demo-cursor";

/** Same mark the dock shows. */
const APP_ICON = "/favicons/android-chrome-512x512.png";
/** THE REAL macOS Applications folder — extracted from this platform's own
 *  `CoreTypes.bundle › ApplicationsFolderIcon.icns`, 256px webp. */
const APPS_FOLDER_ICON = "/img/get-started/applications-folder.webp";

/** The glint's mask: the icon's own alpha, so the sheen is exactly its squircle. */
const ICON_MASK = { "--gs-app-mask": `url(${APP_ICON})` } as CSSProperties;

export function InstallAnimation() {
  return (
    <div className="gs-glass-pad" aria-hidden="true" style={ICON_MASK}>
      <div className="gs-dmg">
        <div className="gs-dmg-bar">
          <span className="gs-lights">
            <i className="gs-light gs-light--close" />
            <i className="gs-light gs-light--min" />
            <i className="gs-light gs-light--zoom" />
          </span>
          <span className="gs-dmg-title">Dopl Installer</span>
        </div>

        <div className="gs-dmg-body">
          <div className="gs-stage">
            {/* The icon's home: an EMPTY spot (the icon itself is in the
                movers below) so the label keeps its place under it. The slot
                is the dotted silhouette left behind while the icon is away
                (Samuel 2026-10-15) — a shape, never a second icon. */}
            <div className="gs-well gs-well--app">
              <span className="gs-app-home">
                {/* The outline is an SVG stroke, not a CSS border: `dashed` cannot set
                    a dash length, and this must match the arrow's 1.5px "4 3" dash. */}
                <span className="gs-app-slot">
                  <svg viewBox="0 0 78 78" aria-hidden="true">
                    <rect
                      x="0.75"
                      y="0.75"
                      width="76.5"
                      height="76.5"
                      rx="17.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeDasharray="4 3"
                    />
                  </svg>
                </span>
              </span>
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

            {/* The drag: the Dopl icon ITSELF and the pointer on ONE pair of
                movers. The icon is first so the pointer paints over it; both
                come after the wells so they paint over the arrow and folder. */}
            <div className="gs-drag-y">
              <div className="gs-drag-x">
                <div className="gs-carry">
                  <span className="gs-contact" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={APP_ICON} alt="" className="gs-app-icon" draggable={false} />
                  <span className="gs-glint" />
                </div>
                <div className="gs-hand-y">
                  <div className="gs-hand-x">
                    <div className="gs-pointer">
                      <DemoCursorGlyph />
                    </div>
                  </div>
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
 *  ours. viewBox is 1:1 with stage px. 64×52 (~1.2:1, the reference DMGs'
 *  proportion — Samuel 2026-10-14: the 70×34 one was "too narrow"): a 22px
 *  shaft, a 48px-tall head, centred on y 26. */
function ArrowIcon() {
  return (
    <svg className="gs-arrow" viewBox="0 0 64 52" fill="none" aria-hidden="true">
      <path
        d="M1.5 15H36V2l26.5 24L36 50V37H1.5Z"
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
