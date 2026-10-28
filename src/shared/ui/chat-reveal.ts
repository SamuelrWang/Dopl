/**
 * Chat-message reveal, shared by the scripted chat demos: onboarding step 3
 * (`features/onboarding/components/agents-chat-transcript.tsx`) and the landing
 * hero's channel demo (`features/marketing/components/banner-demo`).
 *
 * Two motions:
 *   - WORD: a typed message lands one word at a time; each word rises in.
 *   - ROW:  a message (or line) that arrives whole fades and slides in.
 *
 * Pure strings + one pure splitter, no React, so a scrubbed timeline can drive
 * the word COUNT while the keyframes handle the per-word ease.
 */

export const CHAT_REVEAL_KEYFRAMES = `
@keyframes dopl-ch-word { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
@keyframes dopl-ch-row { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
`;

/** One word arriving (`animation` shorthand). */
export const CHAT_WORD_ANIMATION = "dopl-ch-word 220ms ease-out both";
/** One whole row arriving (`animation` shorthand). */
export const CHAT_ROW_ANIMATION = "dopl-ch-row 260ms ease-out both";

/** A text's words, whitespace-collapsed. The unit both reveals count in. */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}
