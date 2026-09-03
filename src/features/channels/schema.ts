import { z } from "zod";
import { safeLabel, safeOptionalLabel } from "@/shared/lib/safe-label";
import { closedEnum } from "@/shared/lib/closed-enum";
import {
  CHANNEL_FANOUT_MAX_ADDRESSEES,
  MAX_METADATA_SERIALIZED_BYTES,
} from "./constants";
import type {
  ChannelVisibility,
  MessageIntent,
  PostableAuthorKind,
  PostableMessageKind,
  ThreadMode,
} from "./types";
// ⚠ THE RETIRED PARAMETERS LIVE IN THEIR OWN MODULE (§1 split, 2026-08-25) —
// they are the one block here scheduled to STOP existing, and that file carries
// the delete-me clock. Nothing about their behaviour moved.
// ⚠ FROM THE LAUNCH SCHEMA, not a second declaration: the ceiling and the request
// it clamps must be the same two ORDERED enums (the comparison is an index).
import { ChannelAgentPostureSchema } from "./schema-launch";
import {
  REMOVED_PARTICIPANTS,
  REMOVED_THREAD_CLOSE,
  removedOp,
  removedParam,
} from "./schema-removed-params";
import { ChannelInfoCardSchema } from "./info-card";
import {
  ChannelEscalationAnswerSchema,
  ChannelEscalationSchema,
} from "./escalation";

/** ⚠ ANNOTATED `z.ZodType<ChannelVisibility>` (2026-08-20) so TS-side drift BREAKS THE
 * BUILD. This set is declared twice — the union in `types.ts` and this enum —
 * and nothing tied them, so adding a member to one silently left the other
 * behind. `schema.ts › MessageIntentSchema` was the only one carrying the
 * annotation; the rest were on trust. (Several also have a third statement as a
 * SQL `CHECK`, which no TypeScript can reach — that one is still on trust.) */
const VisibilitySchema = closedEnum<ChannelVisibility>()(["private", "public"]);

/**
 * CHARSET GATE on the channel header. `name` / `topic` are peer-authored and
 * spliced into `dopl_channel` results as SERVER NARRATION (outside the
 * untrusted-content headers that disclaim message bodies), so a newline forges
 * a line. Length bounds alone are not enough. MCP renderers neutralize too, but
 * they are not the only consumers (`channels-v2/sidebar.tsx` filters on the
 * display name and the info tab renders the topic inline; the desktop listener
 * builds prompts from channel context).
 *
 * ⚠ Rule lives in `@/shared/lib/safe-label`, shared with `DISPLAY_NAME_RE` in
 * `src/app/api/user/profile/route.ts` — same class, same error copy. Bans C0 /
 * DEL, zero-width, bidi-override, line/paragraph separators.
 */

/** `name` — required where it appears, trimmed, 1..120, charset-bounded. */
const ChannelNameSchema = safeLabel("Channel name", 120);

/**
 * `topic` — optional so `""` stays legal (create dialog sends it cleared; column
 * is NOT NULL default `''`). `safeOptionalLabel` carries the empty-string branch.
 */
const ChannelTopicSchema = safeOptionalLabel("Channel topic", 2000);
// `system` server-reserved — caller must not post an anonymized system-styled
// message. `agent` stays postable: desktop posts task results with authorKind
// `agent` over a cookie session; service derives agent vs user from the token
// when authorKind omitted.
// ⚠ `closedEnum` over the DERIVED `PostableAuthorKind` — see `MessageKind` below.
const PostableAuthorKindSchema = closedEnum<PostableAuthorKind>()([
  "user",
  "agent",
]);
// `system` server-emitted only. ⚠ `closedEnum` over the DERIVED type, so drift
// against the full union is a COMPILE ERROR both ways; the three statements no
// compiler reaches (the column CHECK, the SDK's two mirrors) are held by
// `scripts/check-message-kind-drift.ts`. Argument: `types.ts › PostableMessageKind`.
const PostableMessageKindSchema = closedEnum<PostableMessageKind>()([
  "message",
  "task_started",
  "task_progress",
  "task_finished",
  "task_failed",
]);

