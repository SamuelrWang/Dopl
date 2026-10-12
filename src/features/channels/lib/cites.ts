/**
 * **CITATIONS — THE VOCABULARY, STATED ONCE** (Samuel's grammar B, card #4401,
 * 2026-10-12).
 *
 * A citation is **structured, not parsed**. An agent names the message it is
 * citing in a FIELD on the send; the server resolves that field once, at write
 * time, and stores a message id. Nothing downstream parses a number out of prose
 * to decide where a pill points.
 *
 * ⚠ **THAT IS WHY THIS FEATURE HAS NO CUTOVER DATE.** The alternative — reading
 * `#12` out of a body and deciding which namespace it belongs to — needed the
 * citing message's authoring time threaded to the renderer and a first-ever
 * production date constant, and it still left `#12` ambiguous against a global
 * `seq` that is valid in every room. Resolving once at the write deletes the
 * whole question: by the time a reader sees a citation it is already a row id.
 *
 * ⚠ **TWO KEYS, AND THE SECOND ONE IS WHAT TELLS OLD FROM NEW.**
 *
 *   `cites`     the resolved citations, re-stamped by the server from the
 *               validated field. Caller-supplied copies are STRIPPED
 *               (`service-writes-metadata.ts`), on `mentionedUserIds`' terms.
 *   `citeMode`  stamped on EVERY new row by
 *               `repository-messages.ts › insertMessage` — the single funnel
 *               every write passes through. Its PRESENCE is the discriminator:
 *               a row that has it was written under grammar B, so its prose
 *               numbers are not links; a row without it predates the rule and
 *               keeps the legacy `#NNNN` pills it has always had.
 *
 * ⚠ **ABSENCE CANNOT BE FORGED, PRESENCE MUST NOT BE.** A caller cannot make the
 * server omit the stamp, which is what makes "no stamp = legacy" trustworthy.
 * But a caller setting `citeMode` itself must not be able to opt a NEW message
 * back into legacy pills, so the stamp is written authoritatively at the funnel
 * and overwrites anything handed in.
 *
 * ⚠ **THE VERSION NUMBER STAYS ON THIS SIDE OF THE DTO.** The renderer is given
 * a three-state field (absent / empty / populated), never the integer — so a
 * future mode 3 is a change here and in the DTO, and not in every component that
 * draws a message.
 */

/** `metadata.cites` — the resolved citations, server-written. */
export const CITES_METADATA_KEY = "cites";

/** `metadata.citeMode` — the grammar a row was written under. */
export const CITE_MODE_METADATA_KEY = "citeMode";

/**
 * The mode every new row is stamped with.
 *
 * ⚠ **2, NOT 1, AND THE GAP IS DELIBERATE.** Mode 1 is the implicit legacy
 * grammar — prose `#NNNN` read as a global `seq` — and no row carries it,
 * because the rule it names predates the stamp. Numbering the current mode 2
 * keeps "unstamped" and "mode 1" from ever looking like different answers to the
 * same question.
 */
export const CITE_MODE_CURRENT = 2;

/**
 * One citation, as stored.
 *
 * ⚠ `messageId` IS THE LOAD-BEARING FIELD and the only one navigation uses:
 * `no` and `seq` are kept for the FACE (what the reader is shown, and what the
 * author wrote), never for resolution. A stored citation therefore survives the
 * numbering migration, a renumber, and anything else that changes what a number
 * means — the row it points at does not move.
 */
export type ResolvedCite = {
  messageId: string;
  /** The global `seq` of the cited row — always known, since it is how rows sort. */
  seq: number;
  /** The per-channel number, once the held migration provides one. */
  no?: number | null;
  /** The thread the cited row belongs to, when it is in one. */
  thread?: string | null;
};
