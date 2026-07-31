"use client";

/**
 * SendButton — THE composer send affordance, shared by every Dopl composer.
 *
 * One button, two states. At rest it is the raised black circle with a white
 * up-arrow that sends the draft; while the agent is mid-turn it MORPHS into a
 * pause control that interrupts. Both glyphs are inline SVG, so nothing is ever
 * built from a string and no external asset is fetched.
 *
 * The look is the desktop session window's `.send-btn` (30px face, 8px radius,
 * `.auth-btn-3d` black gradient + border + shadow, 16px white glyph) expressed
 * with kit classes and tokens ONLY — the raised/hover/active/disabled recipe is
 * `.auth-btn-3d` from globals.css, never re-derived here, and the glyph color is
 * the `text-on-cta` token. Extracted so the main app and the session window do
 * not each carry their own copy of that recipe.
 *
 * The session window (renderer/session/*) still ships its own CSS twin because
 * it is a plain-<script> sandbox that cannot import React; pointing it at this
 * component is a follow-up owned by whoever owns renderer/session/.
 */

import { cn } from "@/shared/lib/utils";

/** Which affordance the one button is showing right now. */
export type SendButtonMode = "send" | "pause";

/** Default accessible names, mirroring the session window's SEND_LABEL map. */
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
  /** "send" (up arrow) at rest; "pause" while a turn is running. */
  mode?: SendButtonMode;
  disabled?: boolean;
  onClick: () => void;
  /** Accessible name override; defaults to the mode's label. */
  label?: string;
  /** Layout-only extras (margins/alignment). Never restyle the face here. */
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

/** The up-arrow, path-identical to the session window's inline send glyph. */
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

/** The two pause bars, geometry-identical to the session window's glyph. */
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
