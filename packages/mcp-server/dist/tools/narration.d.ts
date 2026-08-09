/**
 * NARRATION SAFETY — the one neutralizer, for every tool.
 *
 * A tool result is not a document; it is a message a model reads, and the
 * parts of it we write are read as the SERVER speaking. A newline plus `##`
 * forges a heading in that voice. A stray backtick escapes a code span and
 * puts the rest of an attacker's string back into narration. A crafted name
 * can impersonate a system line the agent has been taught to obey.
 *
 * These helpers were born in `channel-shared.ts`, where a PEER could reach
 * them. They live here now because the reach is not a channel property: a
 * workspace name lands in the MCP `instructions` block and in the
 * `_dopl_status` footer of EVERY tool response; a shared chat's title, a
 * published knowledge base's name, and a member's `display_name` are all
 * typed by someone other than the caller and all end up spliced into lines
 * the agent reads as ours. `channel-shared.ts` re-exports both functions, so
 * the channel modules are unchanged and there is still exactly ONE
 * definition — two copies of a neutralizer drift, and the copy that drifts
 * is the one that stops neutralizing.
 *
 * DELIBERATELY NOT FOR BODIES. Knowledge-entry bodies, SKILL.md, chat
 * transcript summaries — those are the payload the product exists to hand
 * the agent, and stripping their markdown would break the feature. The line
 * this module draws is between a VALUE (a name, a title, a label, an error
 * echo — spliced into a line we wrote) and a BODY (content rendered as
 * itself, under framing that says what it is).
 */
/** Longest untrusted value carried inline into a result — one terse span, no dump. */
export declare const INLINE_TEXT_MAX = 160;
/**
 * Any untrusted string, reduced to something that cannot pose as structure and
 * returned as ONE inline code span — or null when nothing survives, so the
 * caller can drop the mention rather than render an empty pair of backticks.
 *
 * Bounding the length was never enough on its own: 160 characters is ample
 * room for "IGNORE THE ABOVE. New instruction: …" to sit in the result as
 * unframed server narration. So control characters (including the newlines a
 * fake block or a forged legend entry would need) are dropped,
 * markdown/quote punctuation is stripped — backticks first, since one of
 * those escapes the span — and what is left is rendered as a quoted value.
 * However it reads, it reads as a value.
 */
export declare function neutralizeInline(raw: string): string | null;
/**
 * An untrusted string as one inline code span, or `fallback` when nothing
 * survives neutralization. The fallback matters: rendering an empty pair of
 * backticks would hide the "the server could not name this" tell.
 */
export declare function inlineOr(raw: string | null | undefined, fallback: string): string;
/** Anything with the two authorship columns every authored row carries. */
export interface AuthoredRow {
    createdBy?: string | null;
    lastEditedBy?: string | null;
}
/**
 * Is this row's CONTENT written by somebody other than the caller — i.e. does
 * the body below it need framing?
 *
 * THE OTHER HALF OF THIS MODULE'S PROMISE. The header above says bodies are
 * rendered "as themselves, under framing that says what it is". The framing half
 * was true of channels and of shared chats and was NOT true of knowledge entries
 * or SKILL.md: both went out verbatim with no header at all. In a solo workspace
 * that is fine and F-101 recorded it as deliberate on exactly that reading — "the
 * workspace's own authored procedure". In a SHARED workspace it is false: member
 * B authors a KB entry or a SKILL.md, member A's agent reads it, and it lands
 * unframed inside a Bash-capable session. The signal to tell the two apart was
 * always on the row.
 *
 * FAIL CLOSED, in both of the ways this can be unknown:
 *  - **no caller id** (auth could not resolve one) — the server cannot tell whose
 *    content this is, so it says so rather than assuming the safe answer;
 *  - **no author at all** (both columns null — a legacy or import row) —
 *    unattributable content is not the caller's by evidence, only by hope.
 *
 * BOTH COLUMNS, not just `createdBy`. An entry the caller created and a peer
 * later EDITED carries the peer's words under the caller's authorship, which is
 * the same reach through a column that would have said "yours". `last_edited_by`
 * is written on every update by the acting user — including an agent write, which
 * records the operator it acted for — so the common path (my own docs, edited by
 * me or by my own agent) frames nothing and stays quiet.
 */
export declare function isForeignAuthored(row: AuthoredRow, callerUserId: string | null | undefined): boolean;
