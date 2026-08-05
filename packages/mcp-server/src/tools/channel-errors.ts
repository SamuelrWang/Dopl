/**
 * `dopl_channel` API-ERROR CLASSIFICATION — what a 4xx from the channels routes
 * actually means, read off the error CODE rather than guessed from the status.
 *
 * Q9 — the write ops used to catch a bare `status === 400` and answer with a
 * fixed sentence blaming the addressee. `to` is required for `create_thread`,
 * so EVERY 400 got that sentence with no fall-through: a 240-character title
 * (rejected by the route's own zod schema, before `createTask` ever ran) came
 * back as "invite Bob first", and `op="invite"` then answered "Bob is already a
 * member" — two contradictory errors, no path forward, and nothing anywhere
 * naming the real cause.
 *
 * The code was there the whole time. `DoplApiError` parses `{ error: { code,
 * message } }` into `.code` / `.apiMessage` (packages/dopl-client/src/errors.ts)
 * and every channels-route 400 carries one — `HttpError.toResponseBody()` makes
 * that unconditional. The tools simply discarded it. This module reads it,
 * duck-typed on the shape so nothing has to import the error class across the
 * @dopl/client boundary (the same discipline as `respond.ts`'s isNotFound /
 * isConflict / isAlreadyExists).
 *
 * The `channel-` filename prefix is required by the parity split-scan
 * (parity.test.ts).
 */

import { neutralizeInline } from "./channel-shared";
// The merged agent-address cap has ONE statement in this package — see
// channel-addressing.ts for why it is not the array's `.max()`.
import { MAX_ADDRESSED_AGENTS } from "./channel-addressing";

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
 *   - `addressee_not_member` — the `to` member is not in the channel. The only
 *     cause the old fixed message was ever right about.
 *   - `thread_not_in_channel` — a first-class `thread` id that does not resolve
 *     to a thread of this channel.
 *   - `self_target`          — `create_thread` addressed to the CALLER. Only a
 *     thread's creator and its target may post into it, so a self-addressed
 *     thread has one party and can never be answered. `create_thread` only —
 *     `post to=self` is not guarded server-side and never raises this.
 *   - `invalid_request`      — the route's own zod schema (or JSON parse)
 *     rejected the body BEFORE any channel logic ran. Almost always a field
 *     over its cap. Emphatically NOT a membership problem.
 *   - `participant_not_member` — a `user:` participant who is not a member of
 *     the CHANNEL. Its own kind because of WHEN it arrives (B2): `createTask`
 *     seeds the participant set AFTER inserting the thread row, so this 400 is
 *     one of the two that can land with a live thread already behind it.
 *   - `agent_not_in_channel` — an agent id/handle that names no agent OF THIS
 *     CHANNEL, as a participant seed or as a post's `to_agent` / `as_agent`.
 *     Same late-arrival property as above on the create path.
 *   - `too_many_agents`     — more addressed agents than {@link MAX_ADDRESSED_AGENTS}
 *     allows. ITS OWN KIND BECAUSE THE TOOL PROVOKES IT: the schema publishes
 *     `to_agents.max(8)` and says nothing about `to_agent` counting toward the
 *     same eight, while the server enforces the cap on the DEDUPED MERGE of the
 *     two (`resolveAgentAddressing`). So `to_agent` + a full eight is a 400 the
 *     tool's own surface invited — and it landed in the `unknown` arm ("the
 *     server did not name a cause this tool recognizes") for the one 400 this
 *     tool is best placed to explain.
 *   - `chat_addressed`       — a post that said `intent:"chat"` AND named an
 *     addressee. The two mean opposite things and the route refuses the pair
 *     rather than picking one (`ChannelChatAddressedError`). The tool refuses it
 *     BEFORE the call too, so this arm should be unreachable in practice — it is
 *     classified anyway, because "unreachable" is exactly the assumption the
 *     status-only branch this module replaced was built on.
 *   - `workspace`            — no usable workspace on the call.
 *   - `unknown`              — a 400 with no code we recognize (or no code at
 *     all, e.g. an edge/proxy error page). Say so; do not invent a cause.
 */
export type BadRequestKind =
  | "addressee_not_member"
  | "thread_not_in_channel"
  | "self_target"
  | "invalid_request"
  | "participant_not_member"
  | "agent_not_in_channel"
  | "too_many_agents"
  | "chat_addressed"
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
    case "CHANNEL_PARTICIPANT_NOT_MEMBER":
      return "participant_not_member";
    case "CHANNEL_AGENT_NOT_IN_CHANNEL":
      return "agent_not_in_channel";
    case "CHANNEL_TOO_MANY_AGENTS":
      return "too_many_agents";
    case "CHANNEL_CHAT_ADDRESSED":
      return "chat_addressed";
    case "WORKSPACE_REQUIRED":
    case "WORKSPACE_INVALID":
      return "workspace";
    default:
      return "unknown";
  }
}

