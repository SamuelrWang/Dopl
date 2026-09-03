/**
 * THE OUTBOUND/INBOUND CONSENT LANE's types (INVARIANTS §6).
 *
 * ⚠ **ITS OWN FILE (§1 split, 2026-09-02) BECAUSE `types.ts` REACHED THE 500-LINE
 * CAP**, and the seam is the one the rest of the feature already draws: consent
 * has its own service (`server/consent-service.ts`), its own route family and its
 * own table. These change when the REVIEW model changes, and `types.ts` when a
 * channel shape does. **`types.ts` is the barrel; there is no second import path
 * to any of these symbols.**
 */

/**
 * Consent request kind. `outbound` = the operator's own agent drafted a reply
 * awaiting Send / Cancel, and it is the ONLY kind anything writes.
 *
 * ⚠ `inbound` IS A READ-ONLY HISTORICAL VALUE (2026-08-22, Samuel). It meant "a
 * teammate's agent addressed the operator; Allow or Deny before this machine
 * spawns", and that lane is retired: a peer's ask notifies, and the operator
 * launches a session or does not. The value stays in this union because DECIDED
 * inbound rows are KEPT for audit and `mapConsentRow` casts the column onto this
 * type — deleting it would not delete the rows, it would make them fail to type.
 * ⚠ `schema-collab.ts › ConsentCreateSchema` no longer ACCEPTS it, so a create
 * naming it is a 400. That asymmetry is the point: readable, unwritable.
 */
export type ConsentKind = "inbound" | "outbound";

/**
 * Consent request lifecycle. `pending` awaits a decision; `allowed` / `denied`
 * are human decisions; `expired` elapsed unanswered.
 *
 * ⚠ `auto_allowed` IS READ-ONLY HISTORY, on `inbound`'s terms: it was written
 * only by the standing-trust birth in `createConsentRequest`, and
 * `agent_trust_rules` is dropped (2026-08-22), so nothing can produce one. Kept
 * so a stored row still types and still lists in the audit view.
 */
export type ConsentStatus =
  | "pending"
  | "allowed"
  | "denied"
  | "expired"
  | "auto_allowed";

/**
 * Which surface recorded a HUMAN decision, persisted into `decided_by`. Desktop
 * dialog and web card are equal peers, so audit must distinguish them.
 *
 * ⚠ `decided_by` can also hold `'trust'`, which is NOT in this union and never
 * was — it was server-written at CREATE time for a standing-rule auto-allow, and
 * deliberately unacceptable from a caller. That writer is deleted (2026-08-22),
 * so the value is stored history only; the DTO types the column as
 * `string | null` for exactly this reason.
 */
export type ConsentDecisionSurface = "web" | "desktop";

/**
 * A human-in-the-loop consent request: `outbound` — Send / Cancel before the
 * operator's own agent's reply leaves the machine. A server-side row so either
 * surface (web or desktop) can answer it, first answer wins.
 *
 * ⚠ A STORED ROW MAY STILL BE `inbound` (Allow / Deny before the operator's
 * machine spawned). That lane is retired (2026-08-22) and nothing raises one any
 * more, but decided rows are kept for audit and this type is what the audit read
 * returns — see {@link ConsentKind}.
 */
export type ChannelConsentRequest = {
  id: string;
  channelId: string;
  workspaceId: string;
  /** Who must decide (the recipient / operator). */
  operatorUserId: string;
  /** Inbound: who asked. Null for outbound. */
  requesterUserId: string | null;
  kind: ConsentKind;
  /** Inbound: seq of the triggering message. */
  messageSeq: number | null;
  summary: string;
  bodyPreview: string;
  /** Outbound: drafted reply awaiting Send. */
  proposedReply: string | null;
  status: ConsentStatus;
  /** 'web' | 'desktop' | 'trust'. */
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  /** Inbound only; null for outbound. */
  requesterName: string | null;
  requesterAvatarUrl: string | null;
};

// ⚠ `AgentTrustRule` STOOD HERE AND IS DELETED (2026-08-22, Samuel). It was the
// per-teammate standing-consent rule ("always allow Alice's agent"), and it only
// ever auto-allowed an INBOUND consent request — the lane that is retired. The
// `agent_trust_rules` table goes with it
// (`20260822140000_retire_inbound_consent_and_trust.sql`), so nothing this type
// described exists: not the routes, not the service, not the repository reads,
// not the relation. It never fired in production either — the rule was on hold
// by Samuel's own ruling (INVARIANTS §6) and the settings surface that would
// have written one was never wired.

// `AwaitResult` (long-poll) is an MCP/SDK shape and lives in
// `packages/dopl-client/src/channel-types.ts`, where its only callers are.
