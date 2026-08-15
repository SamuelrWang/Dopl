/**
 * The install, drawn: browser hands over the dmg, volume mounts, app dragged
 * into Applications. Loops with a beat of rest.
 *
 * ⚠ TIMELINE LIVES IN THE STYLESHEET, not here — every node below is static
 * with a class; ten keyframe tracks share one `--gs-dur` clock so they cannot
 * drift. No JS, so it costs nothing on the main thread during the download.
 * Positions are literal coords in a 640×660 space; composition + clock argued
 * in `install-animation.css`.
 *
 * Decorative: `aria-hidden`, every fact restated in the numbered steps.
 */

import type { ReactNode } from "react";

/** Only real asset in the drawing — same mark the dock shows. */
const APP_ICON = "/favicons/android-chrome-512x512.png";

export function InstallAnimation() {
  return (
    <div className="gs-stage-frame" aria-hidden="true">
      <div className="gs-stage">
        <BrowserFragment />
        <DownloadChip />
        <VolumeWindow />
        <CursorIcon />
      </div>
    </div>
  );
}

/** Top anchor: browser window, toolbar row only. Live part is the downloads
 *  button — drawn pre-highlighted, pressed on the click beat. */
function BrowserFragment() {
  return (
    <div className="gs-browser">
      <span className="gs-tab" />
      <div className="gs-toolbar">
        <span className="gs-tool gs-tool--reload">
          <ReloadIcon />
        </span>
        <span className="gs-urlbar" />
        <span className="gs-tray">
          <DownloadIcon />
        </span>
        <span className="gs-tool gs-tool--share">
          <ShareIcon />
        </span>
        <span className="gs-tool gs-tool--newtab">
          <PlusIcon />
        </span>
        <span className="gs-tool gs-tool--tabs">
          <TabsIcon />
        </span>
      </div>
      <div className="gs-page-body" />
    </div>
  );
}

/** Download row dropping out of the toolbar. ⚠ Name stays VERSION-LESS — it
 *  loops forever and must not contradict the resolved file name beside it. */
function DownloadChip() {
  return (
    <div className="gs-chip">
      <div className="gs-chip-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={APP_ICON} alt="" width={20} height={20} className="gs-chip-icon" />
        <span className="gs-chip-name">Dopl-arm64.dmg</span>
      </div>
      <div className="gs-chip-track">
        <div className="gs-chip-bar" />
      </div>
    </div>
  );
}

/** Mounted volume: app left, Applications alias right. */
function VolumeWindow() {
  return (
    <div className="gs-dmg">
      <div className="gs-dmg-bar">
        <span className="gs-lights">
          <i className="gs-light" />
          <i className="gs-light" />
          <i className="gs-light" />
        </span>
        <span className="gs-dmg-title">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={APP_ICON} alt="" width={18} height={18} className="gs-dmg-glyph" />
          Dopl
        </span>
      </div>
      <div className="gs-dmg-body">
        <div className="gs-tile gs-tile--app">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={APP_ICON} alt="" width={96} height={96} className="gs-app-icon" />
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
  const path =
    "M5 2.5 19.2 11.3a.6.6 0 0 1-.2 1.1l-6 1.2a.6.6 0 0 0-.4.3l-2.7 5.5a.6.6 0 0 1-1.1-.1L4.3 3.2a.6.6 0 0 1 .7-.7Z";
  return (
    <svg className="gs-cursor" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={path} />
      <path className="gs-cursor-edge" d={path} fill="none" strokeWidth="1.3" />
    </svg>
  );
}

/** Shared geometry for the stroked toolbar glyphs. */
function ToolGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function ReloadIcon() {
  return (
    <ToolGlyph>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.5h-4.5" />
    </ToolGlyph>
  );
}

function ShareIcon() {
  return (
    <ToolGlyph>
      <path d="M12 15V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
    </ToolGlyph>
  );
}

function PlusIcon() {
  return (
    <ToolGlyph>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </ToolGlyph>
  );
}

function TabsIcon() {
  return (
    <ToolGlyph>
      <rect x="3" y="7" width="13" height="13" rx="2" />
      <path d="M8 4h11a1 1 0 0 1 1 1v11" />
    </ToolGlyph>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
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
      <path d="M2 8h56" strokeDasharray="4 5" />
      <path d="m52 3 6 5-6 5" />
    </svg>
  );
}

/** Applications alias — filled macOS folder in the page accent. */
function FolderIcon() {
  return (
    <svg className="gs-folder-icon" viewBox="0 0 24 20" fill="currentColor" aria-hidden="true">
      <path
        d="M1 3.6A2.6 2.6 0 0 1 3.6 1h5.2c.69 0 1.35.27 1.84.76L12.2 3.2h8.2A2.6 2.6 0 0 1 23 5.8v1.6H1V3.6Z"
        opacity="0.62"
      />
      <path d="M1 7.4h22v9A2.6 2.6 0 0 1 20.4 19H3.6A2.6 2.6 0 0 1 1 16.4v-9Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 13 4.5 4.5L19 7" />
    </svg>
  );
}
