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
import * as messagesRepo from "./repository-messages";
import { isTrustedRequester } from "./trust-service";
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
 */

/** Hydrate requester display onto a set of consent rows (inbound cards). */
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

/**
 * CONSUME-TIME TRUST RE-VERIFICATION.
 *
 * ⚠ An `auto_allowed` row is born with `expires_at: null` and nothing sweeps it,
 * so trust checked once at create authorizes a spawn FOREVER — the operator can
 * revoke the rule, or the teammate leave the workspace, and the stored row still
 * reads as an allow. The row is not the authority; the row PLUS a live rule is.
 *
 * So every server path that can hand an `auto_allowed` row to the machine that
 * CONSUMES it re-derives the rule and, when it is gone, retires the row to
 * `expired` — the desktop watcher's existing terminal path (`mapStatus` →
 * 'expire' → `inboundExpired`). ⚠ Lives on the SERVER read path precisely so old
 * desktop builds fail closed too.
 *
 * ⚠ Not a sweep in `deleteTrustRule`: a revocation hook sees only explicit
 * revocations, and `isTrustedRequester` also re-checks live workspace
 * membership, so a teammate who simply LEFT stops auto-allowing with no rule
 * ever deleted.
 *
 * ⚠ NOT on the list read. `listConsentRequests` is the audit surface and nothing
 * authorizes from it (`decideConsentRequest` CASes on `pending`), so sweeping
 * there rewrites settled history for rows that already did their work. Accepted
 * cost: a crash-recovery replay can retire an already-consumed row, losing a
 * trail entry — cheaper than handing a machine a live allow under a revoked rule.
 *
 * ⚠ HTTP-LAYER ONLY. Realtime and PostgREST hand out the RAW row, never this
 * verdict. Both current consumers are invalidation-only by contract (`ui-sync.js`
 * — "an event is a DOORBELL, never content"). An optimization that READS the
 * subscription payload instead of refetching steps around this guard entirely.
 */
async function revalidateAutoAllow(
  ctx: ChannelContext,
  row: ConsentRequestRow
): Promise<ConsentRequestRow> {
  if (row.status !== "auto_allowed") return row;
  // ⚠ Null requester = `ON DELETE SET NULL` from a deleted account. Nobody left
  // to re-verify, so fail closed.
  const stillTrusted =
    row.requester_user_id !== null &&
    (await isTrustedRequester(ctx, row.requester_user_id));
  if (stillTrusted) return row;

  const retired = await collab.expireRevokedAutoAllow(row.id);
  if (retired) return retired;
  // CAS matched nothing — another writer moved the row between read and sweep.
  // ⚠ Re-read rather than return the stale allow we just refused; a vanished row
  // reads as expired (the desktop already treats a 404 that way).
  const current = await collab.findConsentById(row.id);
  if (!current) return { ...row, status: "expired" };
  // ⚠ The re-read can in principle come back `auto_allowed` again. Today it
  // cannot (`insertConsentRequest` is the only writer of that status, on INSERT)
  // — but that is an invariant of ANOTHER file. Fail closed on the verdict we
  // just reached; never hand back an allow this function declined a line earlier.
  if (current.status === "auto_allowed") return { ...current, status: "expired" };
  return current;
}

/**
 * Create a consent request. ⚠ Operator is always the caller; the inbound
 * requester is derived from the triggering message, NEVER trusted from the body.
 * A standing trust rule births the row `auto_allowed` (decided_by='trust').
 *
 * ⚠ IDEMPOTENT per (operator, channel, kind, message_seq), BOTH kinds, at ANY
 * status:
 *   - desktop replays creates on crash-recovery, so a trigger the human DENIED
 *     must come back denied — re-raising lets a trust rule added since
 *     auto-allow work the human refused;
 *   - an outbound retry must return the SAME review row, or approving each copy
 *     posts the agent's reply twice.
 * A partial unique index enforces the key in the DB so concurrent creates
 * converge (the 23505 branch). Both converge paths run `revalidateAutoAllow` —
 * de-duping must not resurrect an auto-allow whose rule was revoked.
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
    if (existing) return hydrateOne(await revalidateAutoAllow(ctx, existing));
  }

  const requesterUserId =
    input.kind === "inbound" && messageSeq !== null
      ? await messagesRepo.findMessageAuthorBySeq(channel.id, messageSeq)
      : null;

  // ⚠ Re-checked against live workspace membership, never the rule alone. Birth
  // check only — `revalidateAutoAllow` re-runs it on every consume.
  const trusted =
    input.kind === "inbound" &&
    requesterUserId !== null &&
    (await isTrustedRequester(ctx, requesterUserId));

  const now = Date.now();
  const insert = {
    channel_id: channel.id,
    workspace_id: ctx.workspaceId,
    operator_user_id: ctx.userId,
    requester_user_id: requesterUserId,
    kind: input.kind,
    message_seq: messageSeq,
    summary: input.summary,
    body_preview: input.bodyPreview,
    // Outbound only — the union already drops it on inbound; this keeps the
    // column honest at the write.
    proposed_reply: input.kind === "outbound" ? input.proposedReply ?? null : null,
    status: trusted ? "auto_allowed" : "pending",
    decided_by: trusted ? "trust" : null,
    decided_at: trusted ? new Date(now).toISOString() : null,
    expires_at: trusted ? null : new Date(now + CONSENT_TTL_MS).toISOString(),
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
      if (raced) return hydrateOne(await revalidateAutoAllow(ctx, raced));
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
 * The operator's consent inbox (both kinds), newest first. Defaults `pending`.
 * `decided` / `all` open the audit trail — the ONLY way to read the
 * `auto_allowed` rows a trust rule writes.
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
 * ⚠ THE consume path — the watcher spawns the moment it reads `allowed` /
 * `auto_allowed`, so an auto-allow is re-verified against live trust here.
 */
export async function getConsentRequest(
  ctx: ChannelContext,
  id: string
): Promise<ChannelConsentRequest> {
  await collab.expireStalePending(ctx.userId);
  const row = await requireOperatorRow(ctx, id);
  return hydrateOne(await revalidateAutoAllow(ctx, row));
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
 * `surface` is the audit trail of WHICH human surface answered; a trust rule
 * writes 'trust' at create time and is not a decision path here.
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
