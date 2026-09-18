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
// ⚠ THE RETIRED PARAMETERS LIVE IN THEIR OWN MODULE (§1 split, 2026-08-25) — the one
// block here scheduled to STOP existing, and that file carries the delete-me clock.
// ⚠ `ChannelAgentPostureSchema` IS NO LONGER IMPORTED (2026-09-06) with the ceiling.
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
 *  BUILD: the set is declared twice — the union in `types.ts` and this enum — and
 *  nothing tied them. (A third statement as a SQL `CHECK` is still on trust.) */
const VisibilitySchema = closedEnum<ChannelVisibility>()(["private", "public"]);

/**
 * CHARSET GATE on the channel header. `name` / `topic` are peer-authored and spliced
 * into `dopl_channel` results as SERVER NARRATION (outside the untrusted-content
 * headers that disclaim message bodies), so a newline forges a line and length bounds
 * alone are not enough. ⚠ Rule lives in `@/shared/lib/safe-label`, shared with
 * `DISPLAY_NAME_RE` in `src/app/api/user/profile/route.ts`: bans C0 / DEL,
 * zero-width, bidi-override, line/paragraph separators.
 */

/** `name` — required where it appears, trimmed, 1..120, charset-bounded. */
const ChannelNameSchema = safeLabel("Channel name", 120);

/**
 * `topic` — optional so `""` stays legal (create dialog sends it cleared; column
 * is NOT NULL default `''`). `safeOptionalLabel` carries the empty-string branch.
 */
const ChannelTopicSchema = safeOptionalLabel("Channel topic", 2000);
// `system` server-reserved. `agent` stays postable: the desktop posts task results
// with authorKind `agent` over a cookie session, and the service derives agent vs user
// from the token when it is omitted.
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
 * ⚠ Plain union, NOT discriminated: the normal branch has no discriminator to
 * add, so today's `{ name }` callers keep parsing unchanged.
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
 * Update a channel header. At least one field is required. ⚠ `infoCard` IS NOT A
 * HEADER FIELD AND DOES NOT WEAR THE HEADER'S GATE (2026-08-25): the other three are
 * MANAGE writes (`service-writes.ts › updateChannel` requires `canManageChannel`),
 * while the info card is the channel's shared scratch surface and is gated on
 * MEMBERSHIP. SHAPE in `./info-card.ts`.
 */
export const ChannelUpdateSchema = z
  .object({
    name: ChannelNameSchema.optional(),
    topic: ChannelTopicSchema.optional(),
    visibility: VisibilitySchema.optional(),
    infoCard: ChannelInfoCardSchema.optional(),
    // 🔴 **`archived` IS DELETED (Samuel's ruling R-21, 2026-09-17):** *"a user can
    // delete a channel; no point in archives."* It toggled `channels.archived_at`,
    // and the whole feature went with it — the Settings row, the client write, the
    // list filter and the Status row. ⚠ THE COLUMN SURVIVES THIS WAVE and nothing
    // writes it; a channel carrying an old stamp is now an ordinary channel. ⚠ An
    // old client sending `archived` is IGNORED rather than refused, like the two
    // dead fields below: this object is not `.strict()`.
    // ⚠ **`agentPosture` IS DELETED (2026-09-06, items 12, 13, 14)** — the posture CEILING
    // a launch was clamped to. It is off `MANAGED_CHANNEL_FIELDS` too, so it is unwritable,
    // not merely unvalidated.
    // ⚠ **`defaultResponderAgentName` IS DELETED (2026-09-07, Samuel's ruling on items 10
    // and 11)** — a room MANAGER pinning ONE agent to answer EVERY member's untagged
    // messages: *"if there's another member in the room, their last agent address would be
    // different from my last agent address"*, plus the stored handle decaying into naming
    // nothing.
    // ⚠ ITS REPLACEMENT IS PER-MEMBER AND MUST NOT BE ADDED HERE — it is written through
    // `ChannelMemberSelfUpdateSchema` (`schema-members.ts`) against the caller's OWN row, a
    // schema carrying no member identifier at all, which is the self-only guarantee.
    // ⚠ AN OLD CLIENT SENDING EITHER IS IGNORED, not refused: this object is not
    // `.strict()`, so a previous build patching a name is not rejected over a dead field.
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "Empty patch" });
export type ChannelUpdateInput = z.infer<typeof ChannelUpdateSchema>;

