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
 * desktop share one source of truth. A caller may only ever raise / read /
 * decide requests where THEY are the operator (`operator_user_id = ctx.userId`
 * always, never from the body), so this surface can't be used to spoof a
 * request at, or peek at, another operator's machine. Writes go through the
 * service role; the operator-only rule is enforced here.
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
 * Create a consent request. The desktop POSTs this on an inbound trigger or a
 * drafted outbound reply. The operator is always the caller; the inbound
 * requester is derived from the triggering message (never trusted from the
 * body). If a standing trust rule covers the requester, the row is born
 * `auto_allowed` (decided_by='trust') so the desktop can spawn immediately and
 * the web audit still records it.
 *
 * IDEMPOTENT per (operator, channel, kind, message_seq), for BOTH kinds and at
 * ANY status:
 *   - the desktop replays creates on crash-recovery, so a trigger the human
 *     already DENIED must come back denied — re-raising it would let a trust
 *     rule added in the meantime auto-allow work the human refused;
 *   - an outbound retry must return the same review row, or approving each
 *     copy posts the agent's reply twice.
 * A partial unique index enforces the same key in the database, so two
 * concurrent creates converge instead of racing (the 23505 branch below).
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

  // Sweep BEFORE the de-dupe read: an elapsed row must be read as 'expired',
  // never handed back as a live 'pending' prompt the desktop then waits on.
  await collab.expireStalePending(ctx.userId);

  const messageSeq = input.messageSeq ?? null;
  if (messageSeq !== null) {
    const existing = await collab.findConsentByTrigger(
      ctx.userId,
      channel.id,
      input.kind,
      messageSeq
    );
    if (existing) return hydrateOne(existing);
  }

  // Inbound: derive the requester from the triggering message's author.
  const requesterUserId =
    input.kind === "inbound" && messageSeq !== null
      ? await collab.findMessageAuthorBySeq(channel.id, messageSeq)
      : null;

  // Standing trust auto-allows an inbound request from a trusted teammate —
  // re-checked against live workspace membership, never the rule alone.
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
    // A drafted reply belongs to an outbound review only — the union already
    // drops it on inbound; this keeps the column honest at the write.
    proposed_reply: input.kind === "outbound" ? input.proposedReply ?? null : null,
    status: trusted ? "auto_allowed" : "pending",
    decided_by: trusted ? "trust" : null,
    decided_at: trusted ? new Date(now).toISOString() : null,
    expires_at: trusted ? null : new Date(now + CONSENT_TTL_MS).toISOString(),
  };

  try {
    return hydrateOne(await collab.insertConsentRequest(insert));
  } catch (err) {
    // Lost the create race — converge on the stored winner (same key).
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
 * The operator's consent inbox (both kinds), newest first. Defaults to
 * `pending` — the cards awaiting an answer. `decided` / `all` open the audit
 * trail, which is the only way to read the `auto_allowed` rows a trust rule
 * writes: "your agent ran N times without asking you" is the whole
 * justification for recording them.
 */
export async function listConsentRequests(
  ctx: ChannelContext,
  opts: { channelId?: string; status?: ConsentStatusFilter } = {}
): Promise<ChannelConsentRequest[]> {
  await collab.expireStalePending(ctx.userId);
  const rows = await collab.listConsentRequests(ctx.userId, {
    channelId: opts.channelId,
    statuses: STATUS_FILTERS[opts.status ?? "pending"],
  });
  return hydrate(rows);
}

/** Load one request the caller owns (desktop poll). 404s otherwise. */
export async function getConsentRequest(
  ctx: ChannelContext,
  id: string
): Promise<ChannelConsentRequest> {
  await collab.expireStalePending(ctx.userId);
  const row = await requireOperatorRow(ctx, id);
  return hydrateOne(row);
}

/**
 * Record the operator's Allow / Deny (or Send / Cancel) decision.
 *
 * Two writers are normal here, not exceptional: the desktop's native dialog
 * and the web card both answer the same row, and the desktop mirrors its
 * local answer back over HTTP. So the pre-read is for authorization only
 * (operator / 404), and the decision itself is a compare-and-swap on
 * `status = 'pending'`. A lost race is a 409, never a silent overwrite — a
 * human's Deny must not be clobbered by a late Allow arriving from the other
 * surface.
 *
 * `surface` is the audit trail of WHICH human surface answered; a standing
 * trust rule writes 'trust' at create time and is not a decision path here.
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
    // The CAS found the row no longer pending: someone else decided it
    // between the read and the write. Re-read so the 409 names the status
    // that actually won.
    const winner = await collab.findConsentById(id);
    throw new ConsentAlreadyDecidedError(winner?.status ?? "decided");
  }
  return hydrateOne(updated);
}

/**
 * Fetch a request and assert the caller is its operator in this workspace.
 * A missing row, a foreign operator, or a cross-workspace id all collapse to
 * one not-found so ids can't be probed.
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