/**
 * Create a channel. Two shapes on one endpoint:
 *   - normal — service derives `slug` + resolves collisions; visibility
 *     defaults private.
 *   - direct — 1:1; service stores placeholder name + private. Dedup,
 *     membership-of-2, self-target rejection all enforced server-side.
 *
 * ⚠ Plain union, NOT discriminated: normal branch has no discriminator to add,
 * so today's `{ name }` callers keep parsing unchanged.
 */
export const ChannelCreateSchema = z.union([
  z.object({
    direct: z.literal(true),
    memberUserId: z.string().uuid(),
  }),
  z.object({
    direct: z.literal(false).optional(),
    name: ChannelNameSchema,
    slug: z.string().trim().min(1).max(80).optional(),
    topic: ChannelTopicSchema.optional(),
    visibility: VisibilitySchema.optional(),
  }),
]);
export type ChannelCreateInput = z.infer<typeof ChannelCreateSchema>;

/**
 * Update a channel header. `archived` toggles the archive state
 * (stamps / clears `archived_at`). At least one field is required.
 *
 * ⚠ `infoCard` IS NOT A HEADER FIELD AND DOES NOT WEAR THE HEADER'S GATE
 * (2026-08-25). The other four are MANAGE writes — name, topic, who can see the
 * room, whether it is archived — and `service-writes.ts › updateChannel` keeps
 * requiring `canManageChannel` for every one of them. The info card is the
 * channel's own shared scratch surface, so it is gated on MEMBERSHIP instead;
 * the argument, and why that is not a widening of the header, is in that
 * function's docblock. The SHAPE is stated once in `./info-card.ts`.
 */
export const ChannelUpdateSchema = z
  .object({
    name: ChannelNameSchema.optional(),
    topic: ChannelTopicSchema.optional(),
    visibility: VisibilitySchema.optional(),
    archived: z.boolean().optional(),
    infoCard: ChannelInfoCardSchema.optional(),
    /** **THE POSTURE CEILING A LAUNCH IS CLAMPED TO** (A9 — G6/G7). ⚠ MANAGE-gated
     *  (`service-writes.ts › MANAGED_CHANNEL_FIELDS`), the OPPOSITE call from
     *  `infoCard` one field up: a card is a shared scratch surface, and this is
     *  how much room somebody else's agent gets here. Widening is a permission
     *  change. */
    agentPosture: ChannelAgentPostureSchema.optional(),
    /**
     * **RR3's DEFAULT RESPONDER** (2026-09-02, B4 — ruling B6). ⚠ The grammar is
     * `channel_sessions.name`'s VERBATIM and `20260918120000`'s CHECK is its
     * twin: a third spelling of "what an agent handle looks like" is how this
     * comes to name something no session can be. ⚠ `.nullable()` is the CLEAR,
     * on `agentPosture`'s terms — absent leaves it, `null` withdraws it, and
     * without the pair a nomination is permanent. ⚠ MANAGED, not member-gated
     * (`MANAGED_CHANNEL_FIELDS`): it decides whose machine the room's
     * unaddressed work lands on.
     */
    defaultResponderAgentName: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{1,30}$/, {
        error: "Agent handle must match ^[a-z][a-z0-9-]{1,30}$",
      })
      .nullable()
      .optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "Empty patch" });
export type ChannelUpdateInput = z.infer<typeof ChannelUpdateSchema>;

