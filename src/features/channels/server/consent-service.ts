import "server-only";
import type { ChannelConsentRequest, ConsentDecisionSurface } from "../types";
import type { ConsentCreateInput, ConsentStatusFilter } from "../schema";
import { CONSENT_TTL_MS } from "../constants";
import {
  ChannelForbiddenError,
  ConsentAlreadyDecidedError,
  ConsentNotFoundError,
} from "./errors";
import { mapConsentRow, type ConsentRequestRow } from "./collab-dto";
import * as repo from "./repository";
import * as collab from "./repository-collab";
import {
  loadVisibleChannel,
  profilesById,
  stripNulDeep,
  UNIQUE_VIOLATION,
  type ChannelContext,
} from "./service-shared";

/**
 * Consent service — the human-in-the-loop gate as server-side rows so web and
 * desktop share one source of truth. ⚠ A caller may only raise / read / decide
 * requests where THEY are the operator (`operator_user_id = ctx.userId` always,
 * NEVER from the body). Writes go through the service role, so the operator-only
 * rule is enforced HERE and nowhere else.
 *
 * ── ONE LANE LEFT: OUTBOUND (2026-08-22, Samuel) ─────────────────────────────
 * Consent used to be symmetric — approve-in AND approve-out (INVARIANTS §6).
 * INBOUND ("a teammate's agent addressed you; Allow or Deny before your machine
 * spawns") IS RETIRED. A peer's ask now NOTIFIES the operator and the operator
 * launches a session or does not; there is no row to decide, so there is nothing
 * to decline. OUTBOUND is UNTOUCHED and is the reason this file still exists:
 * the operator's own agent drafts a reply and a human Sends it before it leaves
 * the machine, unless the channel's durable auto-send setting is on.
 *
 * ⚠ WHAT THAT MEANS FOR STORED ROWS, and the two halves differ:
 *   - DECIDED inbound rows are KEPT. They are the audit trail of decisions real
 *     humans made, and a retirement that rewrites history is worse than the lane
 *     it retired. `listConsentRequests` still returns them, still hydrates the
 *     requester, and `mapConsentRow` still reads `kind`.
 *   - STALE PENDING inbound rows are EXPIRED by the migration, because nothing
 *     can decide them any more: the desktop dialog is deleted and the create
 *     path that would re-raise them is gone, so a `pending` row would sit
 *     forever as a prompt with no surface.
 *
 * ⚠ `requester_user_id` therefore stays on the row shape and stays hydrated,
 * with no writer left — exactly like the reserved metadata keys in
 * `service-writes-metadata.ts` that are stripped but never re-stamped. A column
 * something still RENDERS is not dead.
 */

/** Hydrate requester display onto a set of consent rows. ⚠ Only STORED inbound
 *  rows carry a requester now; an outbound row's is null and this is a no-op for
 *  it. Kept because the audit read still lists those rows. */
async function hydrate(rows: ConsentRequestRow[]): Promise<ChannelConsentRequest[]> {
  const requesterIds = rows
    .map((r) => r.requester_user_id)
    .filter((id): id is string => id !== null);
  const profiles = await profilesById(requesterIds);
  return rows.map((row) =>
    mapConsentRow(row, row.requester_user_id ? profiles.get(row.requester_user_id) : undefined)
  );
}

async function hydrateOne(row: ConsentRequestRow): Promise<ChannelConsentRequest> {
  const [dto] = await hydrate([row]);
  return dto;
}

// ⚠ `revalidateAutoAllow` STOOD HERE AND IS DELETED (2026-08-22). It re-derived
// the standing trust rule behind an `auto_allowed` row on every consume-time
// read, and CAS'd the row to `expired` when the rule had been revoked or the
// teammate had left the workspace — the guard that made old desktops fail closed
// (INVARIANTS §6).
//
// ⚠ IT IS NOT A RELAXATION, because the status it guarded can no longer exist.
// `auto_allowed` had exactly one writer, the trust branch of
// `createConsentRequest`, and trust was INBOUND-ONLY: `agent_trust_rules` is
// dropped with the inbound lane, so nothing can write that status and nothing
// re-checks a rule that cannot be stored. A guard kept alive over a shape with
// no producer teaches the next reader that the producer is still there.
//
// ⚠ Measured before the drop: ZERO `auto_allowed` rows in the table's history —
// the trust surface was ON HOLD by Samuel's ruling and never wired. Re-measure,
// never quote.

