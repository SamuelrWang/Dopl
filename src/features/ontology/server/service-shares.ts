import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import type { OntologyContext, OntologyShare } from "../types";
import type { OntologyShareWriteInput } from "../schema";
import type { OntologyClusterRow } from "./dto";
import * as repo from "./repository";
import {
  deleteShare,
  findActiveMemberRole,
  findChannelContainer,
  findWorkspaceKind,
  listSharesForCluster,
  upsertShare,
  type OntologyShareRow,
} from "./repository-shares";
import { resolveOntologyAudience } from "./service-audience";
// ⚠ AWAITED, AFTER THE WRITE, INSIDE THE REQUEST (`./service-revisions.ts`). A
// share is who ELSE reaches the ontology, so its row is filed on the CLUSTER.
import { recordShareRevision } from "./service-revisions";

/**
 * 🔒 THE SHARE WRITE LANE (spec §6 S3) — "share an ontology with a channel …
 * members access/view or edit, and guests access/view or edit … and for each
 * channel, if their own agents are allowed access, and read or also write".
 *
 * ── THE FENCES, IN ORDER, AND THE ORDER IS THE DESIGN ───────────────────────
 * ```
 * 0. a PERSON is asking          — an agent may not widen its operator's audience
 * 1. the ONTOLOGY is the caller's own   → else 404 (never 403)
 * 2. the CHANNEL is one the caller is an active member of → else 404
 * 3. that channel's container is a HOME container         → else 400 (Q5)
 * ```
 * ⚠ **1 BEFORE 2, AND BOTH 404** — answering the channel question first makes
 * this a ROOM ORACLE (probe channel ids, read "exists / does not" off the status
 * code); a 403 does the same for the resource. The rule
 * `knowledge/.../channel-grants/route.ts` states for its own two fences.
 *
 * ⚠ **3 IS A 400, SAFE ONLY BECAUSE IT COMES AFTER 2**: the caller has PROVED a
 * membership by then, so naming the remedy tells them nothing new — and
 * "forbidden with no cause" is what sends an agent to grep the repo.
 */

/** The ontology must be the caller's OWN — a `members_level='edit'` grant is a
 *  pen on the content, never on the lending. ⚠ Reached through the audience's
 *  scope, then re-checked by `created_by`. */
async function requireOwnCluster(
  ctx: OntologyContext,
  clusterId: string
): Promise<OntologyClusterRow> {
  const audience = await resolveOntologyAudience(ctx);
  const row = await repo.findClusterById(audience.workspaceIds, clusterId);
  if (!row || row.created_by !== ctx.userId) {
    throw HttpError.notFound("Ontology not found");
  }
  return row;
}

/** 🔒 Fence 0 — the one that survives a new caller reaching the service another
 *  way (`sessionOnly` on the route is the same refusal at the door). Precedent:
 *  `knowledge › setChannelKnowledgeGrant`. */
function assertHumanShareWrite(ctx: OntologyContext): void {
  if (ctx.source === "agent") {
    throw new HttpError(
      403,
      "ONTOLOGY_SHARE_AGENT_FORBIDDEN",
      "Sharing an ontology into a channel is a human-only setting — an agent " +
        "cannot widen its own operator's audience. Ask your operator to share it."
    );
  }
}

/** Fences 2 and 3. What it proves is a refusal that did not happen. */
async function assertHomeChannelReachable(
  ctx: OntologyContext,
  channelId: string
): Promise<void> {
  const channel = await findChannelContainer(channelId);
  if (!channel) throw HttpError.notFound("Channel not found");
  const role = await findActiveMemberRole(channel.workspaceId, ctx.userId);
  // ⚠ The SAME answer an unknown channel gets. "Cannot see" and "does not
  // exist" must stay indistinguishable, or this write becomes a room oracle.
  if (role === null) throw HttpError.notFound("Channel not found");
  const kind = await findWorkspaceKind(channel.workspaceId);
  if (kind !== "link") {
    throw HttpError.badRequest(
      "An ontology can only be shared into a home channel. Workspace channels " +
        "reach an ontology through their own workspace instead."
    );
  }
}

/**
 * Fences 0-3, then the row this pair already has. ⚠ ONE PROLOGUE FOR BOTH
 * WRITES: the order of the fences IS the design (see the header), so a second
 * copy is a second place to reorder them.
 */
