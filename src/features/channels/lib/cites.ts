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

import {
  MESSAGE_REF_TOKEN_ANY_RE,
  messageRefNumber,
} from "./message-refs";

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

/**
 * **WHAT A RENDERER IS HANDED — THREE STATES IN ONE FIELD** (2026-10-12).
 *
 *   `null` / absent  **NOT WRITTEN UNDER GRAMMAR B.** A row that predates the
 *                    stamp, or a server too old to answer. It keeps the legacy
 *                    face exactly: prose `#NNNN` of two or more digits, read as
 *                    a global `seq` and gated by the pane's ceiling. ⚠ The two
 *                    causes are conflated DELIBERATELY, because they want the
 *                    same answer and that answer is today's behaviour — so an
 *                    old client against a new server, or the reverse, degrades
 *                    to what shipped rather than to a blank.
 *   `[]`             **WRITTEN UNDER GRAMMAR B, CITED NOTHING.** The common case,
 *                    and the one the ruling is for: no pill is drawn ANYWHERE in
 *                    this body, so `my #1 priority` and `the #12 regression` are
 *                    the text the author typed.
 *   `[…]`            **WRITTEN UNDER GRAMMAR B, CITING THESE.** Only a number
 *                    naming one of these entries becomes a pill — at ANY digit
 *                    length, `#7` included, because the allowlist has replaced
 *                    the guess that needed a two-digit floor.
 *
 * ⚠ **EMPTY AND ABSENT ARE NOT THE SAME STATE HERE, WHICH IS UNUSUAL IN THIS
 * TREE** and is the reason this field is documented at this length. Everywhere
 * else a `?` field folds `undefined` onto `null` as "not answered". Here the
 * difference between "cited nothing" and "not written under the rule" is the
 * difference between a dead `#12` and a live one, so the DTO is the only place
 * allowed to decide it and it decides from the STAMP, never from the list.
 */
export type MessageCites = ResolvedCite[] | null;

/**
 * **WHICH CITATION A NUMBER TYPED IN A BODY NAMES** — `null` for a number that
 * names none of them, which is the common answer and the one that keeps text as
 * text.
 *
 * ⚠ **`no` IS TRIED BEFORE `seq`, AND THE ORDER IS THE ONLY INTERESTING LINE IN
 * THIS FUNCTION.** Both numbers name the SAME row for a given entry, so matching
 * either can never mis-target — that is why both are matched at all, and why the
 * transition needs no flag: an agent citing by `seq` today and by `no` after the
 * held migration lands both get a live pill from the same code. The one case
 * where it matters is two different entries, one whose per-channel `no` and one
 * whose global `seq` are the same integer. Post-migration an author writes the
 * per-channel number, so that reading wins.
 */
export function findCite(
  cites: readonly ResolvedCite[],
  n: number
): ResolvedCite | null {
  return (
    cites.find((c) => c.no !== null && c.no !== undefined && c.no === n) ??
    cites.find((c) => c.seq === n) ??
    null
  );
}

/** What a citation is LABELLED with: its per-channel number when there is one. */
export function citeLabel(cite: ResolvedCite): string {
  return `#${cite.no ?? cite.seq}`;
}

/**
 * **THE CITATIONS THIS BODY NEVER MENTIONS** — what a chip row has to show
 * (2026-10-12).
 *
 * ⚠ **A CITED MESSAGE WITH NO AFFORDANCE IS THE HOLE GRAMMAR B OPENS.** Under the
 * old rule a reference existed only if the author typed the number, so there was
 * nothing to miss. Now the field is the reference: an agent can cite three
 * messages and write "as discussed above", and without this the reader is told
 * nothing and can reach nothing.
 *
 * ⚠ **CODE IS NOT PROSE, AND THE TIE IS BROKEN TOWARD REACHABLE.** Fenced blocks
 * and inline spans are removed before scanning, because the body renderer does
 * not draw pills inside them — so a number that appears ONLY in a code sample is
 * not an affordance, and counting it as one would leave that citation with no way
 * in. The cost of the other error is a chip beside a pill that says the same
 * thing, which is redundant rather than broken.
 *
 * ⚠ **IT MATCHES THROUGH `findCite`, NOT BY NUMBER**, so the chip row and the
 * pills can never disagree about what counts as mentioned: one rule, asked twice.
 */
export function citesNotInBody(
  cites: readonly ResolvedCite[],
  body: string
): ResolvedCite[] {
  const prose = body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const named = new Set<string>();
  for (const token of prose.match(MESSAGE_REF_TOKEN_ANY_RE) ?? []) {
    const n = messageRefNumber(token);
    const hit = n === null ? null : findCite(cites, n);
    if (hit !== null) named.add(hit.messageId);
  }
  return cites.filter((c) => !named.has(c.messageId));
}