/**
 * What a 403 from a channels route MEANS. Same doctrine as
 * {@link classifyBadRequest} and the same reason: the write ops caught a bare
 * `status === 403` and answered with one fixed sentence, so the ONE cause that
 * sentence named got reported for every other cause too.
 *
 *   - `not_a_member`         — `CHANNEL_FORBIDDEN`: the caller is not a member
 *     of the channel at all.
 *   - `thread_authorization` — `TASK_FORBIDDEN`: the caller IS in the channel
 *     and is not authorized on THIS THREAD. Three different rules raise it —
 *     the write gate (creator / target / participant set), the CURATION rule on
 *     join (creator, target, or an existing user participant), and the narrower
 *     eject rule on leave — so the arm that reports it has to say which write it
 *     was refusing. It emphatically does NOT mean the caller left the channel,
 *     which is what the participant arms used to tell them.
 *   - `agent_owner`          — `CHANNEL_AGENT_FORBIDDEN`: an agent identity the
 *     caller does not own (`as_agent`, rename, park).
 *   - `unknown`              — a 403 with no code we recognize. Say so.
 */
// P0-2 / DECISION 2 (2026-08-04) add two more, and both are about WHAT AN AGENT
// MAY SAY rather than about which room it is in:
//   - `lifecycle_kind`  — `CHANNEL_LIFECYCLE_KIND_FORBIDDEN`: a post carrying
//     `task_started` / `task_finished` / `task_failed`. This tool refuses those
//     before the call (`channel-ops-write.ts`), so the arm is the belt: it fires
//     for a build whose client-side check is missing or bypassed, and it must
//     not be reported as "you are not a member of that channel", which is what
//     the `unknown` arm's neighbours would have said.
//   - `close_is_human`  — `CHANNEL_CLOSE_IS_HUMAN_ONLY`: an agent-token close.
//     Same shape, same reason.
export type ForbiddenKind =
  | "not_a_member"
  | "thread_authorization"
  | "agent_owner"
  | "lifecycle_kind"
  | "close_is_human"
  | "unknown";

export function classifyForbidden(e: unknown): ForbiddenKind {
  switch (apiErrorCode(e)) {
    case "CHANNEL_FORBIDDEN":
      return "not_a_member";
    case "TASK_FORBIDDEN":
      return "thread_authorization";
    case "CHANNEL_AGENT_FORBIDDEN":
      return "agent_owner";
    case "CHANNEL_LIFECYCLE_KIND_FORBIDDEN":
      return "lifecycle_kind";
    case "CHANNEL_CLOSE_IS_HUMAN_ONLY":
      return "close_is_human";
    default:
      return "unknown";
  }
}

/**
 * The server's own human message for an error, as a trailing clause — or "" when
 * there is nothing useful to add.
 *
 * NEUTRALIZED, for the same reason `describeFailure` is (FIX L5): "our own
 * server said it" is a claim about where the bytes came from, not about who
 * wrote them. A 400 routinely echoes a rejected field, and a not-found names a
 * counterparty-supplied ref. Spliced into an error line — which is unframed
 * narration by the tool — that text would be read as ours.
 */
export function serverDetail(e: unknown): string {
  if (typeof e !== "object" || e === null) return "";
  const raw = (e as { apiMessage?: unknown }).apiMessage;
  if (typeof raw !== "string" || raw.trim() === "") return "";
  const safe = neutralizeInline(raw);
  return safe ? ` The server said: ${safe}.` : "";
}

/**
 * The caps the routes actually enforce, quoted in the invalid-request messages
 * so an agent that hit one has a number to act on. Mirrored (not re-derived)
 * from `src/features/channels/schema.ts`; the MCP zod schema in `channel.ts`
 * mirrors the same numbers so the common case never reaches the route at all.
 */
export const FIELD_CAPS_NOTE =
  "Field caps: title <=200 characters, body <=16000, a post's summary <=200, a close summary <=2000, client_msg_id <=200.";

/**
 * The MERGED agent cap, said the way the surface should have said it all along.
 *
 * The sentence has to carry the merge, not just the number: a caller that hit
 * this read `to_agents.max(8)` on the schema, counted eight entries, and was
 * refused — because `to_agent` was the ninth. Telling them "at most eight" and
 * stopping there sends them back to count the same eight again.
 */
export const AGENT_CAP_NOTE = `One post may address at most ${MAX_ADDRESSED_AGENTS} agents in total — \`to_agent\` and \`to_agents\` are ONE address between them, merged and deduped before the limit is applied, so \`to_agent\` counts as one of the ${MAX_ADDRESSED_AGENTS}. Naming the same agent twice (by handle and by id) collapses to one. To reach more than ${MAX_ADDRESSED_AGENTS}, post twice.`;
