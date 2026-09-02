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

import { neutralizeInline } from "./channel-shared";

/** Duck-typed HTTP 400 from the Dopl API (across the @dopl/client boundary). */
export function isBadRequest(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { status?: number }).status === 400
  );
}

/** Duck-typed HTTP 403 from the Dopl API (thread authorization refusals). */
export function isForbidden(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { status?: number }).status === 403
  );
}

/**
 * What a 400 from a channels route MEANS, as far as the caller can act on it.
 *
 *   - `addressee_not_member`  — the `to` member is not in the channel.
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
export type BadRequestKind =
  | "addressee_not_member"
  | "thread_not_in_channel"
  | "self_target"
  | "invalid_request"
  | "workspace"
  | "unknown";

/** The `code` a DoplApiError carries, or null when the body had none. */
function apiErrorCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

export function classifyBadRequest(e: unknown): BadRequestKind {
  switch (apiErrorCode(e)) {
    case "CHANNEL_ADDRESSEE_NOT_MEMBER":
      return "addressee_not_member";
    case "CHANNEL_TASK_NOT_IN_CHANNEL":
      return "thread_not_in_channel";
    case "CHANNEL_TASK_SELF_TARGET":
      return "self_target";
    case "VALIDATION_FAILED":
    case "INVALID_JSON":
    case "BAD_REQUEST":
      return "invalid_request";
    case "WORKSPACE_REQUIRED":
    case "WORKSPACE_INVALID":
      return "workspace";
    default:
      return "unknown";
  }
}

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
export type ForbiddenKind =
  | "not_a_member"
  | "thread_authorization"
  | "lifecycle_kind"
  | "unknown";

export function classifyForbidden(e: unknown): ForbiddenKind {
  switch (apiErrorCode(e)) {
    case "CHANNEL_FORBIDDEN":
      return "not_a_member";
    case "TASK_FORBIDDEN":
      return "thread_authorization";
    case "CHANNEL_LIFECYCLE_KIND_FORBIDDEN":
      return "lifecycle_kind";
    default:
      return "unknown";
  }
}

/**
 * The server's own message as a trailing clause, or "" when there is nothing to
 * add. ⚠ NEUTRALIZED: "our own server said it" names where the bytes came from,
 * not who wrote them — a 400 routinely echoes a rejected field and a not-found
 * names a counterparty-supplied ref, and an error line is unframed narration.
 */
export function serverDetail(e: unknown): string {
  if (typeof e !== "object" || e === null) return "";
  const raw = (e as { apiMessage?: unknown }).apiMessage;
  if (typeof raw !== "string" || raw.trim() === "") return "";
  const safe = neutralizeInline(raw);
  return safe ? ` The server said: ${safe}.` : "";
}

/**
 * Route-enforced caps, quoted in invalid-request messages so an agent has a
 * number to act on. ⚠ HAND-COPIED from `src/features/channels/schema.ts`, and
 * `channel-schema.ts`'s zod mirrors the same numbers — sync all three.
 */
export const FIELD_CAPS_NOTE =
  "Field caps: title <=200 characters, body <=16000, a post's summary <=200, client_msg_id <=200.";
