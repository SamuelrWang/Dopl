"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_PATH = exports.NO_NAME = exports.INLINE_TEXT_MAX = void 0;
exports.neutralizeInline = neutralizeInline;
exports.flattenFenced = flattenFenced;
exports.inlineOr = inlineOr;
exports.isForeignAuthored = isForeignAuthored;
/** Longest untrusted value carried inline into a result — one terse span, no dump. */
exports.INLINE_TEXT_MAX = 160;
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
function neutralizeInline(raw) {
    const flattened = raw
        .replace(/[\u0000-\u001F\u007F]+/g, " ")
        // ⚠ Punctuation that lets text pose as markdown structure or as our own
        // quoting — backticks would break out of the code span below.
        .replace(/[`*_#>[\]{}|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (flattened === "")
        return null;
    const clipped = flattened.length > exports.INLINE_TEXT_MAX
        ? `${flattened.slice(0, exports.INLINE_TEXT_MAX - 3)}...`
        : flattened;
    return `\`${clipped}\``;
}
/**
 * 🔒 **THE BODY-CLASS ONE-LINER — FOR TEXT THAT WILL BE RENDERED INSIDE A
 * FENCE, AND NOWHERE ELSE** (2026-09-18, Wave 4 a3/b2).
 *
 * ⚠ **IT IS NOT A LONGER {@link neutralizeInline}, AND THE DIFFERENCE IS THE
 * FENCE.** `neutralizeInline` strips backticks and markdown punctuation because
 * its output is spliced into a line THIS SERVER WROTE, where a backtick escapes
 * the code span and the rest of the value becomes narration. A curated excerpt
 * is not that: it is the 300-char summary the author wrote FOR the agent, it is
 * the one signpost Wave 4 measured as load-bearing on routing, and stripping
 * its backticks is what made *"quote the heading name in backticks"* impossible
 * to ask for. So the markdown survives — and the caller owes it a
 * `untrusted-fence.ts` fence, which is what makes rendering it verbatim safe.
 *
 * ⚠ **WHAT IS STILL REMOVED: CONTROL CHARACTERS.** A row is a LINE, and a
 * newline inside a value makes it two — one of which the reader has no frame
 * for. Flattening is structural, not cosmetic, and it survives the fence
 * because a fence says where a block ends, never where a row does.
 *
 * ⚠ **THE CLIP LANDS ON A CLAUSE BOUNDARY** (Wave 4 a3: the old cut produced
 * `"...the $5..."`). Past `max`, back up to the last `.`/`;`/`,`/`—`/`:` inside
 * the budget — but only when that leaves at least 60% of it, because a clip
 * that discards a third of the excerpt to end tidily has bought punctuation
 * with content.
 */
function flattenFenced(raw, max) {
    const flattened = raw
        .replace(/[\u0000-\u001F\u007F\u0085\u2028\u2029]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (flattened === "")
        return null;
    if (flattened.length <= max)
        return flattened;
    const window = flattened.slice(0, max);
    const boundary = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "), window.lastIndexOf(", "), window.lastIndexOf(" — "), window.lastIndexOf(": "));
    if (boundary >= Math.floor(max * 0.6))
        return `${window.slice(0, boundary + 1)} …`;
    const space = window.lastIndexOf(" ");
    return `${(space >= Math.floor(max * 0.6) ? window.slice(0, space) : window).trimEnd()} …`;
}
/**
 * An untrusted string as one inline code span, or `fallback` when nothing
 * survives. ⚠ The fallback matters — empty backticks hide the "the server could
 * not name this" tell.
 */
function inlineOr(raw, fallback) {
    const safe = raw ? neutralizeInline(raw) : null;
    return safe ?? fallback;
}
/**
 * THE TWO STOCK FALLBACKS, declared ONCE beside the contract they belong to
 * (2026-09-17). They were 22 local `const`s across the tool modules carrying
 * FOUR different strings, so the same absent name rendered as a code span in
 * half the responses and as bare text in the other half.
 *
 * ⚠ BACKTICKED, because `inlineOr` returns a code span on every other path and
 * a bare-text fallback is the one case where the "could not name this" tell is
 * indistinguishable from a name the server actually read.
 */
exports.NO_NAME = "`(unnamed)`";
exports.NO_PATH = "`(unreadable path)`";
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
function isForeignAuthored(row, callerUserId) {
    if (!callerUserId)
        return true;
    const authors = [row.createdBy, row.lastEditedBy].filter((id) => typeof id === "string" && id.length > 0);
    if (authors.length === 0)
        return true;
    return authors.some((id) => id !== callerUserId);
}