/**
 * Create an OUTBOUND consent request. ⚠ Operator is always the caller.
 *
 * ⚠ IDEMPOTENT per (operator, channel, kind, message_seq) at ANY status: an
 * outbound retry must return the SAME review row, or approving each copy posts
 * the agent's reply twice. A partial unique index enforces the key in the DB so
 * concurrent creates converge (the 23505 branch).
 *
 * ⚠ THREE THINGS LEFT THIS FUNCTION WITH THE INBOUND LANE (2026-08-22):
 *   - the `findMessageAuthorBySeq` lookup that derived `requester_user_id` from
 *     the triggering message (inbound-only by construction — an outbound review
 *     is about the caller's OWN draft, so new rows carry `null`);
 *   - the `isTrustedRequester` birth check that could stamp `auto_allowed` /
 *     `decided_by='trust'`. `agent_trust_rules` is dropped, so that status has
 *     no writer at all now;
 *   - `revalidateAutoAllow` on both converge paths, which re-derived that rule
 *     at consume time. A status nothing can write needs no re-derivation.
 * ⚠ The de-dupe key still NAMES `kind`, and must: decided inbound rows share the
 * table and a key that ignored kind would collide an outbound review with the
 * historical inbound row for the same seq.
 */
export async function createConsentRequest(
  ctx: ChannelContext,
  rawInput: ConsentCreateInput
): Promise<ChannelConsentRequest> {
  const input = stripNulDeep(rawInput);
  const { channel, membership } = await loadVisibleChannel(ctx, input.channelId);
  if (!membership) {
    throw new ChannelForbiddenError("raise consent for this channel");
  }

  // ⚠ Sweep BEFORE the de-dupe read — an elapsed row must read as 'expired',
  // never come back as a live 'pending' prompt the desktop waits on.
  await collab.expireStalePending(ctx.userId);

  const messageSeq = input.messageSeq ?? null;
  if (messageSeq !== null) {
    const existing = await collab.findConsentByTrigger(
      ctx.userId,
      channel.id,
      input.kind,
      messageSeq
    );
    // ⚠ The de-duped row goes straight to a machine that will act on it, and the
    // crash-recovery replay is exactly how a row outlives its rule.
    if (existing) return hydrateOne(existing);
  }

  const now = Date.now();
  const insert = {
    channel_id: channel.id,
    workspace_id: ctx.workspaceId,
    operator_user_id: ctx.userId,
    // ⚠ NULL, WITH THE COLUMN KEPT. It named the teammate whose ask raised an
    // INBOUND request; an outbound review is about the caller's own draft, so
    // there is no requester to record. Stored inbound rows keep theirs and keep
    // rendering (see the file docblock).
    requester_user_id: null,
    kind: input.kind,
    message_seq: messageSeq,
    summary: input.summary,
    body_preview: input.bodyPreview,
    proposed_reply: input.proposedReply ?? null,
    // ⚠ ALWAYS pending, always with a TTL. `auto_allowed` (and its
    // `decided_by:'trust'` / null `expires_at`) was the standing-trust birth,
    // and standing trust is gone — see the docblock above.
    status: "pending",
    decided_by: null,
    decided_at: null,
    expires_at: new Date(now + CONSENT_TTL_MS).toISOString(),
  };

  try {
    return hydrateOne(await collab.insertConsentRequest(insert));
  } catch (err) {
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && messageSeq !== null) {
      const raced = await collab.findConsentByTrigger(
        ctx.userId,
        channel.id,
        input.kind,
        messageSeq
      );
      if (raced) return hydrateOne(raced);
    }
    throw err;
  }
}

