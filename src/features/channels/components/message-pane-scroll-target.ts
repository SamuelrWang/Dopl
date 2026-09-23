/**
 * THE TAGS INBOX'S SCROLL SIGNAL, AND WHAT A MISS SAYS OUT LOUD.
 *
 * ⚠ ITS OWN FILE AT §1's 500-LINE CAP (2026-09-22), AND THE SEAM IS A REASON TO
 * CHANGE RATHER THAN THE LINE COUNT THAT FORCED THE QUESTION.
 * `message-pane.tsx` owns the CHROME — two views over one column, the scroller,
 * the stick-to-bottom contract. THIS owns the CONTRACT BETWEEN TWO SURFACES: the
 * shape the Tags inbox hands the pane, and the sentence shown when the message it
 * names is not in the loaded transcript. One moves when the pane's layout moves;
 * the other moves when the inbox's signal or its copy does.
 *
 * ⚠ **RE-EXPORTED FROM `message-pane.tsx`, SO NO CALLER MOVED** — the idiom this
 * tree uses for every cap split (`repository-launch-types.ts`,
 * `selection-vocabulary.js`, `listener-identity.js`). `use-channels-selection.ts`
 * still imports `ScrollTarget` from `./message-pane` and is untouched.
 */

/**
 * The Tags inbox's scroll-to-message signal. NONCED: clicking the same mention
 * twice must re-scroll, and a plain `{messageId}` object would be swallowed the
 * moment somebody "optimizes" the state update with an equality check.
 */
export interface ScrollTarget {
  messageId: string;
  nonce: number;
}

/**
 * What a scroll target that is NOT IN THE LOADED TRANSCRIPT says out loud. The
 * click still marks the mention read and navigates; silently doing two of three
 * things is the failure. ⚠ IT PROMISES NO REMEDY, because there is none: this
 * pane has no page argument and no deeper read (INVARIANTS §9).
 */
export const SCROLL_TARGET_MISSING_NOTE =
  "That message is older than the loaded history, so the transcript did not move.";

/** How long the flash tint stands on a row that WAS found. */
export const FLASH_MS = 1600;

/** How long the "older than the loaded history" line stands. Longer than the
 *  flash: a tint is glanced at, a sentence is read. */
export const MISSING_NOTICE_MS = 6000;
