import { z } from "zod";
import { closedEnum } from "@/shared/lib/closed-enum";
import type { AgentPresenceStatus, ConsentDecisionSurface } from "./types";

/**
 * COLLAB request schemas — consent, trust and presence.
 *
 * ⚠ SPLIT OUT OF `schema.ts` ON 2026-08-19, when that file sat at EXACTLY the
 * 500-line cap and the members PATCH grew a `favorite` field (INVARIANTS §5).
 * §1's rule is that a file at 500 cannot absorb a COMMENT, so the fix was a
 * split, not a shorter docblock.
 *
 * ⚠ THE SPLIT LINE IS NOT "wherever 100 lines fell". It is the boundary
 * `server/repository-collab.ts` already draws — *consent + trust + presence*,
 * in those words, in `repository.ts`'s own docblock. Those three change together
 * (they are one feature: standing permission for somebody else's agent to act,
 * and whether the machine behind it is alive) and change for reasons the CHANNEL
 * and MESSAGE schemas do not share. Second precedent in the same file:
 * `schema-sessions.ts`, split earlier and re-exported the same way.
 *
 * ⚠ RE-EXPORTED THROUGH `schema.ts`, so every existing
 * `@/features/channels/schema` import stays unchanged. Import either; do not
 * create a third path to the same symbol.
 */

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
  // ⚠ NO `.min(1)`, unlike `schema.ts`'s same-named post field — deliberate, and
  // that file's comment carries the full reasoning. In short: a consent ROW must
  // exist whether or not there was anything to summarize, so empty is a real
  // stored value here and a refused one there.
  summary: z.string().trim().max(200).optional().default(""),
  bodyPreview: z.string().max(16000).optional().default(""),
};

/**
 * Create an OUTBOUND consent request — the operator's own agent drafted a reply
 * and a human has to Send it before it leaves the machine.
 *
 * ⚠ `operatorUserId` is NEVER in the body — always the authenticated caller, so
 * a caller can only raise a request addressed to themselves.
 *
 * ⚠ THE INBOUND ARM IS DELETED (2026-08-22, Samuel: "remove all the stuff about
 * declining and approving of threads"), and DELETED rather than refused at the
 * service. This was a `z.discriminatedUnion("kind", …)` with an `inbound`
 * member; a `kind:"inbound"` body now fails schema validation at the route with
 * the ordinary 400, which is the shape this tree retires things in — a validator
 * that still ACCEPTS the value and then throws is a second place to keep in step
 * and a lane that half-exists.
 *
 * ⚠ `kind` STAYS ON THE WIRE, as a literal. The column is not going anywhere
 * (decided inbound rows are kept for audit) and the desktop still SENDS the
 * field, so dropping it would 400 an outbound create from an older build over a
 * value that is correct. It is a one-member literal on purpose: it names which
 * lane survived, in the request itself.
 *
 * ⚠ `proposedReply` was always outbound-only — accepting it on inbound would
 * have let a caller pre-seed the outbound review's payload. `messageSeq` is the
 * de-dupe key, so a retry cannot stack review cards.
 */
export const ConsentCreateSchema = z.object({
  ...consentCreateBase,
  kind: z.literal("outbound"),
  messageSeq: ConsentMessageSeqSchema.optional(),
  proposedReply: z.string().max(16000).optional(),
});
export type ConsentCreateInput = z.infer<typeof ConsentCreateSchema>;

/**
 * Which human surface recorded the decision — persisted verbatim into
 * `decided_by` for audit. ⚠ `trust` is server-generated only (standing rule,
 * not a human click) and deliberately NOT accepted from a caller.
 */
/** ⚠ Annotated so TS-side drift breaks the build — see
 *  `schema.ts › VisibilitySchema` for the full reasoning. */
const ConsentDecidedBySchema = closedEnum<ConsentDecisionSurface>()([
  "web",
  "desktop",
]);

/** PATCH /consent/[id] body: the operator's decision + which surface made it. */
export const ConsentDecisionSchema = z.object({
  decision: z.enum(["allow", "deny"]),
  decidedBy: ConsentDecidedBySchema.optional().default("web"),
});
export type ConsentDecisionInput = z.infer<typeof ConsentDecisionSchema>;

/**
 * Consent inbox filter. `pending` (default, web inbox) = still needs an answer.
 * `decided` = audit view, and since 2026-08-22 that is where the retired INBOUND
 * lane's history lives: decided inbound rows are kept, and this is the only
 * filter that returns them (along with any `auto_allowed` row a standing trust
 * rule ever wrote — none did). `all` = both.
 */
const ConsentStatusFilterSchema = z.enum(["pending", "decided", "all"]);
export type ConsentStatusFilter = z.infer<typeof ConsentStatusFilterSchema>;

/** `?channelId=<uuid>&status=<pending|decided|all>` for the consent inbox. */
export const ConsentListQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
  status: ConsentStatusFilterSchema.optional().default("pending"),
});
export type ConsentListQuery = z.infer<typeof ConsentListQuerySchema>;

// ⚠ `TrustMutateSchema` STOOD HERE AND IS DELETED (2026-08-22) with the
// `POST` / `DELETE /api/channels/trust` routes it parsed and the
// `agent_trust_rules` table behind them. Standing consent existed to auto-allow
// INBOUND requests; that lane is retired, so there is nothing left for a rule to
// grant. See `20260822140000_retire_inbound_consent_and_trust.sql`.

// ─── Presence (desktop heartbeat) ───────────────────────────────────────────

/**
 * POST /presence body: optional status label (defaults 'listening').
 * ⚠ Closed enum, not free text — a matching CHECK constraint backs the column,
 * and the value is surfaced in the UI as listener state.
 */
export const PresenceHeartbeatSchema = z.object({
  /** ⚠ Annotated so TS-side drift breaks the build — see
   *  `schema.ts › VisibilitySchema`. */
  status: closedEnum<AgentPresenceStatus>()([
    "listening",
    "busy",
    "paused",
    "offline",
  ]).optional(),
});
export type PresenceHeartbeatInput = z.infer<typeof PresenceHeartbeatSchema>;