/** Statuses each inbox filter resolves to (`all` = no status predicate). */
const STATUS_FILTERS: Record<ConsentStatusFilter, string[] | undefined> = {
  pending: ["pending"],
  decided: ["allowed", "denied", "expired", "auto_allowed"],
  all: undefined,
};

/**
 * The operator's consent inbox, newest first. Defaults `pending`.
 *
 * ⚠ IT IS THE AUDIT SURFACE AND IT STILL RETURNS INBOUND ROWS. `decided` / `all`
 * are how a human reads what was allowed and denied before the inbound lane was
 * retired (2026-08-22); withholding them would be rewriting the record rather
 * than closing the lane. New rows are outbound only.
 */
export async function listConsentRequests(
  ctx: ChannelContext,
  opts: { channelId?: string; status?: ConsentStatusFilter } = {}
): Promise<ChannelConsentRequest[]> {
  await collab.expireStalePending(ctx.userId);
  const rows = await collab.listConsentRequests(ctx.userId, {
    // ⚠ Operator-scoped is NOT workspace-scoped — without this the inbox (and
    // the sidebar badge built from it) shows every workspace's requests.
    workspaceId: ctx.workspaceId,
    channelId: opts.channelId,
    statuses: STATUS_FILTERS[opts.status ?? "pending"],
  });
  return hydrate(rows);
}

/**
 * Load one request the caller owns (desktop poll). 404s otherwise.
 * ⚠ THE consume path — the desktop sends the drafted reply the moment it reads
 * `allowed`. It carried a second job until 2026-08-22: re-verifying an
 * `auto_allowed` row against live trust before handing it over. See the
 * `revalidateAutoAllow` tombstone above for why that status can no longer occur.
 */
export async function getConsentRequest(
  ctx: ChannelContext,
  id: string
): Promise<ChannelConsentRequest> {
  await collab.expireStalePending(ctx.userId);
  return hydrateOne(await requireOperatorRow(ctx, id));
}

/**
 * Record the operator's Allow / Deny (or Send / Cancel) decision.
 *
 * ⚠ Two writers are NORMAL: the desktop dialog and the web card answer the same
 * row, and the desktop mirrors its local answer back over HTTP. The pre-read is
 * for AUTHORIZATION ONLY; the decision is a compare-and-swap on
 * `status = 'pending'`. A lost race is a 409, never a silent overwrite — a
 * human's Deny must not be clobbered by a late Allow from the other surface.
 *
 * `surface` is the audit trail of WHICH human surface answered. ⚠ `'trust'` is a
 * third value stored rows may carry and this path never writes — it was stamped
 * at CREATE time by the standing-trust branch, which is deleted.
 */
export async function decideConsentRequest(
  ctx: ChannelContext,
  id: string,
  decision: "allow" | "deny",
  surface: ConsentDecisionSurface = "web"
): Promise<ChannelConsentRequest> {
  await collab.expireStalePending(ctx.userId);
  const row = await requireOperatorRow(ctx, id);
  if (row.status !== "pending") {
    throw new ConsentAlreadyDecidedError(row.status);
  }
  const updated = await collab.updateConsentDecision(id, {
    status: decision === "allow" ? "allowed" : "denied",
    decided_by: surface,
    decided_at: new Date().toISOString(),
  });
  if (!updated) {
    // CAS found the row no longer pending. Re-read so the 409 names the status
    // that actually WON.
    const winner = await collab.findConsentById(id);
    throw new ConsentAlreadyDecidedError(winner?.status ?? "decided");
  }
  return hydrateOne(updated);
}

/**
 * Fetch a request and assert the caller is its operator in this workspace.
 * ⚠ Missing row, foreign operator, and cross-workspace id all collapse to ONE
 * not-found so ids cannot be probed.
 */
async function requireOperatorRow(
  ctx: ChannelContext,
  id: string
): Promise<ConsentRequestRow> {
  const row = await collab.findConsentById(id);
  if (
    !row ||
    row.operator_user_id !== ctx.userId ||
    row.workspace_id !== ctx.workspaceId
  ) {
    throw new ConsentNotFoundError(id);
  }
  return row;
}