/**
 * CHAT vs REQUEST — whether a post may reach anybody's agent.
 *  - `request` (DEFAULT, what every existing caller gets) — an EXPLICIT
 *    `toUserId` addresses, and the receiving listener triggers on it.
 *  - `chat` — human talk. It STATES that this post is not work for anybody,
 *    which the receiving side reads, and it keeps the post out of an open DM
 *    thread (`resolvePostMetadata` never resolves a peer for it). Everything
 *    else normal (seq, realtime, read watermark, explicit `thread` tag).
 *
 * ⚠ `chat` no longer has an AUTO-ADDRESS to suppress. The DM fallback that
 * stamped the peer when a caller named nobody was retired 2026-08-18 (wiring
 * plan Phase 3), so an unaddressed post reaches nobody's agent under either
 * intent. What survives is the DECLARATION and the inheritance gate.
 *
 * ⚠ `chat` + explicit human `to` is a contradiction → 400
 * `CHANNEL_CHAT_ADDRESSED` (`server/errors.ts`), never silently resolved:
 * addressing a person starts their agent on a subject they saw no title for.
 */
const MessageIntentSchema = closedEnum<MessageIntent>()(["chat", "request"]);

/**
 * Post a message or activity event. `body` carries the human-readable render
 * (thread needs no per-kind special-casing); structured payload rides in
 * `metadata`. `clientMsgId` is the idempotency key.
 *
 * `toUserId` must be an ACTIVE member (service validates, else 400); `summary`
 * is the one-liner in the receiver's notification. Both persist into `metadata`
 * as `{to_user_id, summary}`. `intent` → {@link MessageIntentSchema}.
 *
 * ⚠ **THE THREE NAMED-AGENT TOMBSTONES ARE GONE (2026-09-02):** `toAgent` /
 * `toAgents` / `authorAgentId` met the delete-me clock in
 * `schema-removed-params.ts` and are now dropped like any unknown key. Neither
 * fence that mattered moved with them — the MCP lane still refuses `to_agent` BY
 * NAME through `z.strictObject`, and the snake_case METADATA strip stays, which
 * is a different fence and a permanent one. **F-434 is why those are not one
 * deletion.**
 */
export const ChannelMessageCreateSchema = z.object({
  body: z.string().min(1).max(16000),
  kind: PostableMessageKindSchema.optional(),
  authorKind: PostableAuthorKindSchema.optional(),
  // F-060 (size-cap half): bound the free-form blob by serialized size — see
  // MAX_METADATA_SERIALIZED_BYTES. The rate-limit half is still open.
  metadata: z
    .record(z.string(), z.unknown())
    .refine((m) => JSON.stringify(m).length <= MAX_METADATA_SERIALIZED_BYTES, {
      error: `metadata is too large (max ${MAX_METADATA_SERIALIZED_BYTES} bytes serialized)`,
    })
    .optional(),
  clientMsgId: z.string().min(1).max(200).optional(),
  toUserId: z.string().uuid().optional(),
  /**
   * **THE ONE RECIPIENT, IN EITHER NAMESPACE** (2026-09-02, B4 — ruling B1): a
   * member (user id or email) **or an agent** (`@agent-<id>` / `@<handle>`),
   * resolved by `server/service-writes-metadata-recipient.ts ›
   * resolveToRecipient`, which 400s `CHANNEL_RECIPIENT_UNRESOLVED` — listing the
   * live handles and the roster — when it names nobody.
   * ⚠ **IT DOES NOT REPLACE `toUserId`**: a member resolved here BECOMES that
   * field before any fence runs, so there is one addressee path and one
   * membership check, not two. `.max(320)` is RFC 5321's address ceiling.
   */
  to: z.string().trim().min(1).max(320).optional(),
  // ⚠ `.min(1)` HERE AND NO MINIMUM ON THE CONSENT ONE — DELIBERATE, not drift
  // (stated 2026-08-20 after an audit flagged the pair). Two concepts sharing a
  // name and a `max(200)`:
  //   • THIS is the POST's own summary — an optional author-supplied line that is
  //     re-stamped into `metadata.summary`. Absent is meaningful; PRESENT AND
  //     EMPTY is not, so it is refused rather than stored as a blank claim.
  //   • `schema-collab.ts › consentCreateBase.summary` is the CONSENT ROW's, which
  //     `.default("")`s because the row must exist whether or not the desktop had
  //     anything to say about it — a request with no summary is normal, and an
  //     empty string is how "nothing to show" is stored.
  // Changing either to match the other would break the surface that relies on it.
  summary: z.string().trim().min(1).max(200).optional(),
  intent: MessageIntentSchema.optional(),
  /**
   * A STRUCTURED ESCALATION, and AN ANSWER to one. ⚠ TOP-LEVEL VALIDATED FIELDS
   * AND NOT CALLER METADATA — the whole shape, and why, is stated once in
   * `./escalation.ts`; `resolvePostMetadata` folds 10 and 11 are what enforce it.
   */
  escalation: ChannelEscalationSchema.optional(),
  escalationAnswer: ChannelEscalationAnswerSchema.optional(),
});
export type ChannelMessageCreateInput = z.infer<
  typeof ChannelMessageCreateSchema
