import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import type {
  AgentIdentity,
  AgentIdentityContext,
  IdentityVisibility,
} from "../types";
import type {
  AgentIdentityCreateInput,
  AgentIdentityUpdateInput,
} from "../schema";
import { assertSharedPublishAcknowledged } from "@/features/workspaces/server/shared-publish";
import { assertHomeChannelRowIsShared } from "@/features/workspaces/server/home-channel-destination";
import {
  IdentityStaleVersionError,
  IdentityTeamScopeAgentForbiddenError,
  IdentityTeamNotGrantableError,
  IdentityWriteForbiddenError,
  WorkspaceKeyPrivateIdentityError,
} from "./errors";
import * as repo from "./repository";
import {
  getIdentityById,
  getIdentityForWrite,
  readIdentityById,
} from "./service-reads";
import {
  assertTeamScopeGrantable,
  resolveIdentityCreateDestination,
} from "./service-write-gates";
import {
  assertAttachableKnowledgeScopes,
  requestedKnowledgeScopes,
} from "./service-knowledge-scopes";
import {
  isWorkspaceAdmin,
  normalizeFieldsInput,
  normalizeProse,
  stripNullBytes,
} from "./service-shared";

/**
 * Agent-identity writes: create / update / hard delete. The write gate is creator-or-workspace-admin
 * for every field — team visibility shares use, not authorship.
 * There is no transaction across the row and its two junctions, so every check runs before any write.
 */

// ─── Create ─────────────────────────────────────────────────────────────

export async function createIdentity(
  ctx: AgentIdentityContext,
  input: AgentIdentityCreateInput
): Promise<AgentIdentity> {
  // A shared credential defaults to `workspace` and may never own a private row; everyone else
  // (incl. a container session, F-333) defaults to `private`.
  const fromWorkspaceKey = isSharedCredential(ctx);
  let visibility: IdentityVisibility;
  if (fromWorkspaceKey) {
    if (input.visibility === "private") throw new WorkspaceKeyPrivateIdentityError();
    visibility = input.visibility ?? "workspace";
  } else {
    visibility = input.visibility ?? "private";
  }

  // Where the row lands, decided first and from the resolved visibility (`team` never re-routes).
  const destination = await resolveIdentityCreateDestination(ctx, {
    homeScoped: input.homeScoped,
    visibility,
  });

  assertTeamScopeIsHuman(ctx, visibility);
  // The container the row lands in must have teams, not the calling room.
  if (visibility === "team") await assertTeamScopeGrantable(destination.workspaceId);
  const teamIds =
    visibility === "team"
      ? await assertGrantableTeams(ctx, input.teamIds ?? [], [])
      : [];
  const knowledgeScopes = await assertAttachableKnowledgeScopes(
    ctx,
    requestedKnowledgeScopes(input) ?? []
  );

  // G16 asks about the audience the row lands in: the destination, with the resolved visibility.
  await assertSharedPublishAcknowledged({
    workspaceId: destination.workspaceId,
    publishes: visibility === "workspace",
    acknowledged: input.acknowledgeShared,
    noun: "agent identity",
  });

  // A private row in a home channel is listed nowhere, so it is refused (Samuel's ruling).
  await assertHomeChannelRowIsShared({
    workspaceId: destination.workspaceId,
    shared: visibility !== "private",
    noun: "agent identity",
    remedy: 'visibility: "workspace"',
  });

  const identity = await repo.insertIdentity({
    // The router resolves the same home space by owner that the gate did.
    workspaceId: destination.workspaceId,
    name: stripNullBytes(input.name),
    description: normalizeProse(input.description),
    instructions: normalizeProse(input.instructions),
    model: normalizeProse(input.model),
    runtime: input.runtime ?? null,
    fields: normalizeFieldsInput(input.fields),
    visibility,
    homeScoped: destination.homeScoped,
    createdBy: ctx.userId,
  });

  // Junctions are filed under the row's container — every junction read filters on it.
  if (teamIds.length > 0) {
    await repo.replaceTeamLinks(
      destination.workspaceId,
      identity.id,
      teamIds,
      ctx.userId
    );
  }
  if (knowledgeScopes.length > 0) {
    await repo.replaceKnowledgeLinks(
      destination.workspaceId,
      identity.id,
      knowledgeScopes,
      ctx.userId
    );
  }
  // The response is a GET-shaped re-read; a row routed out of the calling container needs the follow.
  return destination.workspaceId === ctx.workspaceId
    ? getIdentityById(ctx, identity.id)
    : readIdentityById(ctx, identity.id);
}

// ─── Update ─────────────────────────────────────────────────────────────

