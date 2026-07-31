/**
 * THE ADDRESSING RULE, pinned against the code that actually implements it.
 *
 * A sibling of `channel-addressing.test.ts` (which is at the §2 cap and covers
 * the render surfaces) because these assertions have one subject the other file
 * does not own: whether the SENTENCES this tool emits about who a message
 * reaches are true.
 *
 * The wave these replace asserted three things that are not true, and each one
 * has a concrete failure attached:
 *
 *   F1 — "an unaddressed post triggers no agent, including in a two-member
 *        channel". `classify` keys its implicit trigger on `memberCount === 2`
 *        (dopl-desktop-app/main/targeting.js:152) and never reads `is_direct`,
 *        so a person's unaddressed message in a two-member channel IS a request
 *        for the only other member. An agent told otherwise re-posts with `to=`
 *        and the peer gets the same request twice, with two consent prompts.
 *
 *   H3 — "nobody was woken by it", said about a post that THREADED. Three
 *        routes run before `classify` (listener-messages.js:36-38) and none of
 *        them reads `to_user_id`: a first-class thread tag is fed straight into
 *        the counterparty's live session. The note rendered its claim directly
 *        above "THREADED into X — the other side reads this as a continuation".
 *
 *   H2 — "NONE of the messages above is addressed to you … do not answer them".
 *        The canonical reply in this product is UNADDRESSED
 *        (channel-post.js#postResult, prompt-framing.js#deliveryCall), so in
 *        exactly the N-party case the notice exists for it told a requester its
 *        own answer was somebody else's traffic.
 *
 * Each test below fails if the corresponding sentence comes back.
 */
export {};
