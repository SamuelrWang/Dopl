import { z } from "zod";
import { safeLabel, safeOptionalLabel } from "@/shared/lib/safe-label";
import {
  CHANNEL_FANOUT_MAX_ADDRESSEES,
  DEFAULT_MESSAGE_LIMIT,
  MAX_AWAIT_TIMEOUT_MS,
  MAX_MESSAGE_LIMIT,
  MAX_METADATA_SERIALIZED_BYTES,
} from "./constants";
import type { MessageIntent } from "./types";

/**
 * Removed multiplayer params (`docs/CHANNELS-ROLLBACK-PLAN.md` §1).
 *
 * ⚠ `z.never()`, not deletion: zod STRIPS unknown keys, so a plain delete makes
 * an old client's `to_agent` post succeed and address nobody — the invisible
 * delivery failure the addressing contract exists to prevent. Present → 400
 * naming the replacement; absent → field never appears.
 *
 * Delete once no build in the field still sends them.
 */
function removedParam(message: string) {
  return z.never({ error: message }).optional();
}

const REMOVED_TO_AGENT =
  "Agent addressing was removed. Address a PERSON with `toUserId`, or leave the message unaddressed.";
const REMOVED_AUTHOR_AGENT =
  "Named-agent authorship was removed. A message is its human author's; there is no agent identity to post as.";
const REMOVED_PARTICIPANTS =
  "Breakout-room participants were removed. A thread is between its creator and the member in `toUserId`.";
const REMOVED_THREAD_CLOSE =
  "Threads no longer close; pause or end the agent instead.";

/**
 * {@link removedParam}, at the OP level: a retired arm of a discriminated union
 * that parses far enough to say what replaced it, then always fails.
 *
 * ⚠ **DELETING THE ARM IS NOT THE SAME THING.** `z.discriminatedUnion` answers
 * an unrecognized discriminator with `invalid_union` / "No matching
 * discriminator", message **"Invalid input"** — so an installed desktop asking
 * to close a thread was told its body was malformed, with no hint that the
 * CONCEPT is gone. The refusal is a `custom` issue at the ROOT path, which
 * `shared/api/parse-json.ts` promotes into `error.message` for a form route and
 * carries in `details` for everyone else. Delete the arm outright once no build
 * in the field still sends the op.
 */
function removedOp(op: string, message: string) {
  return z.object({ op: z.literal(op) }).refine(() => false, { error: message });
}

const VisibilitySchema = z.enum(["private", "public"]);

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
const PostableAuthorKindSchema = z.enum(["user", "agent"]);
// `system` server-emitted only (matches MCP post enum). Full kind union incl.
// `system` lives in types.ts; schema only validates caller input.
const PostableMessageKindSchema = z.enum([
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
 */
export const ChannelUpdateSchema = z
  .object({
    name: ChannelNameSchema.optional(),
    topic: ChannelTopicSchema.optional(),
    visibility: VisibilitySchema.optional(),
    archived: z.boolean().optional(),
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
const MessageIntentSchema: z.ZodType<MessageIntent> = z.enum([
  "chat",
  "request",
]);

/**
 * Post a message or activity event. `body` carries the human-readable render
 * (thread needs no per-kind special-casing); structured payload rides in
 * `metadata`. `clientMsgId` is the idempotency key.
 *
 * `toUserId` must be an ACTIVE member (service validates, else 400); `summary`
 * is the one-liner in the receiver's notification. Both persist into `metadata`
 * as `{to_user_id, summary}`. `intent` → {@link MessageIntentSchema}.
 *
 * `z.never()` fields below → {@link removedParam}.
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
  summary: z.string().trim().min(1).max(200).optional(),
  intent: MessageIntentSchema.optional(),
  toAgent: removedParam(REMOVED_TO_AGENT),
  toAgents: removedParam(REMOVED_TO_AGENT),
  authorAgentId: removedParam(REMOVED_AUTHOR_AGENT),
});
export type ChannelMessageCreateInput = z.infer<
  typeof ChannelMessageCreateSchema
>;

// ─── Tasks (first-class channel tasks, v15) ─────────────────────────────────

/** Task execution mode. `set_task_mode` governs the creator's own machine. */
const TaskModeSchema = z.enum(["interactive", "autonomous"]);

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
 * (`server/service-tasks-fanout.ts › addresseeClientMsgId`) AND the seed of the
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

/** Per-member responding-agent tool scope (self-service preference). */
const AgentToolProfileSchema = z.enum(["full", "dopl_only", "read_only"]);

/**
 * PATCH /members: member updates their OWN per-channel agent tool profile.
 * Self-only — service always targets the caller's row. Empty patch rejected.
 *
 * `notifyScope` is now an unknown key (F-170 removed it) and zod STRIPS it: a
 * stale client sending it alone hits the empty-patch refusal. Intended.
 */
export const ChannelMemberSelfUpdateSchema = z
  .object({
    agentToolProfile: AgentToolProfileSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "Empty patch" });
export type ChannelMemberSelfUpdateInput = z.infer<
  typeof ChannelMemberSelfUpdateSchema
>;

export const ChannelMemberAddSchema = z.object({
  userId: z.string().uuid(),
});
export type ChannelMemberAddInput = z.infer<typeof ChannelMemberAddSchema>;

export const ChannelMemberRemoveSchema = z.object({
  userId: z.string().uuid(),
});
export type ChannelMemberRemoveInput = z.infer<
  typeof ChannelMemberRemoveSchema
>;

/**
 * `?since=<seq>&limit=<n<=200>&thread=<taskId>` for a message read.
 *
 * `thread` is a FILTER, not a lookup: keeps rows whose `metadata.taskId`
 * equals it. ⚠ Deliberately ANY non-empty string, NOT `.uuid()` — the
 * transcript still carries legacy `task-<channelId>-<seq>` ids from before
 * threads were a table, and `.uuid()` would 400 exactly those.
 *
 * Never checked against `channel_tasks`: an unmatched id returns `[]`, not an
 * error. Length bounded like `clientMsgId`.
 */
export const MessageReadQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_MESSAGE_LIMIT)
    .optional()
    .default(DEFAULT_MESSAGE_LIMIT),
  thread: z.string().trim().min(1).max(200).optional(),
});
export type MessageReadQuery = z.infer<typeof MessageReadQuerySchema>;

/**
 * `?since=<seq>&timeoutMs<=50000&excludeAuthor=<userId>` for the await
 * long-poll. `excludeAuthor` is OPT-IN: desktop listener omits it (needs its
 * own account's messages for thread targeting, requester-window routing,
 * version-skew observation); MCP await passes the caller's own id so its own
 * posts cannot pop its hold.
 */
export const AwaitQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().optional(),
  timeoutMs: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_AWAIT_TIMEOUT_MS)
    .optional(),
  excludeAuthor: z.string().uuid().optional(),
});
export type AwaitQuery = z.infer<typeof AwaitQuerySchema>;