>;

// ─── Tasks (first-class channel tasks, v15) ─────────────────────────────────

/** Task execution mode. `set_task_mode` governs the creator's own machine. */
/** ⚠ Annotated so TS-side drift breaks the build — see `VisibilitySchema`.
 *  ⚠ The DOMAIN name is `ThreadMode`; `task` is the storage spelling (INVARIANTS
 *  §5), which is why the schema and the type do not share a name. */
const TaskModeSchema = closedEnum<ThreadMode>()(["interactive", "autonomous"]);

/**
 * Create a task. `title` = queryable header; `body` = initial request (posted
 * as the task's first message, addressed to `toUserId`); `mode` defaults
 * interactive. `toUserId` must be an active member (service validates).
 * `clientMsgId` idempotency key: a re-send returns the existing task rather
 * than double-creating it AND double-spawning the responder's window.
 */
export const TaskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mode: TaskModeSchema.optional(),
  body: z.string().min(1).max(16000),
  toUserId: z.string().uuid(),
  clientMsgId: z.string().min(1).max(200).optional(),
  /**
   * SPAWN-WITH-HANDOFF: external agent (operator's own Claude Desktop / Code
   * over MCP) asks that the driving session open ON THE OPERATOR'S MACHINE
   * instead of staying with the external session. Absent/false → external
   * create opens nothing locally and keeps the reply.
   *
   * Rides the opening message as reserved `metadata.handoff` (server-written,
   * never caller metadata — `service-writes-metadata.resolvePostMetadata`);
   * desktop listener reads it in `targeting.js` `requesterTaskOpen`.
   *
   * ⚠ Security gate: launch predicate ALSO requires `authorUserId === me` AND
   * `taskCreatedBy === me`, so a peer's handoff can never open a window on
   * someone else's machine.
   *
   * ⚠ **NO CURRENT BUILD READS THIS STAMP (F-274, measured 2026-08-22).** The
   * consumer — `dopl-desktop-app/main/targeting.js › requesterTaskOpen` — has no
   * caller; its listener path went with the session window (F-228). Everything
   * described above still HAPPENS (the field is accepted, stripped from caller
   * metadata, re-stamped server-side and stored), and the last layer is missing,
   * so a thread created with it behaves exactly like one created without it.
   * ⚠ KEPT AND STILL ACCEPTED ON PURPOSE: refusing it would 400 every older
   * external agent for no gain — an inert stamp is harmless — and a future
   * desktop could pick the lane back up. What was removed is the PROMISE, in the
   * two agent-facing strings that made it (`channel-description.ts`,
   * `channel-ops-threads.ts › opCreateThread`). ⚠ The live capability is the MCP
   * op `launch_agent` over `channel_launch_directives`, which asks the machine
   * and reports what it said.
   */
  handoff: z.boolean().optional(),
  /** REMOVED (rollback §1) — see {@link removedParam}. */
  participants: removedParam(REMOVED_PARTICIPANTS),
});
export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;

