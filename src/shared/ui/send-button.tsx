"use client";

/**
 * SendButton — THE composer send affordance. One button, two states: send at
 * rest, pause while the agent is mid-turn. Glyphs are inline SVG — no external
 * asset, nothing built from a string.
 *
 * ⚠ Raised/hover/active/disabled recipe is `.auth-btn-3d` from globals.css,
 * never re-derived here; glyph colour is the `text-on-cta` token. The desktop
 * session window (renderer/session/*) ships a CSS twin of this face because it
 * is a plain-<script> sandbox that cannot import React — keep them in sync.
 */

import { cn } from "@/shared/lib/utils";

export type SendButtonMode = "send" | "pause";

/** Accessible names — mirrors the session window's SEND_LABEL map. */
const SEND_LABEL: Record<SendButtonMode, string> = {
  send: "Send",
  pause: "Pause the agent",
};

export function sendButtonLabel(mode: SendButtonMode): string {
  return SEND_LABEL[mode] ?? SEND_LABEL.send;
}

export function SendButton({
  mode = "send",
  disabled,
  onClick,
  label,
  className,
}: {
  mode?: SendButtonMode;
  disabled?: boolean;
  onClick: () => void;
  /** Accessible-name override; defaults to the mode's label. */
  label?: string;
  /** Layout-only extras. Never restyle the face here. */
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label ?? sendButtonLabel(mode)}
      className={cn(
        "auth-btn-3d flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] p-0 text-text-on-cta",
        className
      )}
    >
      {mode === "pause" ? <PauseGlyph /> : <SendGlyph />}
    </button>
  );
}

/** ⚠ Path-identical to the session window's inline send glyph. */
function SendGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      aria-hidden
      focusable="false"
      className="block"
    >
      <path
        d="M8 13V3.6M8 3.2 3.9 7.3M8 3.2l4.1 4.1"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** ⚠ Geometry-identical to the session window's pause glyph. */
function PauseGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      aria-hidden
      focusable="false"
      className="block"
    >
      <rect x={4.4} y={3.6} width={2.6} height={8.8} rx={1.1} fill="currentColor" />
      <rect x={9} y={3.6} width={2.6} height={8.8} rx={1.1} fill="currentColor" />
    </svg>
  );
}
