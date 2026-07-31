/**
 * Q1, WRITE SIDE — the sites the first neutralization pass never enumerated.
 *
 * The original Q1 fix swept the READ ops (`channel-narration.test.ts` pins
 * those) and the completeness review then found the same defect class alive in
 * the write ops, which had simply never been listed. The headline instance:
 * `opCloseThread` rendered `**${thread.title}**` raw, and CLOSING IS PERMITTED
 * TO THE THREAD'S TARGET — so the ordinary shape is a peer opening a thread,
 * titling it, addressing it to me, and my agent's own close confirmation
 * printing that title as our narration. Alongside it, `ch.name` was spliced raw
 * at fourteen sites and `profiles.display_name` at ten more.
 *
 * Sibling of `channel-narration.test.ts` (read ops) and
 * `channel-untrusted.test.ts` (the two sites the original pass DID cover); split
 * for the §2 500-line cap, same as those two were split from each other.
 *
 * WHAT EACH CASE PINS, and it is the same contract the read side has: the
 * payload lands on ONE line, inside a code span, and NO line of the result
 * begins with `#`, `-` or `[` written by the attacker. Every assertion here
 * fails against the pre-fix code — that was checked by reverting, not assumed.
 *
 * The @dopl/client is hand-stubbed; nothing transports.
 */
export {};
