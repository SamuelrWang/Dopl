/**
 * `dopl_channel` API-ERROR CLASSIFICATION — ⚠ what a 4xx MEANS is read off the
 * error CODE, never guessed from the status. A bare `status === 400` branch
 * blames whichever param happened to be set, so an over-length title comes back
 * as "invite them first" and `op="invite"` then answers "already a member".
 *
 * `DoplApiError` parses `{ error: { code, message } }` into `.code` /
 * `.apiMessage` (packages/dopl-client/src/errors.ts) and every channels-route
 * 400 carries one — `HttpError.toResponseBody()` makes that unconditional.
 * Duck-typed here so nothing imports the error class across the @dopl/client
 * boundary (same discipline as `respond.ts`'s isNotFound / isConflict).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan (parity.test.ts).
 */
/** Duck-typed HTTP 400 from the Dopl API (across the @dopl/client boundary). */
export declare function isBadRequest(e: unknown): boolean;
/** Duck-typed HTTP 403 from the Dopl API (thread authorization refusals). */
export declare function isForbidden(e: unknown): boolean;
/**
 * What a 400 from a channels route MEANS, as far as the caller can act on it.
 *
 *   - `addressee_not_member`  — the `to` member is not in the channel.
 *   - `recipient_unresolved`  — `to` named nobody this server can see, in
 *     either namespace. ⚠ NOT a delivery failure and NOT a membership problem:
 *     nothing was written at all, and the server's own message lists the live
 *     handles and the roster.
 *   - `thread_not_in_channel` — a first-class `thread` id not of this channel.
 *   - `self_target`           — `create_thread` addressed to the CALLER: only
 *     creator and target may post, so it has one party and can never be
 *     answered. ⚠ create_thread ONLY — `post to=self` is not guarded server-side.
 *   - `invalid_request`       — the route's zod schema (or JSON parse) rejected
 *     the body BEFORE any channel logic ran; almost always a field over its cap.
 *     ⚠ Emphatically NOT a membership problem.
 *   ⚠ A SEVENTH KIND ENDED HERE (C12, 2026-09-02): `chat_addressed` classified
 *     `CHANNEL_CHAT_ADDRESSED` — `intent:"chat"` beside a `to`, which mean
 *     opposite things. Its own comment said the arm "should be unreachable"
 *     because the tool refused the pair before the call; `intent` has now left
 *     the published shape entirely, so the contradiction is not EXPRESSIBLE and
 *     an arm for it would claim a live rule. Chat is "no `to`" and nothing else.
 *   - `workspace`             — no usable workspace on the call.
 *   - `unknown`               — a 400 with no recognized code (or none at all,
 *     e.g. an edge/proxy error page). ⚠ Say so; never invent a cause.
 */
export type BadRequestKind = "addressee_not_member" | "recipient_unresolved" | "thread_not_in_channel" | "self_target" | "invalid_request" | "workspace" | "unknown";
export declare function classifyBadRequest(e: unknown): BadRequestKind;
/**
 * What a 403 from a channels route MEANS. Same doctrine as
 * {@link classifyBadRequest}: a bare `status === 403` reports one cause for all.
 *
 *   - `not_a_member`         — `CHANNEL_FORBIDDEN`: not a member of the channel.
 *   - `thread_authorization` — `TASK_FORBIDDEN`: IN the channel but not
 *     authorized on THIS THREAD. A thread's two parties are its creator and its
 *     target, and only those two may post into it or set its mode
 *     (`service-tasks.ts`, `service-writes-metadata.ts`). ⚠ The arm must say
 *     WHICH write it refused, and must NOT read as "you left the channel".
 *   - `lifecycle_kind`       — `CHANNEL_LIFECYCLE_KIND_FORBIDDEN`: a post
 *     carrying `task_started`/`task_finished`/`task_failed`. The tool refuses
 *     these pre-call, so this is the belt for a bypassed build. ⚠ Must not be
 *     reported as a channel-membership problem.
 *   - `unknown`              — an unrecognized 403. ⚠ Say so; never guess.
 *
 * ⚠ A FIFTH KIND ENDED HERE (wiring plan Phase 4, 2026-08-18):
 * `CHANNEL_CLOSE_IS_HUMAN_ONLY` refused an agent-token caller from settling a
 * shared thread. The server error is deleted, so nothing can raise it and an
 * arm for it would be an unreachable branch claiming a live rule.
 */
export type ForbiddenKind = "not_a_member" | "thread_authorization" | "lifecycle_kind" | "unknown";
export declare function classifyForbidden(e: unknown): ForbiddenKind;
/**
 * The server's own message as a trailing clause, or "" when there is nothing to
 * add. ⚠ NEUTRALIZED: "our own server said it" names where the bytes came from,
 * not who wrote them — a 400 routinely echoes a rejected field and a not-found
 * names a counterparty-supplied ref, and an error line is unframed narration.
 */
export declare function serverDetail(e: unknown): string;
/**
 * Route-enforced caps, quoted in invalid-request messages so an agent has a
 * number to act on. ⚠ HAND-COPIED from `src/features/channels/schema.ts`, and
 * `channel-schema.ts`'s zod mirrors the same numbers — sync all three.
 */
export declare const FIELD_CAPS_NOTE = "Field caps: summary <=200 characters, body <=16000, client_msg_id <=200.";
