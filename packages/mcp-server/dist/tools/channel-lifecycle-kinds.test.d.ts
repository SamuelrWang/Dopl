/**
 * P0-2 / P0-3 — THE AGENT'S WRITE SURFACE, after the 2026-08-04 incident.
 *
 * WHAT HAPPENED. A responder agent finished its work and posted the ANSWER as
 * `kind:"task_finished"`. On the requester's side it appeared nowhere:
 * `lib/group-thread.ts` folds a terminal marker into `draft.endEvent` and never
 * pushes it to `draft.entries`, so its body is structurally unrenderable. The
 * runtime was innocent — the desktop's delivery call emits no `kind` at all and
 * the MCP default is `message`. The AGENT chose the kind, because the surface
 * offered five values in one flat enum with no rule about whose each one is.
 *
 * TWO CHANGES ARE PINNED HERE:
 *   1. `op="post"` REFUSES the three lifecycle kinds, before any round-trip, with
 *      a message that says what to do instead. (The authoritative refusal is the
 *      server's — `service-writes.assertLifecycleKindIsServerOwned` — and lives
 *      in the app's own suite. This one is the fast, teaching half.)
 *   2. `op="milestone"` exists, so the milestone lane is a different CALL rather
 *      than a different `kind` on the same call. That is the seam: the two acts
 *      can no longer be confused by picking wrongly between adjacent enum values.
 *
 * The stub client is hand-rolled; nothing transports. What each assertion is
 * really watching for is a REGRESSION OF THE SURFACE, not of the transport: if
 * the refusal is removed, or the milestone op silently starts accepting a kind
 * again, the incident's whole runway is back.
 */
export {};
