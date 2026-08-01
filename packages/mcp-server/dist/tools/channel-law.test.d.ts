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
 * A STALE LAW IS THE SAME BUG AS A FALSE ONE, and this file has now been on both
 * sides of it. It used to pin "NOTHING ACTS UNLESS ADDRESSED" as THE rule; that
 * sentence was true until ENGAGEMENT shipped and then described a product that
 * no longer existed, and a green suite would have kept it there. What is pinned
 * now is the narrower absolute that survived (an AGENT-authored unaddressed
 * message engages and starts nobody, at any size) plus the four rules the room
 * gained: chat vs. request, engagement and its expiry, multi-address, and the
 * one-opener thread handshake. When the behaviour moves again, the pin is the
 * thing to change FIRST — not the thing to work around.
 *
 * Captured through the real registrar with a recording `register` and a stub
 * client (registration is all this needs — no handler ever runs).
 */
export {};
