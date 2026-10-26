"use client";

/**
 * SendButton — THE composer send affordance. The glyph is inline SVG — no external asset,
 * nothing built from a string. The face is the kit's `.send-round` (globals.css / kit.css),
 * never re-derived here.
 */

const SEND_LABEL = "Send";

export function SendButton({
  disabled,
  onClick,
  label = SEND_LABEL,
  title,
}: {
  disabled?: boolean;
  onClick: () => void;
  /** Accessible-name override. */
  label?: string;
  /** Hover text: a DISABLED send must say WHY (INVARIANTS §8, rule 4 — a control that swallows
   *  the click is a surface claiming to have sent something it did not). */
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className="send-round flex h-[30px] w-[30px] shrink-0 items-center justify-center p-0"
    >
      <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden focusable="false" className="block">
        <path
          d="M8 13V3.6M8 3.2 3.9 7.3M8 3.2l4.1 4.1"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