async function openShareWrite(
  ctx: OntologyContext,
  clusterId: string,
  channelId: string
): Promise<{ cluster: OntologyClusterRow; existing: OntologyShareRow | undefined }> {
  assertHumanShareWrite(ctx);
  const cluster = await requireOwnCluster(ctx, clusterId);
  await assertHomeChannelReachable(ctx, channelId);
  const existing = (await listSharesForCluster(clusterId)).find(
    (row) => row.channel_id === channelId
  );
  return { cluster, existing };
}

function toShare(row: OntologyShareRow): OntologyShare {
  return {
    channelId: row.channel_id,
    membersLevel: row.members_level,
    guestsLevel: row.guests_level,
    ownerAgentsLevel: row.owner_agents_level,
  };
}

/** WHICH CHANNELS THIS ONTOLOGY IS LENT INTO. ⚠ Fenced by ownership alone, and
 *  a room the owner was SINCE removed from still shows: understating an
 *  ontology's exposure to its own owner is the worse failure
 *  (`knowledge › listSharedIntoChannelBaseIds` makes the same call). */
export async function listOntologyShares(
  ctx: OntologyContext,
  clusterId: string
): Promise<{ canManage: boolean; shares: OntologyShare[] }> {
  await requireOwnCluster(ctx, clusterId);
  const rows = await listSharesForCluster(clusterId);
  // ⚠ `canManage` COMES OFF THE SERVER — the write's own predicate, so the
  // dialog cannot render an editor for somebody the write will refuse.
  return { canManage: ctx.source === "user", shares: rows.map(toShare) };
}

/**
 * Upsert one `(ontology, channel)` row.
 *
 * ⚠ **Q2's SEED, AND ITS ONE-WAY-NESS.** On the FIRST row an absent
 * `ownerAgentsLevel` is seeded from the ontology's `agents_may_edit` toggle —
 * what Samuel's solo setting MEANS once a room exists to state it in. On an
 * existing row an absent value KEEPS the stored one: a later edit must never
 * silently re-decide what the owner already said (Q2, I7).
 */
export async function setOntologyShare(
  ctx: OntologyContext,
  clusterId: string,
  input: OntologyShareWriteInput
): Promise<OntologyShare> {
  const { cluster, existing } = await openShareWrite(ctx, clusterId, input.channelId);
  const ownerAgentsLevel =
    input.ownerAgentsLevel ??
    existing?.owner_agents_level ??
    (cluster.agents_may_edit ? "edit" : "view");

  const row = await upsertShare({
    ontologyId: clusterId,
    channelId: input.channelId,
    // ⚠ THE ONTOLOGY's container, off the row this lane already fenced — never
    // the channel's, and never anything off the request (spec §3.1).
    workspaceId: cluster.workspace_id,
    membersLevel: input.membersLevel,
    guestsLevel: input.guestsLevel,
    ownerAgentsLevel,
    createdBy: ctx.userId,
  });
  await recordShareRevision(
    ctx,
    { id: clusterId, workspaceId: cluster.workspace_id },
    input.channelId,
    existing ? toShare(existing) : null,
    toShare(row)
  );
  return toShare(row);
}

/**
 * UNSHARE — the row DELETE (I4).
 *
 * ⚠ Q3: ACCESS ENDS IMMEDIATELY and EDITS ALREADY MADE STAY, attributed to their
 * author — no retroactive scrub (INVARIANTS §4A's departure-is-removal answer).
 *
 * ⚠ IDEMPOTENT: a pair with no row is a success, not a 404.
 */
export async function unshareOntology(
  ctx: OntologyContext,
  clusterId: string,
  channelId: string
): Promise<void> {
  const { cluster, existing } = await openShareWrite(ctx, clusterId, channelId);
  await deleteShare(clusterId, channelId);
  // ⚠ NOTHING IS RECORDED WHEN NOTHING WAS SHARED — a revision for an unshare
  // that removed no row would put an access change in the history of an ontology
  // whose access did not change.
  await recordShareRevision(
    ctx,
    { id: clusterId, workspaceId: cluster.workspace_id },
    channelId,
    existing ? toShare(existing) : null,
    null
  );
}
