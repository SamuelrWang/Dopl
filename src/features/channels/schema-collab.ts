import { z } from "zod";
import { closedEnum } from "@/shared/lib/closed-enum";
import type {
  AgentPresenceStatus,
  ConsentDecisionSurface,
  PresencePosture,
} from "./types";

/**
 * COLLAB request schemas — consent, trust and presence.
 *
 * ⚠ SPLIT OUT OF `schema.ts` ON 2026-08-19 at the 500-line cap (INVARIANTS §5), on
 * the boundary `server/repository-collab.ts` already draws — *consent + trust +
 * presence*, three things that change together and for reasons the CHANNEL and
 * MESSAGE schemas do not share. Precedent: `schema-sessions.ts`.
 *
 * ⚠ RE-EXPORTED THROUGH `schema.ts`, so every existing `@/features/channels/schema`
 * import stays unchanged. Import either; never create a third path to a symbol.
 */

/**
 * Triggering message's `seq`. ⚠ NOT coerced — in a JSON body `z.coerce.number()`
 * turns `null` / `""` / `[]` into 0 and `true` into 1, and a de-dupe key must never
 * be manufactured from junk (`seq` is 1-based, so 0 is never real).
 */
const ConsentMessageSeqSchema = z.number().int().positive();

/** Fields every consent create carries, whatever the kind. */
const consentCreateBase = {
  channelId: z.string().uuid(),
  // ⚠ NO `.min(1)`, unlike `schema.ts`'s same-named post field — deliberate, and that
  // file's comment carries the reasoning: a consent ROW must exist whether or not
  // there was anything to summarize, so empty is real here and refused there.
  summary: z.string().trim().max(200).optional().default(""),
  bodyPreview: z.string().max(16000).optional().default(""),
};

/**
 * Create an OUTBOUND consent request — the operator's own agent drafted a reply and a
 * human has to Send it before it leaves the machine. ⚠ `operatorUserId` is NEVER in
 * the body — always the authenticated caller, so a request can only be addressed to
 * the caller themselves.
 *
 * ⚠ THE INBOUND ARM IS DELETED (2026-08-22, Samuel: "remove all the stuff about
 * declining and approving of threads"), and DELETED rather than refused at the
 * service: a `kind:"inbound"` body fails schema validation at the route with the
 * ordinary 400, where a validator that ACCEPTS the value and then throws would be a
 * second place to keep in step. ⚠ `kind` STAYS ON THE WIRE as a one-member literal:
 * the column is not going anywhere (decided inbound rows are kept for audit) and the
 * desktop still sends the field, so dropping it would 400 an older build.
 *
 * ⚠ `proposedReply` was always outbound-only — on inbound it would have let a caller
 * pre-seed the outbound review's payload. `messageSeq` is the de-dupe key, so a retry
 * cannot stack review cards.
 */
export const ConsentCreateSchema = z.object({
  ...consentCreateBase,
  kind: z.literal("outbound"),
  messageSeq: ConsentMessageSeqSchema.optional(),
  proposedReply: z.string().max(16000).optional(),
});
export type ConsentCreateInput = z.infer<typeof ConsentCreateSchema>;

/**
 * Which human surface recorded the decision — persisted verbatim into `decided_by`
 * for audit. ⚠ `trust` is server-generated only (a standing rule, not a human click)
 * and deliberately NOT accepted from a caller.
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
 * Consent inbox filter. `pending` (default, web inbox) = still needs an answer;
 * `decided` = audit view, and since 2026-08-22 the only filter that returns the
 * retired INBOUND lane's history (plus any `auto_allowed` row a standing trust rule
 * ever wrote — none did); `all` = both.
 */
const ConsentStatusFilterSchema = z.enum(["pending", "decided", "all"]);
export type ConsentStatusFilter = z.infer<typeof ConsentStatusFilterSchema>;

/** `?channelId=<uuid>&status=<pending|decided|all>` for the consent inbox. */
export const ConsentListQuerySchema = z.object({
  channelId: z.string().uuid().optional(),
  status: ConsentStatusFilterSchema.optional().default("pending"),
});
export type ConsentListQuery = z.infer<typeof ConsentListQuerySchema>;

// ⚠ `TrustMutateSchema` STOOD HERE AND IS DELETED (2026-08-22) with the `POST` /
// `DELETE /api/channels/trust` routes and the `agent_trust_rules` table — standing
// consent auto-allowed INBOUND requests, and that lane is retired. See
// `20260822140000_retire_inbound_consent_and_trust.sql`.

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
    "active",
    "away",
  ]).optional(),
});
export type PresenceHeartbeatInput = z.infer<typeof PresenceHeartbeatSchema>;

/**
 * POST /presence/all body — the USER-SCOPED heartbeat (2026-09-08, §7).
 *
 * ⚠ **`status` IS REQUIRED HERE AND OPTIONAL ON THE PER-WORKSPACE ROUTE, ON PURPOSE.**
 * That route's default (`'listening'`) keeps pre-posture desktops working; a caller of
 * THIS route knows the posture, so an omitted one would be a bug reported as an
 * ambiguity rather than a 400. ⚠ **THE SET IS THE POSTURE, NOT `AgentPresenceStatus`**
 * — admitting the four legacy words would re-open the vocabulary the migration is
 * retiring.
 */
export const PresenceHeartbeatAllSchema = z.object({
  status: closedEnum<PresencePosture>()(["active", "away"]),
});
export type PresenceHeartbeatAllInput = z.infer<
  typeof PresenceHeartbeatAllSchema
>;
