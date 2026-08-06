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
/** Duck-typed HTTP 400 from the Dopl API (across the @dopl/client boundary). */
export declare function isBadRequest(e: unknown): boolean;
/** Duck-typed HTTP 403 from the Dopl API (thread authorization refusals). */
export declare function isForbidden(e: unknown): boolean;
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
 *   (`participant_not_member` / `agent_not_in_channel` / `too_many_agents` were
 *   three more, all of them about NAMED AGENTS and breakout-room participants,
 *   and all three went with those surfaces — channels rollback §1. The route no
 *   longer emits their codes; a caller that still sends one of the removed
 *   params gets `VALIDATION_FAILED`, i.e. `invalid_request` above, with the
 *   field named in the server's own message.)
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
export type BadRequestKind = "addressee_not_member" | "thread_not_in_channel" | "self_target" | "invalid_request" | "chat_addressed" | "workspace" | "unknown";
export declare function classifyBadRequest(e: unknown): BadRequestKind;
/**
 * What a 403 from a channels route MEANS. Same doctrine as
 * {@link classifyBadRequest} and the same reason: the write ops caught a bare
 * `status === 403` and answered with one fixed sentence, so the ONE cause that
 * sentence named got reported for every other cause too.
 *
 *   - `not_a_member`         — `CHANNEL_FORBIDDEN`: the caller is not a member
 *     of the channel at all.
 *   - `thread_authorization` — `TASK_FORBIDDEN`: the caller IS in the channel
 *     and is not authorized on THIS THREAD. Every raiser is now the same rule —
 *     a thread's two parties are its creator and its target, and only those two
 *     may post into it, propose its close, close it, set its mode or reopen it
 *     (`service-tasks.ts`, `service-tasks-propose.ts`,
 *     `service-writes-metadata.ts`) — so the arm still has to say WHICH write it
 *     was refusing. It emphatically does NOT mean the caller left the channel.
 *     The CURATION rule on join and the narrower eject rule on leave used to
 *     raise it too; breakout participants are gone (channels rollback §1) and
 *     `join_thread` / `leave_thread` are not ops of this tool any more.
 *   - `unknown`              — a 403 with no code we recognize. Say so.
 *
 * THERE IS NO `agent_owner` ARM. It classified `CHANNEL_AGENT_FORBIDDEN` — an
 * agent identity the caller did not own (`as_agent`, rename, park) — and went
 * with named agents; the server records that code among the six nothing raises
 * (`src/features/channels/server/http-mapping.ts`). A build that somehow saw one
 * would land on `unknown`, which says so rather than guessing.
 */
export type ForbiddenKind = "not_a_member" | "thread_authorization" | "lifecycle_kind" | "close_is_human" | "unknown";
export declare function classifyForbidden(e: unknown): ForbiddenKind;
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
export declare function serverDetail(e: unknown): string;
/**
 * The caps the routes actually enforce, quoted in the invalid-request messages
 * so an agent that hit one has a number to act on. Mirrored (not re-derived)
 * from `src/features/channels/schema.ts`; the MCP zod schema in `channel.ts`
 * mirrors the same numbers so the common case never reaches the route at all.
 */
export declare const FIELD_CAPS_NOTE = "Field caps: title <=200 characters, body <=16000, a post's summary <=200, a close summary <=2000, client_msg_id <=200.";
