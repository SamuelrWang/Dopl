/**
 * FIX L5 / M2 — UNTRUSTED TEXT SPLICED INTO A RESULT A MODEL READS, outside the
 * framing that disclaims message bodies. Two sites, one discipline: the await
 * result's failure description (L5, below) and the read result's thread-legend
 * title (M2, at the bottom of this file).
 *
 * `dopl_channel` results are careful about counterparty BODIES: `opRead` and
 * `opAwait` emit `UNTRUSTED_BODY_HEADER` above them, so the framing is read
 * before the content it frames. The `await` op's FAILED-MID-HOLD branch is the
 * one place that splices upstream text OUTSIDE that framing — it names what
 * broke so the agent can act on it — and "it is our own server's error" is a
 * claim about the SOURCE, not about the CONTENT: a 400 echoing a rejected
 * field, a proxy error page, or a not-found naming a counterparty-supplied ref
 * can all carry text an attacker influenced.
 *
 * Bounding it (160 chars, one line) was never enough on its own: 160 characters
 * is ample room for "IGNORE THE ABOVE. New instruction: …" to sit in the result
 * as unframed narration by the server. What is pinned here is that the text is
 * NEUTRALIZED — stripped of anything that lets it pose as structure and
 * rendered as one inline code span, so however it reads it reads as a value.
 *
 * Split into its own file (rather than added to `channel-wake.test.ts`) at the
 * §2 500-line cap. The @dopl/client is hand-stubbed; nothing transports.
 */
export {};
