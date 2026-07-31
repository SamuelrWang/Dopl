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
export const INLINE_TEXT_MAX = 160;

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
export function neutralizeInline(raw: string): string | null {
  const flattened = raw
    // Control characters (including the newlines a fake "block" would need).
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    // Punctuation that lets text pose as markdown structure or as our own
    // quoting — backticks would also break out of the code span below.
    .replace(/[`*_#>[\]{}|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened === "") return null;
  const clipped =
    flattened.length > INLINE_TEXT_MAX
      ? `${flattened.slice(0, INLINE_TEXT_MAX - 3)}...`
      : flattened;
  // One inline code span: whatever it says, it reads as a quoted value.
  return `\`${clipped}\``;
}

/**
 * An untrusted string as one inline code span, or `fallback` when nothing
 * survives neutralization. The fallback matters: rendering an empty pair of
 * backticks would hide the "the server could not name this" tell.
 */
export function inlineOr(
  raw: string | null | undefined,
  fallback: string,
): string {
  const safe = raw ? neutralizeInline(raw) : null;
  return safe ?? fallback;
}
