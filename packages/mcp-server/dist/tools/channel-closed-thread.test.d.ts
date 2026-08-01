/**
 * F6 — CLOSING A THREAD STOPS ITS PASSIVE ROUTING; IT DOES NOT SEAL IT.
 *
 * The write path gated on thread MEMBERSHIP and never on thread STATUS, so a
 * thread closed at #355 accepted #356, #361, #362, #363 and #365 with no refusal
 * and no warning — while THIS tool's close result said "Closed thread <title> …
 * as <outcome>." and stopped, i.e. asserted a finality the server does not
 * enforce. Two halves, both pinned here:
 *
 *  1. the CLOSE result now says what closing really changes (the PASSIVE lane),
 *     and says outright that a later post is still accepted;
 *
 * THE SCOPE OF THAT CLAIM IS ITSELF PINNED, because the first correction
 * overshot: "no session is woken for it any more" is not true either. The
 * desktop skips the passive thread-lane wake off a status cache that lags by up
 * to ~5 minutes, an older build does not skip it at all, and an ADDRESSED post
 * starts its addressee whatever the status is. So both surfaces have to say
 * PASSIVE and have to leave addressing standing.
 *  2. the POST result carries the warning when the server reports the thread was
 *     closed — WARN, NEVER REFUSE. A 403 would break the legitimate "one last
 *     word after the close echo" pattern, and its remedy (reopen) has no op on
 *     this tool, so a refusal would point the agent at something it cannot do.
 *
 * The server half — that `threadClosed` is raised at all, and that the message
 * still lands — is pinned in
 * `src/features/channels/server/service-writes-metadata-closed.test.ts`.
 *
 * `opCloseThread`'s SUMMARY behaviour (Feature 3c) moved here from
 * `channel-ops.test.ts` in the same change — a §2 split at the 500-line cap, on
 * the seam that this file already is: every assertion about a close result now
 * lives in one place instead of two that would have to be re-worded together.
 */
export {};
