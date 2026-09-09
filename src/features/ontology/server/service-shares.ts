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
 * ⚠ **1 BEFORE 2, AND BOTH 404.** Answering the channel question first would
 * make this route a ROOM ORACLE: anyone holding a cluster id could probe
 * channel ids and read "exists / does not" off the status code. Answering
 * either with 403 does the same for the resource. This is the rule
 * `knowledge/.../channel-grants/route.ts` states for its own two fences.
 *
 * ⚠ **3 IS A 400 AND NOT A 404, AND THAT IS SAFE ONLY BECAUSE IT COMES AFTER
 * 2.** By the time it runs, the caller has PROVED a membership of that
 * container, so the refusal tells them nothing they could not already read; it
 * names the remedy instead, because "forbidden with no cause" is what sends an
 * agent to grep the repo.
 */

/** The ontology must be the caller's OWN — sharing is the owner's act, and a
 *  `members_level='edit'` grant is a pen on the content, never on the lending.
 *  ⚠ Reached through the audience's scope, then re-checked by `created_by`: a
 *  cluster the caller can EDIT through somebody else's share is still not
 *  theirs to lend onward. */
async function requireOwnCluster(
  ctx: OntologyContext,
  clusterId: string
): Promise<OntologyClusterRow> {
  const audience = await resolveOntologyAudience(ctx);
  const row = await repo.findClusterById(audience.workspaceIds, clusterId);
  if (!row || row.created_by !== ctx.userId) {
    throw HttpError.notFound("Cluster not found");
  }
  return row;
}

/** 🔒 Fence 0. `sessionOnly` on the route is the same refusal at the door; this
 *  is the one that survives a new caller reaching the service another way. The
 *  precedent is `knowledge › setChannelKnowledgeGrant`, which refuses
 *  `source === "agent"` outright because a share decides what the PERSON in
 *  that room can read, and that is a human's decision. */
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

/** Fences 2 and 3. Returns nothing: what it proves is a refusal that did not
 *  happen. */
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

function toShare(row: OntologyShareRow): OntologyShare {
  return {
    channelId: row.channel_id,
    membersLevel: row.members_level,
    guestsLevel: row.guests_level,
    ownerAgentsLevel: row.owner_agents_level,
  };
}

/**
 * WHICH CHANNELS THIS ONTOLOGY IS LENT INTO. ⚠ Fenced by ownership alone: the
 * rows describe the caller's own resource, and reporting a room they were
 * SINCE removed from is correct — understating an ontology's exposure to its
 * own owner is the worse failure (`listSharedIntoChannelBaseIds` makes the same
 * call).
 */
export async function listOntologyShares(
  ctx: OntologyContext,
  clusterId: string
): Promise<{ canManage: boolean; shares: OntologyShare[] }> {
  await requireOwnCluster(ctx, clusterId);
  const rows = await listSharesForCluster(clusterId);
  // ⚠ `canManage` COMES OFF THE SERVER — the same predicate the write applies,
  // so the dialog cannot render an editor for somebody the write will refuse.
  return { canManage: ctx.source === "user", shares: rows.map(toShare) };
}

/**
 * Upsert one `(ontology, channel)` row.
 *
 * ⚠ **Q2's SEED, AND ITS ONE-WAY-NESS.** On the FIRST row for this pair an
 * absent `ownerAgentsLevel` is seeded from the ontology's own `agents_may_edit`
 * toggle — which is what Samuel's solo setting MEANS once a room exists to
 * state it in. On a row that already exists, an absent value KEEPS the stored
 * one: a later share edit must never silently re-decide what the owner already
 * said about their own agents, and a channel gaining a peer never rewrites a
 * row (Q2, and I7 — live sessions tighten at the next tool call, never
 * retroactively).
 */
export async function setOntologyShare(
  ctx: OntologyContext,
  clusterId: string,
  input: OntologyShareWriteInput
): Promise<OntologyShare> {
  assertHumanShareWrite(ctx);
  const cluster = await requireOwnCluster(ctx, clusterId);
  await assertHomeChannelReachable(ctx, input.channelId);

  const existing = (await listSharesForCluster(clusterId)).find(
    (row) => row.channel_id === input.channelId
  );
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
 * ⚠ Q3: ACCESS ENDS IMMEDIATELY and EDITS ALREADY MADE STAY, attributed to
 * their author (`last_edited_by` / `last_edited_source`). No retroactive scrub
 * — the same answer INVARIANTS §4A gives for departure-is-removal.
 *
 * ⚠ IDEMPOTENT: unsharing a pair with no row is a success, not a 404. The
 * caller asked for an end state and the end state holds.
 */
export async function unshareOntology(
  ctx: OntologyContext,
  clusterId: string,
  channelId: string
): Promise<void> {
  assertHumanShareWrite(ctx);
  const cluster = await requireOwnCluster(ctx, clusterId);
  await assertHomeChannelReachable(ctx, channelId);
  const existing = (await listSharesForCluster(clusterId)).find(
    (row) => row.channel_id === channelId
  );
  await deleteShare(clusterId, channelId);
  // ⚠ NOTHING IS RECORDED WHEN NOTHING WAS SHARED. This op is idempotent by
  // design, and a revision for an unshare that removed no row would put an
  // access change in the history of an ontology whose access did not change.
  await recordShareRevision(
    ctx,
    { id: clusterId, workspaceId: cluster.workspace_id },
    channelId,
    existing ? toShare(existing) : null,
    null
  );
}
