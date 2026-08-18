/**
 * NARRATION SAFETY — ⚠ THE ONE neutralizer, for every tool. Two copies drift,
 * and the copy that drifts is the one that stops neutralizing.
 * `channel-shared.ts` re-exports these; there is still exactly ONE definition.
 *
 * A tool result is a message a model reads, and the parts we write are read as
 * the SERVER speaking: a newline plus `##` forges a heading in that voice, a
 * stray backtick escapes a code span and puts the rest back into narration, and
 * a crafted name can impersonate a system line the agent obeys. The reach is
 * not a channel property — a workspace name lands in the MCP `instructions`
 * block and in EVERY response's `_dopl_status` footer.
 *
 * ⚠ DELIBERATELY NOT FOR BODIES. Knowledge-entry bodies, SKILL.md and chat
 * summaries are the payload the product exists to hand the agent; stripping
 * their markdown breaks the feature. The line is between a VALUE (name, title,
 * label, error echo — spliced into a line we wrote) and a BODY (rendered as
 * itself, under framing that says what it is).
 */
/** Longest untrusted value carried inline into a result — one terse span, no dump. */
export declare const INLINE_TEXT_MAX = 160;
/**
 * Any untrusted string, reduced so it cannot pose as structure and returned as
 * ONE inline code span — or null when nothing survives, so the caller drops the
 * mention rather than rendering empty backticks.
 *
 * ⚠ Bounding the length is not enough: 160 chars is ample room for "IGNORE THE
 * ABOVE. New instruction: …" as unframed server narration. So control chars
 * (including the newlines a fake block or forged legend entry needs) are
 * dropped and markdown/quote punctuation stripped — backticks first, since one
 * escapes the span.
 */
export declare function neutralizeInline(raw: string): string | null;
/**
 * An untrusted string as one inline code span, or `fallback` when nothing
 * survives. ⚠ The fallback matters — empty backticks hide the "the server could
 * not name this" tell.
 */
export declare function inlineOr(raw: string | null | undefined, fallback: string): string;
/** Anything with the two authorship columns every authored row carries. */
export interface AuthoredRow {
    createdBy?: string | null;
    lastEditedBy?: string | null;
}
/**
 * Is this row's CONTENT somebody else's — i.e. does the body below need framing?
 * In a SHARED workspace member B authors a KB entry or SKILL.md, member A's
 * agent reads it, and it lands unframed inside a Bash-capable session.
 *
 * ⚠ FAIL CLOSED in both ways this can be unknown: no caller id (auth could not
 * resolve one) and no author at all (both columns null — legacy/import row).
 * Unattributable content is not the caller's by evidence, only by hope.
 *
 * ⚠ BOTH COLUMNS, not just `createdBy`: an entry the caller created and a peer
 * later EDITED carries the peer's words under the caller's authorship.
 * `last_edited_by` is written on every update by the acting user (an agent
 * write records the operator it acted for), so the common path stays quiet.
 */
export declare function isForeignAuthored(row: AuthoredRow, callerUserId: string | null | undefined): boolean;