/**
 * CHAT vs REQUEST — whether a post may reach anybody's agent.
 *  - `request` (DEFAULT) — an EXPLICIT `toUserId` addresses, and the receiving
 *    listener triggers on it.
 *  - `chat` — human talk: it STATES that this post is not work for anybody, and keeps
 *    the post out of an open DM thread (`resolvePostMetadata` resolves no peer).
 *
 * ⚠ `chat` no longer has an AUTO-ADDRESS to suppress — the DM fallback was retired
 * 2026-08-18 (wiring plan Phase 3). What survives is the DECLARATION and the
 * inheritance gate. ⚠ `chat` + explicit human `to` is a contradiction → 400
 * `CHANNEL_CHAT_ADDRESSED` (`server/errors.ts`), never silently resolved: addressing a
 * person starts their agent on a subject they saw no title for.
 */
const MessageIntentSchema = closedEnum<MessageIntent>()(["chat", "request"]);

/**
 * Post a message or activity event. `body` carries the human-readable render;
 * structured payload rides in `metadata`; `clientMsgId` is the idempotency key.
 * `toUserId` must be an ACTIVE member (service validates, else 400) and `summary` is
 * the one-liner in the receiver's notification — both persist into `metadata` as
 * `{to_user_id, summary}`. `intent` → {@link MessageIntentSchema}.
 *
 * ⚠ **THE THREE NAMED-AGENT TOMBSTONES ARE GONE (2026-09-02):** `toAgent` /
 * `toAgents` / `authorAgentId` met the delete-me clock in `schema-removed-params.ts`
 * and are dropped like any unknown key. Neither fence that mattered moved with them —
 * the MCP lane still refuses `to_agent` BY NAME through `z.strictObject`, and the
 * snake_case METADATA strip stays. **F-434 is why those are not one deletion.**
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
  // (stated 2026-08-20 after an audit flagged the pair). Two concepts sharing a name
  // and a `max(200)`: THIS is the POST's own summary, where present-and-empty is a
  // blank claim and is refused; `schema-collab.ts › consentCreateBase.summary` is the
  // CONSENT ROW's, which `.default("")`s because the row must exist whether or not the
  // desktop had anything to say.
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
 * Create a task. `title` = queryable header; `body` = initial request (posted as
 * the task's first message, addressed to `toUserId`); `mode` defaults
 * interactive. `toUserId` must be an active member (service validates).
 * `clientMsgId` idempotency key: a re-send returns the existing task rather than
 * double-creating it AND double-spawning the responder's window.
 */
export const TaskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mode: TaskModeSchema.optional(),
  body: z.string().min(1).max(16000),
  toUserId: z.string().uuid(),
  clientMsgId: z.string().min(1).max(200).optional(),
  /**
   * SPAWN-WITH-HANDOFF: an external agent (the operator's own Claude Desktop / Code
   * over MCP) asks that the driving session open ON THE OPERATOR'S MACHINE.
   * Absent/false → the external create opens nothing locally and keeps the reply.
   * Rides the opening message as reserved `metadata.handoff` (server-written —
   * `service-writes-metadata.resolvePostMetadata`).
   *
   * ⚠ Security gate: the launch predicate ALSO requires `authorUserId === me` AND
   * `taskCreatedBy === me`, so a peer's handoff can never open a window elsewhere.
   *
   * ⚠ **NO CURRENT BUILD READS THIS STAMP (F-274, measured 2026-08-22).**
   * `dopl-desktop-app/main/targeting.js › requesterTaskOpen` has no caller; its
   * listener path went with the session window (F-228). Everything else still happens
   * (accepted, stripped from caller metadata, re-stamped, stored). ⚠ KEPT ON PURPOSE:
   * refusing it would 400 every older external agent for no gain. What was removed is
   * the PROMISE, in `channel-description.ts` and `channel-ops-threads.ts ›
   * opCreateThread`; the live capability is the MCP op `launch_agent`.
   */
  handoff: z.boolean().optional(),
  /** REMOVED (rollback §1) — see {@link removedParam}. */
  participants: removedParam(REMOVED_PARTICIPANTS),
});
export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;

