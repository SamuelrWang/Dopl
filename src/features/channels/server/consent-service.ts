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
 * CONSUME-TIME TRUST RE-VERIFICATION (CHANNELS-AUDIT C-19 / F-174).
 *
 * An `auto_allowed` row is born with `expires_at: null` and nothing ever
 * sweeps it, so trust used to be checked exactly ONCE — at create. After that
 * the row authorized a spawn forever: the operator could revoke the rule, or
 * the trusted teammate could leave the workspace, and the stored row still
 * came back as an allow the desktop honored.
 *
 * The row is not the authority; the row PLUS a live rule is. So every server
 * path that can hand an `auto_allowed` row to the machine that CONSUMES it
 * re-derives the rule first and, when it is gone, retires the row to
 * `expired`. That is the desktop watcher's existing terminal path
 * (`mapStatus` → 'expire' → `inboundExpired`), so no desktop change is needed
 * and **old builds fail closed too** — which is the whole reason this lives on
 * the server read path rather than in the client.
 *
 * WHY NOT A SWEEP IN `deleteTrustRule`. A revocation hook sees only explicit
 * revocations, and it covers only half the cases: `isTrustedRequester` also
 * re-checks live workspace membership, so a teammate who simply LEFT stops
 * auto-allowing here with no rule ever deleted. That is the same doctrine
 * `trust-service.ts` already states for the rule; this extends it to the row.
 *
 * THE AUDIT-TRAIL ARGUMENT IS WEAKER THAN IT READS, and this is the honest
 * version. It holds for `getConsentRequest`: a poll happens while the row is
 * still in flight, so retiring it there rewrites nothing that ran. It does NOT
 * hold for the two create-converge paths. The desktop replays creates on
 * crash-recovery, and a replay whose settled-map entry was lost re-raises a
 * trigger whose row was ALREADY consumed — `revalidateAutoAllow` then retires
 * that consumed row to `expired`, which is exactly the audit rewrite the sweep
 * was rejected for ("your agent ran N times without asking you" loses a row it
 * should have kept). Accepted deliberately: the alternative is handing a
 * machine a live allow under a revoked rule, and failing closed on an
 * already-finished unit of work costs a trail entry, not a spawn. It is a
 * nuance of the audit trail, not a defense of the check.
 *
 * NOT ON THE LIST READ. `listConsentRequests` is the audit surface and nothing
 * authorizes from it (`decideConsentRequest` CASes on `pending`, so an
 * `auto_allowed` row is not decidable there). Sweeping on a list read would
 * rewrite settled history for rows that already did their work.
 *
 * THE GUARD IS HTTP-LAYER ONLY. Realtime and PostgREST hand out the RAW row,
 * never this function's verdict, so anything that authorizes off a subscription
 * payload bypasses it entirely. Both current consumers are invalidation-only by
 * contract — the desktop's `ui-sync.js` states it outright ("an event is a
 * DOORBELL, never content") and the renderer refetches through the authed API —
 * so the guard is in front of every path that can actually consume a row today.
 * A future optimization that READS the payload instead of refetching would step
 * around it; that is the thing not to do.
 *
 * Running sessions are untouched by construction: this changes what the ROW
 * authorizes NEXT, never what is already executing.
 */
async function revalidateAutoAllow(
  ctx: ChannelContext,
  row: ConsentRequestRow
): Promise<ConsentRequestRow> {
  if (row.status !== "auto_allowed") return row;
  // A null requester is an `ON DELETE SET NULL` from a deleted account: there
  // is nobody left to re-verify, so it fails closed instead of authorizing.
  const stillTrusted =
    row.requester_user_id !== null &&
    (await isTrustedRequester(ctx, row.requester_user_id));
  if (stillTrusted) return row;

  const retired = await collab.expireRevokedAutoAllow(row.id);
  if (retired) return retired;
  // The CAS matched nothing — another writer moved the row between our read
  // and the sweep. Re-read rather than return the stale allow we just refused
  // to honor; a vanished row reads as expired for the same reason (the desktop
  // already treats a 404 as expired).
  const current = await collab.findConsentById(row.id);
  if (!current) return { ...row, status: "expired" };
  // The re-read is a fresh read of the same id, so it can in principle come
  // back `auto_allowed` again. Today it cannot — `insertConsentRequest` is the
  // only writer of that status and it writes on INSERT, so nothing can move a
  // row back INTO an allow — but that is an invariant of another file, and the
  // whole point of this branch is that we already refused this row. Fail closed
  // on the verdict we just reached rather than on a re-read's word: never hand
  // back an allow this function declined one line earlier.
  if (current.status === "auto_allowed") return { ...current, status: "expired" };
  return current;
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
 * Both converge paths run `revalidateAutoAllow` on the stored row: de-duping
 * must not resurrect an auto-allow whose rule was revoked in the meantime —
 * the mirror of the denied-trigger rule above.
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
    // The de-duped row is handed straight back to a machine that will act on
    // it, so a stored auto-allow is re-verified here too — the crash-recovery
    // replay is exactly how a row outlives the rule that created it (C-19).
    if (existing) return hydrateOne(await revalidateAutoAllow(ctx, existing));
  }

  // Inbound: derive the requester from the triggering message's author.
  const requesterUserId =
    input.kind === "inbound" && messageSeq !== null
      ? await collab.findMessageAuthorBySeq(channel.id, messageSeq)
      : null;

  // Standing trust auto-allows an inbound request from a trusted teammate —
  // re-checked against live workspace membership, never the rule alone. This
  // is the birth check only; `revalidateAutoAllow` re-runs it every time the
  // resulting row is handed back to be consumed.
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

/**
 * Load one request the caller owns (desktop poll). 404s otherwise.
 *
 * This is THE consume path: the desktop's watcher polls this row and spawns
 * the moment it reads `allowed` / `auto_allowed`, so an auto-allow is
 * re-verified against live trust here before it is handed over (C-19).
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
