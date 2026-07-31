/**
 * Q9 + Q13 — WHAT THE WRITE OPS TELL AN AGENT TO DO NEXT.
 *
 * Two defects, one surface: the sentence a `post` / `create_thread` leaves in
 * the agent's context. Both sent the agent somewhere it could not go.
 *
 * Q9 — every 400 was reported as "the addressee isn't a channel member". `to`
 * is REQUIRED for `create_thread`, so that message had no fall-through at all:
 * a 240-character title, rejected by the route's own zod schema before
 * `createTask` ever ran, came back as "invite Bob first", and `op="invite"`
 * then answered "Bob is already a member". Two contradictory errors, no path
 * forward, and nothing anywhere naming title length. `DoplApiError.code` was
 * parsed and discarded the whole time.
 *
 * Q13 — the not-threaded warning listed the CHANNEL's open threads and told the
 * agent to re-post into a matching one, but a thread accepts writes only from
 * its creator or its target (`resolvePostMetadata` 403s the rest). At N=5 that
 * is a burned operator approval plus two agent turns per unthreaded post, and
 * every other pair's thread titles in the caller's context as suggestions.
 *
 * Nothing here transports — the @dopl/client is hand-stubbed.
 */
export {};