/**
 * Create ONE request against N addressees — the "New agent thread" panel's send.
 * Storage still holds one requester + one target per thread (INVARIANTS §5), so the
 * service loops `createTask`; this is the shape of the ASK, not of a row.
 *
 * ⚠ `toUserIds` is `.min(1)`: **a fan-out with no addressees is a 400**, not an empty
 * success — a surface that accepted it would report a request never raised. The UI
 * disables Send at zero too; only one of the two is the contract.
 *
 * ⚠ `clientMsgId` is REQUIRED here where `TaskCreateSchema` leaves it optional: it is
 * the BASE the per-addressee keys derive from (`server/service-tasks-broadcast.ts ›
 * addresseeClientMsgId`) AND the seed of the group id the N threads share, so a
 * fan-out without one cannot converge on retry. Bounded under `clientMsgId`'s own 200
 * so the derived `${base}:${uuid}` keys stay inside it.
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
 * single-target one. ⚠ Plain union, FAN-OUT FIRST, and the order is load-bearing —
 * there is no discriminator to add without breaking every installed caller, and zod
 * STRIPS unknown keys, so a `{toUserIds}` body checked against
 * {@link TaskCreateSchema} first would fail only on the missing `toUserId`. The two
 * arms are mutually exclusive by their REQUIRED fields, so first-match is exact.
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
 * Update a task. ONE op survives: `set_mode` — creator only.
 *
 * ⚠ THREADS NO LONGER CLOSE (wiring plan Phase 4, 2026-08-18): the services behind
 * `close`, `propose_close` and `reopen` are DELETED, and the operator pauses or ends
 * an AGENT, not a thread. ⚠ **THE THREE SURVIVE AS TOMBSTONES ({@link removedOp}),
 * WHICH IS NOT THE SAME AS KEEPING THEM** — each parses, then always fails, naming
 * the replacement. (Zod reports `invalid_union` / "Invalid input", not an invalid
 * enum value, so an installed desktop's close request came back as a generic 400.)
 *
 * ⚠ STILL A DISCRIMINATED UNION, ON PURPOSE: the wire shape is `{op, …}` and a bare
 * object would make `op` optional-by-omission. ⚠ **ONE LIVE ARM** — a second real op
 * goes in beside `set_mode`.
 */
const TaskUpdateUnion = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_mode"), mode: TaskModeSchema }),
  removedOp("close", REMOVED_THREAD_CLOSE),
  removedOp("propose_close", REMOVED_THREAD_CLOSE),
  removedOp("reopen", REMOVED_THREAD_CLOSE),
]);

/**
 * ⚠ THE PARSED TYPE IS THE LIVE ARM ALONE. A tombstone never PRODUCES a value (its
 * refinement always fails), so the union's inferred output describes three results the
 * parser cannot return; `Extract` states what `safeParse` can actually hand back.
 */
export type TaskUpdateInput = Extract<
  z.infer<typeof TaskUpdateUnion>,
  { op: "set_mode" }
>;
export const TaskUpdateSchema =
  TaskUpdateUnion as unknown as z.ZodType<TaskUpdateInput>;

/**
 * The MEMBER schemas — the self-service PATCH, add and remove — live in
 * `schema-members.ts` (§1 split, 2026-09-02, at the cap), on the seam the write layer
 * already draws (`server/service-writes-members.ts`). Re-exported here for the same
 * reason every block below is: **this file is the barrel.**
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
 * The READ-QUERY schemas — `MessageReadQuerySchema` (the transcript's paged
 * read) and `AwaitQuerySchema` (the long-poll hold) — live in `schema-reads.ts`
 * (split 2026-09-01 at the cap), re-exported here: this file is the barrel.
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
 * The ARTIFACT write schema — `op="artifact"`'s create / add / remove / dissolve
 * (design #1220, accepted #1222) — lives in `schema-artifacts.ts`, re-exported
 * here: this file is the barrel, so there is no second path to a symbol.
 */
export {
  ARTIFACT_CREATE_MAX_MESSAGES,
  ArtifactActionSchema,
} from "./schema-artifacts";
export type { ArtifactActionInput } from "./schema-artifacts";


/**
 * Session-state schemas live in `schema-sessions.ts`, and the CONSENT / TRUST /
 * PRESENCE schemas in `schema-collab.ts` (split 2026-08-19 at the 500-line cap, on
 * the boundary `server/repository-collab.ts` already draws), both re-exported here —
 * this file is the barrel, and there is no third path to a symbol.
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
  PresenceHeartbeatAllSchema,
} from "./schema-collab";
export type {
  ConsentCreateInput,
  ConsentDecisionInput,
  ConsentListQuery,
  ConsentStatusFilter,
  PresenceHeartbeatInput,
  PresenceHeartbeatAllInput,
} from "./schema-collab";

/**
 * LAUNCH-OVER-MCP schemas live in `schema-launch.ts` (2026-08-22), re-exported
 * here so this file stays the one barrel and there is no third path to a symbol.
 */
export {
  // ⚠ THE AGENT-MANAGEMENT HALF (2026-09-01) rides the SAME file and the same
  // barrel: `end` / `rename` are kinds of directive, not a second lane.
  AgentDirectiveCreateSchema,
  // ⚠ `ChannelAgentPostureSchema` IS NO LONGER RE-EXPORTED (2026-09-06) — deleted
  // at its source in `schema-launch.ts` with the ceiling it validated.
  LaunchClaimSchema,
  LaunchCreateSchema,
  LaunchDecideSchema,
  LaunchRefusalReasonSchema,
} from "./schema-launch";
export type {
  AgentDirectiveCreateInput,
  // ⚠ `ChannelAgentPostureInput` went with its schema (2026-09-06).
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
