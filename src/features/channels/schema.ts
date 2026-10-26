import { z } from "zod";
import { safeLabel, safeOptionalLabel } from "@/shared/lib/safe-label";
import { closedEnum } from "@/shared/lib/closed-enum";
import { MAX_METADATA_SERIALIZED_BYTES } from "./constants";
import type {
  ChannelVisibility,
  PostableAuthorKind,
  PostableMessageKind,
} from "./types";
import { ChannelInfoCardSchema } from "./info-card";
import { MessageIntentSchema } from "./schema-intent";
import { CitesInputSchema } from "./schema-cites";
import { DisplayInputSchema } from "@/features/display/core/input";
import {
  ChannelEscalationAnswerSchema,
  ChannelEscalationSchema,
} from "./escalation";

/** ⚠ ANNOTATED `z.ZodType<ChannelVisibility>` (2026-08-20) so TS-side drift BREAKS THE
 *  BUILD: the union (`@dopl/contracts`, re-exported by `types.ts`) and this enum
 *  must agree. (The SQL `CHECK` is still on trust.) */
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
// `system` server-reserved. `agent` stays postable: the desktop posts thread results
// with authorKind `agent` over a cookie session, and the service derives agent vs user
// from the token when it is omitted.
// ⚠ `closedEnum` over the DERIVED `PostableAuthorKind` — see `MessageKind` below.
const PostableAuthorKindSchema = closedEnum<PostableAuthorKind>()([
  "user",
  "agent",
]);
// `system` server-emitted only. ⚠ `closedEnum` over the DERIVED type, so drift
// against the full union is a COMPILE ERROR both ways; the three statements no
// compiler reaches (today the column CHECK) are held by
// `scripts/check-message-kind-drift.ts`. Argument: `types.ts › PostableMessageKind`.
const PostableMessageKindSchema = closedEnum<PostableMessageKind>()([
  "message",
  "thread_started",
  "thread_progress",
  "thread_finished",
  "thread_failed",
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
   * **THE RECIPIENTS, ACROSS EITHER NAMESPACE** (2026-09-02, B4 — ruling B1;
   * widened to a COMMA-SEPARATED LIST 2026-09-18): members (user id or email)
   * **and agents** (`@agent-<id>` / `@<handle>`), resolved by
   * `server/service-writes-metadata-recipient.ts › resolveToRecipients`, which
   * 400s `CHANNEL_RECIPIENT_UNRESOLVED` — listing the live handles and the
   * roster — when ANY token names nobody.
   * ⚠ **IT DOES NOT REPLACE `toUserId`**: the FIRST member resolved here becomes
   * that field before any fence runs, so there is one `metadata.to_user_id` path
   * and one consent key — every member named is fenced, and all of them ride
   * `recipient_user_ids`.
   * ⚠ **`.max(3520)` IS THE LIST'S CEILING, NOT AN ADDRESS'S** —
   * `CHANNEL_SEND_MAX_RECIPIENTS` (10) × RFC 5321's 320, plus the separators.
   * The COUNT is what the resolver refuses on; this only stops a megabyte of
   * commas reaching it.
   */
  to: z.string().trim().min(1).max(3520).optional(),
  // ⚠ `.min(1)` HERE AND NO MINIMUM ON THE CONSENT ONE — DELIBERATE, not drift
  // (stated 2026-08-20 after an audit flagged the pair). Two concepts sharing a name
  // and a `max(200)`: THIS is the POST's own summary, where present-and-empty is a
  // blank claim and is refused; `schema-collab.ts › consentCreateBase.summary` is the
  // CONSENT ROW's, which `.default("")`s because the row must exist whether or not the
  // desktop had anything to say.
  summary: z.string().trim().min(1).max(200).optional(),
  intent: MessageIntentSchema.optional(),
  /**
   * **THE AUTHOR CANCELLED THE DEFAULT ADDRESS FOR THIS ONE MESSAGE** — `false`
   * turns RR3 off for this post and nothing else (Samuel, 2026-09-20: *"esc just
   * removes it for that message currently"*).
   *
   * ⚠ **IT EXISTS BECAUSE THE COMPOSER NOW WRITES THE TAG ITSELF.** An
   * auto-addressed message leaves the box with `@handle` really in its body
   * (`components/composer.tsx`), so the server sees a TYPED address and RR3 is
   * not consulted at all. Cancelling means the tag is not inserted — and without
   * this field the server would then repair the very address the author just
   * dismissed, which would make Escape a lie.
   *
   * ⚠ **ABSENT IS TODAY'S BEHAVIOUR, AND THAT IS THE WHOLE COMPATIBILITY STORY.**
   * Every other client — the web build, MCP, an installed desktop — sends
   * nothing here and keeps the repair. It is `false` or it is not there; `true`
   * is accepted and means the same as absent, so a caller cannot use it to ASK
   * for a repair it would not otherwise get.
   *
   * ⚠ **IT IS NOT `intent`.** That field already carries two meanings from two
   * clients and cost four days of silent misrouting for it
   * (`server/service-wake-verdict-record.ts`); overloading it a third time is the
   * same mistake with a new name.
   */
  autoAddress: z.boolean().optional(),
  /**
   * A STRUCTURED ESCALATION, and AN ANSWER to one. ⚠ TOP-LEVEL VALIDATED FIELDS
   * AND NOT CALLER METADATA — the whole shape, and why, is stated once in
   * `./escalation.ts`; `resolvePostMetadata` folds 10 and 11 are what enforce it.
   */
  escalation: ChannelEscalationSchema.optional(),
  escalationAnswer: ChannelEscalationAnswerSchema.optional(),
  /** An agent-built DISPLAY (`display/core` v2 blocks), stamped as reserved `metadata.display`
   *  — docs/specs/unified-display.md. `body` is its text fallback. With a `choice` block the
   *  server also stamps the decision index (`metadata.escalation`). */
  display: DisplayInputSchema.optional(),
  /**
   * **THE MESSAGES THIS POST CITES** (grammar B, Samuel's card #4401, 2026-10-12).
   *
   * ⚠ **THE FIELD IS WHAT MAKES A CITATION A LINK — PROSE NEVER IS.** A `#12`
   * typed into a body is text; a `#12` named here is resolved at write time and
   * stored as a message id. That is the ruling, and it is also what removes the
   * cutover: nothing downstream has to decide which namespace a digit meant.
   * `lib/cites.ts` carries the vocabulary; `schema-cites.ts` the validation.
   *
   * ⚠ **STRIPPED FROM CALLER `metadata` AND RE-STAMPED FROM HERE** — the
   * `mentionedUserIds` rule. A settable `metadata.cites` would let a post point a
   * reader at a row the server never checked it could see.
   */
  cites: CitesInputSchema.optional(),
}).refine((input) => !(input.escalation && input.display), {
  // ⚠ The server derives each from the other (spec §3.1); both at once is two answers to one question.
  error: "Send `escalation` or `display`, not both: the server derives the other.",
});
export type ChannelMessageCreateInput = z.infer<
  typeof ChannelMessageCreateSchema
