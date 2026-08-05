/**
 * THE LAW — the multiplayer contract every agent reads on every connection.
 *
 * THIS FILE PINS PROSE, NOT BEHAVIOUR. Every assertion below is a string match
 * on `CHANNEL_DESCRIPTION`; not one of them executes a handler, reaches a
 * route, or observes what the desktop listener actually does with a message.
 * It can only ever catch an edit that changes the WORDS. Whether the words are
 * TRUE is checked against the code that owns each fact — `classify` in
 * `dopl-desktop-app/main/targeting.js` for what wakes whom, `mayWriteThread` in
 * `src/features/channels/server/service-writes-metadata.ts` for who may post
 * into a thread — and this suite is worthless against a change on that side.
 * The header used to imply otherwise ("the law is not documentation, it is the
 * behaviour"), and a reviewer read the green suite as evidence the escalation
 * promise held. It did not: the promise was false by default for a year of
 * this file passing.
 *
 * What it IS worth: the description is the only thing that tells a summoned
 * agent when to act and when to stay quiet, and a room full of agents that
 * answer everything they can read is the failure this whole feature is built to
 * avoid. So the law's load-bearing sentences are pinned — including the ones
 * that must NOT come back, because the regression is a later edit that softens
 * THE LOOP BRAKE into a suggestion, or that restores an unconditional
 * "addressing a person only notifies them".
 *
 * A STALE LAW IS THE SAME BUG AS A FALSE ONE, and this file has now been on
 * three sides of it. It pinned "NOTHING ACTS UNLESS ADDRESSED"; ENGAGEMENT
 * shipped and that sentence described a product that no longer existed. So it
 * pinned engagement, multi-address, `as_agent` and the one-opener thread
 * handshake instead — and the channels rollback (§1, 2026-08-05) deleted every
 * one of those, which would have left this suite green over a law teaching
 * agents to call ops that no longer exist. What is pinned now is what actually
 * remains: chat vs. request, addressing a PERSON, the loop brake, and the
 * two-party thread. The removed vocabulary is pinned as an ABSENCE below, which
 * is the half that catches a resurrection.
 *
 * Captured through the real registrar with a recording `register` and a stub
 * client (registration is all this needs — no handler ever runs).
 */
export {};