/**
 * Create ONE request against N addressees — the "New agent thread" panel's
 * send. Storage still holds one requester + one target per thread
 * (INVARIANTS §5), so the service loops `createTask`; this schema is the shape
 * of the ASK, not of a row.
 *
 * ⚠ `toUserIds` is `.min(1)`: **a fan-out with no addressees is a 400**, not an
 * empty success. Removing every pill reaches nobody, and a surface that
 * accepted the send would report a request that was never raised. The UI
 * disables Send at zero for the same reason — the refusal exists on both sides
 * because only one of them is the contract.
 *
 * ⚠ `clientMsgId` is REQUIRED here where `TaskCreateSchema` leaves it optional.
 * It is the BASE the per-addressee keys are derived from
 * (`server/service-tasks-broadcast.ts › addresseeClientMsgId`) AND the seed of the
 * group id the N threads share, so a fan-out without one has no way to converge
 * on retry and no stable card. Bounded well under `clientMsgId`'s own 200 so
 * the derived `${base}:${uuid}` keys stay inside it.
 */
export const TaskFanOutSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mode: TaskModeSchema.optional(),
  body: z.string().min(1).max(16000),
  toUserIds: z
    .array(z.string().uuid())
    .min(1, { error: "Address at least one agent" })
    .max(CHANNEL_FANOUT_MAX_ADDRESSEES),
  clientMsgId: z.string().min(1).max(120),
});
export type TaskFanOutInput = z.infer<typeof TaskFanOutSchema>;

/**
 * What POST `/channels/[channelId]/tasks` accepts: the fan-out shape or the
 * single-target one.
 *
 * ⚠ Plain union, FAN-OUT FIRST, and the order is load-bearing. There is no
 * discriminator to add without breaking every installed caller of the
 * single-target create (the desktop and the MCP lane both post it), and zod
 * STRIPS unknown keys — so a `{toUserIds}` body checked against
 * {@link TaskCreateSchema} first would fail only on the missing `toUserId` and
 * report that as the error. The two arms are mutually exclusive by their
 * REQUIRED fields, so first-match is exact.
 */
export const TaskCreatePayloadSchema = z.union([
  TaskFanOutSchema,
  TaskCreateSchema,
]);
export type TaskCreatePayloadInput = z.infer<typeof TaskCreatePayloadSchema>;

/** True for the fan-out arm of {@link TaskCreatePayloadSchema}. */
export function isTaskFanOutInput(
  input: TaskCreatePayloadInput
): input is TaskFanOutInput {
  return Array.isArray((input as TaskFanOutInput).toUserIds);
}

/**
 * Update a task. ONE op survives:
 *   - `set_mode` — creator only.
 *
 * ⚠ THREADS NO LONGER CLOSE (wiring plan Phase 4, 2026-08-18). The services
 * behind `close`, `propose_close` and `reopen` are DELETED, and the operator
 * pauses or ends an AGENT, not a thread.
 *
 * ⚠ **THE THREE SURVIVE AS TOMBSTONES ({@link removedOp}), WHICH IS NOT THE
 * SAME AS KEEPING THEM** — each parses, then always fails, naming the
 * replacement. **This docblock used to say a stale caller "fails the
 * discriminator with an invalid enum value"; zod does no such thing** — it
 * reports `invalid_union` / "No matching discriminator", message "Invalid
 * input", so an installed desktop's close request came back as a generic
 * malformed-body 400 with nothing to act on.
 *
 * ⚠ STILL A DISCRIMINATED UNION, ON PURPOSE: the wire shape is `{op, …}` and a
 * bare object would make `op` optional-by-omission. ⚠ **ONE LIVE ARM** — the
 * tombstones accept nothing; a second real op goes in beside `set_mode`.
 */
const TaskUpdateUnion = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_mode"), mode: TaskModeSchema }),
  removedOp("close", REMOVED_THREAD_CLOSE),
  removedOp("propose_close", REMOVED_THREAD_CLOSE),
  removedOp("reopen", REMOVED_THREAD_CLOSE),
]);

/**
 * ⚠ THE PARSED TYPE IS THE LIVE ARM ALONE. A tombstone never PRODUCES a value
 * (its refinement always fails), so the union's inferred output describes three
 * results the parser cannot return and a handler would write dead branches for
 * them. `Extract` states what `safeParse` can actually hand back.
 */