>;

// ─── Threads ──────────────────────────────────────────────────────────────────
// The thread create / fan-out / update schemas live in `schema-threads.ts` (500-line cap
// split, 2026-10-11); re-exported here because this file is the barrel.
export {
  ThreadCreateSchema,
  ThreadFanOutSchema,
  ThreadCreatePayloadSchema,
  isThreadFanOutInput,
  ThreadUpdateSchema,
} from "./schema-threads";
export type { ThreadCreateInput, ThreadFanOutInput } from "./schema-threads";

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
  ChannelListQuerySchema,
  MessageReadQuerySchema,
} from "./schema-reads";
export type {
  AccountMessagesQuery,
  AccountStatusQuery,
  AwaitQuery,
  ChannelListQuery,
  MessageReadQuery,
} from "./schema-reads";

/**
 * The ARTIFACT write schema — `op="artifact"`'s create / add / remove / dissolve
 * (design #1220, accepted #1222) — lives in `schema-artifacts.ts`, re-exported
 * here: this file is the barrel, so there is no second path to a symbol.
 */
export { ArtifactActionSchema } from "./schema-artifacts";
export type { ArtifactActionInput } from "./schema-artifacts";


/**
 * Session-state schemas live in `schema-sessions.ts`, and the CONSENT / TRUST /
 * PRESENCE schemas in `schema-collab.ts` (split 2026-08-19 at the 500-line cap; presence
 * reads now live in `server/repository-presence.ts`), both re-exported here —
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
 * LAUNCH-OVER-MCP schemas live in `schema-launch.ts` (2026-08-22; `LaunchDecideSchema`
 * in `schema-launch-decide.ts`), re-exported here so this file stays the barrel.
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
  DirectionDecideSchema,
} from "./schema-direction";
export type {
  DirectionClaimInput, DirectionCreateInput, DirectionDecideInput,
} from "./schema-direction";