// ─── Consent (inbound consent + outbound review) ────────────────────────────

/**
 * Triggering message's `seq`. ⚠ NOT coerced — arrives in a JSON body, where
 * `z.coerce.number()` turns `null` / `""` / `[]` into 0 and `true` into 1, and
 * a de-dupe key must never be manufactured from junk. `seq` is 1-based, so 0 is
 * never real. Coercion belongs on query strings only.
 */
const ConsentMessageSeqSchema = z.number().int().positive();

/** Fields every consent create carries, whatever the kind. */
const consentCreateBase = {
  channelId: z.string().uuid(),
  summary: z.string().trim().max(200).optional().default(""),
  bodyPreview: z.string().max(16000).optional().default(""),
};

/**
 * Create a consent request (desktop POSTs on trigger / on drafted reply).
 *
 * ⚠ `operatorUserId` is NEVER in the body — always the authenticated caller, so
 * a caller can only raise a request addressed to themselves. `requesterUserId`
 * derived server-side from the triggering message.
 *
 * Discriminated on `kind`: only OUTBOUND carries `proposedReply` — accepting it
 * on inbound would let a caller pre-seed the outbound review's payload.
 * `messageSeq` is the de-dupe key for BOTH kinds, so retries can't stack cards.
 */
export const ConsentCreateSchema = z.discriminatedUnion("kind", [
  z.object({
    ...consentCreateBase,
    kind: z.literal("inbound"),
    messageSeq: ConsentMessageSeqSchema.optional(),
  }),
  z.object({
    ...consentCreateBase,
    kind: z.literal("outbound"),
    messageSeq: ConsentMessageSeqSchema.optional(),
    proposedReply: z.string().max(16000).optional(),
  }),
]);
export type ConsentCreateInput = z.infer<typeof ConsentCreateSchema>;

/**
 * Which human surface recorded the decision — persisted verbatim into
 * `decided_by` for audit. ⚠ `trust` is server-generated only (standing rule,
 * not a human click) and deliberately NOT accepted from a caller.
 */
const ConsentDecidedBySchema = z.enum(["web", "desktop"]);

/** PATCH /consent/[id] body: the operator's decision + which surface made it. */
export const ConsentDecisionSchema = z.object({
  decision: z.enum(["allow", "deny"]),
  decidedBy: ConsentDecidedBySchema.optional().default("web"),
});
export type ConsentDecisionInput = z.infer<typeof ConsentDecisionSchema>;

/**
 * Consent inbox filter. `pending` (default, web inbox) = still needs an answer.
 * `decided` = audit view; ONLY way to read the `auto_allowed` rows a trust rule
 * writes ("your agent ran N times without asking"). `all` = both.
 */
const ConsentStatusFilterSchema = z.enum(["pending", "decided", "all"]);
export type ConsentStatusFilter = z.infer<typeof ConsentStatusFilterSchema>;

/** `?channelId=<uuid>&status=<pending|decided|all>` for the consent inbox. */
export const ConsentListQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
  status: ConsentStatusFilterSchema.optional().default("pending"),
});
export type ConsentListQuery = z.infer<typeof ConsentListQuerySchema>;

/**
 * Session-state schemas live in `schema-sessions.ts`; re-exported here so every
 * existing `@/features/channels/schema` import stays unchanged.
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

// ─── Trust (per-teammate standing consent) ──────────────────────────────────

/** POST / DELETE /trust body: the teammate whose agent is (un)trusted. */
export const TrustMutateSchema = z.object({
  trustedUserId: z.string().uuid(),
});
export type TrustMutateInput = z.infer<typeof TrustMutateSchema>;

// ─── Presence (desktop heartbeat) ───────────────────────────────────────────

/**
 * POST /presence body: optional status label (defaults 'listening').
 * ⚠ Closed enum, not free text — a matching CHECK constraint backs the column,
 * and the value is surfaced in the UI as listener state.
 */
export const PresenceHeartbeatSchema = z.object({
  status: z.enum(["listening", "busy", "paused", "offline"]).optional(),
});
export type PresenceHeartbeatInput = z.infer<typeof PresenceHeartbeatSchema>;
