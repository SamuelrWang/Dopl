/**
 * THE TWO-AGENT HANDSHAKE KEY — the half of the contract this package owns.
 *
 * THE BUG (BLOCKER-1), in one line: THE LAW told an agent to pass
 * `client_msg_id="thread-open-<channelId>-<seq>"`, the `channel` param takes a
 * SLUG or an id, and `parseHandshakeSeq` anchors on the UUID. An agent holding
 * only the slug therefore followed the instructions exactly and produced a key
 * that derived NO participant set, on a create that returned 200 — and the
 * failure surfaced on the OTHER machine, one turn later, as a `mayWriteThread`
 * 403 on the thread it had been told to use. "Told to join a room, locked out
 * of it": the exact failure `service-thread-handshake.ts` exists to prevent.
 *
 * What is pinned here:
 *
 *  - the parse this package performs AGREES WITH THE SERVER'S. Two independent
 *    parsers of one string is how the original ambiguity survived review, so
 *    the prefix and the seq rules are read out of the server file rather than
 *    trusted to stay in step (the `GROUP_CHANNEL_MIN_MEMBERS` doctrine);
 *  - a slug-form key is REWRITTEN onto the resolved uuid, not refused — and the
 *    two forms therefore CONVERGE on one key, which a refusal would not do;
 *  - the rewrite is REPORTED, because silently changing a caller's idempotency
 *    key teaches it nothing and it has to mint the same string next turn;
 *  - a `thread-open-` key with no seq is REFUSED, because there is nothing to
 *    repair and passing it through restores the silent miss;
 *  - an ordinary idempotency key is untouched, byte for byte.
 */
export {};
