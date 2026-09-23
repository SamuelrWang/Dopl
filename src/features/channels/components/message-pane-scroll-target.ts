/** The transcript's scroll-to-message signal, and what a target outside the loaded rows says. */

/** `nonce` exists so clicking the same mention twice re-scrolls. */
export interface ScrollTarget {
  messageId: string;
  nonce: number;
}

/** Shown when the target is not in the loaded transcript; promises no remedy, since the pane has none (INVARIANTS §9). */
export const SCROLL_TARGET_MISSING_NOTE =
  "That message is older than the loaded history, so the transcript did not move.";

/** How long the flash tint stands on a found row. */
export const FLASH_MS = 1600;

/** How long the missing-target note stands — longer than the flash, because it is read. */
export const MISSING_NOTICE_MS = 6000;