/** `expectedUpdatedAt` is optional here and required by the SDK client (F-747); absent = last writer wins. */
export async function updateIdentity(
  ctx: AgentIdentityContext,
  id: string,
  patch: AgentIdentityUpdateInput,
  expectedUpdatedAt?: string
): Promise<AgentIdentity> {
  // The 404 comes before the write gate's 403. `tplCtx` is the row's container, with the caller's
  // role there; every workspace-keyed call below takes it.
  const { ctx: tplCtx, value: existing } = await getIdentityForWrite(ctx, id);
  assertMayWrite(tplCtx, existing, "edit");

  const nextVisibility = patch.visibility ?? existing.visibility;

  // A shared credential may never land a row `private` — checked on where the row lands (F-289).
  if (nextVisibility === "private" && isSharedCredential(ctx)) {
    throw new WorkspaceKeyPrivateIdentityError();
  }

  // G16 asks what the caller changed (`patch.visibility`); a rename of an already-shared row is exempt.
  await assertSharedPublishAcknowledged({
    workspaceId: tplCtx.workspaceId,
    publishes: patch.visibility === "workspace",
    acknowledged: patch.acknowledgeShared,
    noun: "agent identity",
  });

  // `nextVisibility`: the first write to reach a private home-channel row must move it.
  await assertHomeChannelRowIsShared({
    workspaceId: tplCtx.workspaceId,
    shared: nextVisibility !== "private",
    noun: "agent identity",
    remedy: 'visibility: "workspace"',
  });

  let teamIds: string[] | null = null;
  if (patch.visibility !== undefined || patch.teamIds !== undefined) {
    // `nextVisibility`: a teamIds-only patch on a `team` row moves the audience too.
    assertTeamScopeIsHuman(ctx, nextVisibility);
    if (nextVisibility === "team") await assertTeamScopeGrantable(tplCtx.workspaceId);
    teamIds =
      nextVisibility === "team"
        ? await assertGrantableTeams(
            tplCtx,
            patch.teamIds ?? existing.teamIds,
            existing.teamIds
          )
        : [];
  }

  // `null` = the patch named neither knowledge spelling (junction untouched); `[]` empties it.
  const requestedScopes = requestedKnowledgeScopes(patch);
  const knowledgeScopes =
    requestedScopes === null
      ? null
      : await assertAttachableKnowledgeScopes(tplCtx, requestedScopes);

  const rowPatch: repo.UpdateIdentityPatch = {
    name: patch.name === undefined ? undefined : stripNullBytes(patch.name),
    description:
      patch.description === undefined ? undefined : normalizeProse(patch.description),
    instructions:
      patch.instructions === undefined
        ? undefined
        : normalizeProse(patch.instructions),
    model: patch.model === undefined ? undefined : normalizeProse(patch.model),
    runtime: patch.runtime,
    fields: patch.fields === undefined ? undefined : normalizeFieldsInput(patch.fields),
    visibility: patch.visibility,
  };
  // A junction-only write still UPDATEs the row (a same-value rename, never an empty
  // body — F-404) so the touch trigger versions it and the CAS guards attachments too.
  if (
    (teamIds !== null || knowledgeScopes !== null) &&
    !Object.values(rowPatch).some((value) => value !== undefined)
  ) {
    rowPatch.name = existing.name;
  }
  // The CAS runs before both junction writes, so a lost race moves nothing.
  const touchesRow = Object.values(rowPatch).some((value) => value !== undefined);
  if (expectedUpdatedAt !== undefined) {
    const saved = await repo.updateIdentityRow(
      tplCtx.workspaceId,
      id,
      rowPatch,
      expectedUpdatedAt
    );
    // null = the CAS lost; re-read for the version the row actually holds.
    if (saved === null) {
      const fresh = await getIdentityById(tplCtx, id);
      throw new IdentityStaleVersionError(expectedUpdatedAt, fresh.updatedAt);
    }
  } else if (touchesRow) {
    await repo.updateIdentityRow(tplCtx.workspaceId, id, rowPatch);
  }

  // Replace-set, even when empty: stale team links would revive on a later re-share.
  if (teamIds !== null) {
    await repo.replaceTeamLinks(tplCtx.workspaceId, id, teamIds, ctx.userId);
  }
  if (knowledgeScopes !== null) {
    await repo.replaceKnowledgeLinks(
      tplCtx.workspaceId,
      id,
      knowledgeScopes,
      ctx.userId
    );
  }
  return getIdentityById(tplCtx, id);
}

// ─── Delete ─────────────────────────────────────────────────────────────

/** Permanent. Both junctions go with the row (FK cascade + the `resource_grants_cleanup` trigger). */
export async function deleteIdentity(
  ctx: AgentIdentityContext,
  id: string
): Promise<void> {
  const { ctx: tplCtx, value: existing } = await getIdentityForWrite(ctx, id);
  assertMayWrite(tplCtx, existing, "delete");
  await repo.hardDeleteIdentity(tplCtx.workspaceId, id);
}

// ─── Gates ──────────────────────────────────────────────────────────────

function assertMayWrite(
  ctx: AgentIdentityContext,
  identity: AgentIdentity,
  action: string
): void {
  const isCreator =
    identity.createdBy !== null && identity.createdBy === ctx.userId;
  if (isCreator || isWorkspaceAdmin(ctx)) return;
  throw new IdentityWriteForbiddenError(action);
}

/** `team` needs a human: an agent credential is refused on create and update (REST still accepts it). */
function assertTeamScopeIsHuman(
  ctx: AgentIdentityContext,
  landing: IdentityVisibility
): void {
  if (landing === "team" && ctx.source === "agent") {
    throw new IdentityTeamScopeAgentForbiddenError();
  }
}

/**
 * Teams the caller may share to: each must be a team of this workspace (a 403 here, not the junction
 * trigger's 500); an admin may name any, a non-admin only their own plus those already linked.
 */
async function assertGrantableTeams(
  ctx: AgentIdentityContext,
  requested: string[],
  alreadyLinked: string[]
): Promise<string[]> {
  const ids = [...new Set(requested)];
  if (ids.length === 0) return [];
  const inWorkspace = new Set(
    await repo.filterTeamIdsInWorkspace(ctx.workspaceId, ids)
  );
  const foreign = ids.filter((id) => !inWorkspace.has(id));
  if (foreign.length > 0) {
    throw new IdentityTeamNotGrantableError(
      `Not a team in this workspace: ${foreign.join(", ")}`
    );
  }
  if (isWorkspaceAdmin(ctx)) return ids;
  const myTeams = await repo.listTeamIdsForUser(ctx.workspaceId, ctx.userId);
  const allowed = new Set([...myTeams, ...alreadyLinked]);
  if (ids.some((id) => !allowed.has(id))) {
    throw new IdentityTeamNotGrantableError(
      "You can only share with teams you belong to"
    );
  }
  return ids;
}