export type TaskUpdateInput = Extract<
  z.infer<typeof TaskUpdateUnion>,
  { op: "set_mode" }
>;
export const TaskUpdateSchema =
  TaskUpdateUnion as unknown as z.ZodType<TaskUpdateInput>;

/**
 * The MEMBER schemas — the self-service PATCH, add and remove — live in
 * `schema-members.ts` (§1 split, 2026-09-02, at the cap). Re-exported here for
 * the same reason every block below is: **this file is the barrel.** The seam is
 * the one the write layer already draws (`server/service-writes-members.ts`).
 */
export {
  ChannelMemberAddSchema,
  ChannelMemberRemoveSchema,
  ChannelMemberSelfUpdateSchema,
} from "./schema-members";
export type {
  ChannelMemberAddInput,
  ChannelMemberRemoveInput,
  ChannelMemberSelfUpdateInput,
} from "./schema-members";

/**
 * The READ-QUERY schemas — `MessageReadQuerySchema` (the transcript's paged read,
 * `since` / `before` / `limit` / `thread`) and `AwaitQuerySchema` (the long-poll
 * hold) — live in `schema-reads.ts` (split 2026-09-01 at the cap). Re-exported
 * here for the same reason the four blocks below are: this file is the barrel.
 */
export {
  AccountMessagesQuerySchema,
  AccountStatusQuerySchema,
  AwaitQuerySchema,
  MessageReadQuerySchema,
} from "./schema-reads";
export type {
  AccountMessagesQuery,
  AccountStatusQuery,
  AwaitQuery,
  MessageReadQuery,
} from "./schema-reads";


/**
 * Session-state schemas live in `schema-sessions.ts`, and the CONSENT / TRUST /
 * PRESENCE schemas in `schema-collab.ts` (split 2026-08-19 at the 500-line cap,
 * on the boundary `server/repository-collab.ts` already draws). Both are
 * re-exported here so every existing `@/features/channels/schema` import stays
 * unchanged — this file is the barrel, and there is no third path to a symbol.
 */
export {
  SessionStateQuerySchema,
  SessionStateReportSchema,
} from "./schema-sessions";
export type {
  SessionStateQuery,
  SessionStateEntryInput,
  SessionStateReportInput,
} from "./schema-sessions";

export {
  ConsentCreateSchema,
  ConsentDecisionSchema,
  ConsentListQuerySchema,
  PresenceHeartbeatSchema,
} from "./schema-collab";
export type {
  ConsentCreateInput,
  ConsentDecisionInput,
  ConsentListQuery,
  ConsentStatusFilter,
  PresenceHeartbeatInput,
} from "./schema-collab";

/**
 * LAUNCH-OVER-MCP schemas live in `schema-launch.ts` (2026-08-22), re-exported
 * here so this file stays the one barrel and there is no third path to a symbol
 * — the same arrangement `schema-sessions.ts` and `schema-collab.ts` have.
 */
export {
  // ⚠ THE AGENT-MANAGEMENT HALF (2026-09-01) rides the SAME file and the same
  // barrel: `end` / `rename` are kinds of directive, not a second lane.
  AgentDirectiveCreateSchema,
  ChannelAgentPostureSchema,
  LaunchClaimSchema,
  LaunchCreateSchema,
  LaunchDecideSchema,
  LaunchRefusalReasonSchema,
} from "./schema-launch";
export type {
  AgentDirectiveCreateInput,
  ChannelAgentPostureInput,
  LaunchClaimInput,
  LaunchCreateInput,
  LaunchDecideInput,
} from "./schema-launch";
// THE PRIVATE DIRECT LANE (2026-08-31) — same arrangement, same reason.
export {
  DirectionClaimSchema, DirectionCreateSchema,
  DirectionDecideSchema, DirectionRefusalReasonSchema,
} from "./schema-direction";
export type {
  DirectionClaimInput, DirectionCreateInput, DirectionDecideInput,
} from "./schema-direction";
