import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import { meetsMinRole } from "@/features/workspaces/types";
import { assertSharedPublishAcknowledged } from "@/features/workspaces/server/shared-publish";
import {
  deleteGrantRow,
  deleteGrantsForResource,
  listGrantsForResource,
  listTeamIdsForUser,
  upsertGrant,
} from "@/features/teams/server/repository";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import type {
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
} from "../schema";
import {
  AgentWriteDisabledError,
  KnowledgeBaseSlugConflictError,
  KnowledgeStaleVersionError,
  ScopeChangeForbiddenError,
  TeamScopeForbiddenError,
  WorkspaceKeyPrivateVisibilityError,
} from "./errors";
import * as repo from "./repository";
import {
  assertAgentCanDelete,
  assertBaseWritable,
  deriveSlug,
  errorCode,
  listSlugs,
} from "./service-shared";
import { getBaseById, getBaseForWrite } from "./service-bases";
import { assertCreateBaseAllowed } from "./service-base-gates";
import { recordBaseRevision } from "./service-revisions";
// Re-exported: importers still name the create gate here.
export { assertCreateBaseAllowed } from "./service-base-gates";
export type { CreateBasePreconditions } from "./service-base-gates";
import { setChannelKnowledgeGrant } from "./service-channel-grants";

/** Knowledge base create / update (incl. sharing scope) / delete. Delete is permanent. */

const SLUG_RETRY_MAX = 3;

export async function createBase(
  ctx: KnowledgeContext,
  input: KnowledgeBaseCreateInput,
): Promise<KnowledgeBase> {
  // The same call the MCP dry run makes, so preview and write cannot disagree.
  const {
    destination,
    visibility: resolvedVisibility,
    teamGrants,
  } = await assertCreateBaseAllowed(ctx, input);

  // Idempotency probe: after the gates (refused callers get no row), before the insert (re-sends write nothing).
  if (input.clientWriteId) {
    const prior = await repo.findBaseByClientWriteId(
      destination.workspaceId,
      input.clientWriteId,
      ctx.userId
    );
    if (prior) return prior;
  }

  let attempt = 0;
  let baseSlug =
    input.slug ?? deriveSlug(input.name, await listSlugs(destination.workspaceId));
  let base: KnowledgeBase;
  while (true) {
    try {
      base = await repo.insertBase({
        workspaceId: destination.workspaceId,
        name: input.name,
        slug: baseSlug,
        description: input.description ?? null,
        // Default true so the creator's agent can write without opting in; grants are the real enforcement.
        agentWriteEnabled: input.agentWriteEnabled ?? true,
        visibility: resolvedVisibility,
        // Routing flag, not a column: decides `workspace_id`, refusing (never falling back) without a container.
        homeScoped: destination.homeScoped,
        createdBy: ctx.userId,
        clientWriteId: input.clientWriteId,
        clientWriteBy: ctx.userId,
      });
      break;
    } catch (err) {
      const code = errorCode(err);
      // Concurrent creates under one key: the loser's 23505 may be the client-write index, which a new slug
      // cannot fix. Re-probe and converge on the winner; a miss falls through to slug handling.
      if (code === "23505" && input.clientWriteId) {
        const won = await repo.findBaseByClientWriteId(
          destination.workspaceId,
          input.clientWriteId,
          ctx.userId
        );
        if (won) return won;
      }
      if (code === "23505" && attempt < SLUG_RETRY_MAX) {
        attempt += 1;
        baseSlug = deriveSlug(input.name, await listSlugs(destination.workspaceId));
        continue;
      }
      if (code === "23505") {
        throw new KnowledgeBaseSlugConflictError(baseSlug);
      }
      throw err;
    }
  }

  // Roll back on grant failure, else a retry trips slug uniqueness against the orphan.
  if (teamGrants.length > 0) {
    try {
      for (const grant of teamGrants) {
        await upsertGrant(
          ctx.workspaceId,
          grant.teamId,
          "knowledge_base",
          base.id,
          grant.level,
        );
      }
    } catch (err) {
      await repo.hardDeleteBase(destination.workspaceId, base.id).catch(() => {});
      throw err;
    }
  }

  // Create-and-share is atomic by the same hard-delete rollback (a tombstone would still own the slug).
  // The route fences the channel (`isChannelVisibleTo`) before this runs.
  if (input.shareToChannelId) {
    try {
      await setChannelKnowledgeGrant(ctx, base, {
        channelId: input.shareToChannelId,
        level: "visible",
        guestWrite: false,
      });
    } catch (err) {
      await repo.hardDeleteBase(destination.workspaceId, base.id).catch(() => {});
      throw err;
    }
  }
  // After both rollback-guarded branches: a rolled-back create must leave no revision.
  await recordBaseRevision(ctx, base, "create");
  return base;
}

export async function updateBase(
  ctx: KnowledgeContext,
  id: string,
  patch: KnowledgeBaseUpdateInput,
  expectedUpdatedAt?: string,
): Promise<KnowledgeBase> {
  // The id names its own container: every workspace-keyed call below takes `baseCtx`.
  const { ctx: baseCtx, value: base } = await getBaseForWrite(ctx, id);
  // Agents can never flip the toggle itself, whatever its current state.
  if (ctx.source === "agent" && patch.agentWriteEnabled !== undefined) {
    throw new AgentWriteDisabledError(base.id);
  }
  const sharingRequested =
    patch.visibility !== undefined ||
    patch.accessMode !== undefined ||
    patch.teamGrants !== undefined;
  let resolvedVisibility: "public" | "private" | undefined;
  let resolvedAccessMode: "workspace" | "teams" | undefined;
  let grantTeamIdsToRemove: string[] = [];
  let dropAllGrants = false;

  if (sharingRequested) {
    // Sharing scope is human-only, except an agent may publish (make public) a base it created.
    const agentPurePublish =
      ctx.source === "agent" &&
      patch.visibility === "public" &&
      patch.accessMode === undefined &&
      patch.teamGrants === undefined;
    if (ctx.source === "agent" && !agentPurePublish) {
      throw new AgentWriteDisabledError(
        base.id,
        "Sharing scope is a human-only setting — an agent can only publish (make public) a base it created.",
      );
    }
    const isAdmin = meetsMinRole(baseCtx.role, "admin");
    const isCreator = base.createdBy === ctx.userId;
    // Agent publish is creator-only (no admin override); humans need creator-or-admin.
    if (agentPurePublish ? !isCreator : !isCreator && !isAdmin) {
      throw new ScopeChangeForbiddenError();
    }

    // `patch.visibility`, not `targetVisibility`: a grant-only edit on a public base changes no audience.
    // Before any grant upsert, so a refusal leaves nothing behind.
    await assertSharedPublishAcknowledged({
      workspaceId: baseCtx.workspaceId,
      publishes: patch.visibility === "public",
      acknowledged: patch.acknowledgeShared,
      noun: "knowledge base",
    });

    const targetVisibility = patch.visibility ?? base.visibility;
    const targetMode =
      targetVisibility === "private"
        ? "workspace"
        : (patch.accessMode ?? base.accessMode);

    if (targetVisibility === "private") {
      // Same predicate as `canSeeBase` (F-336): a shared credential can't read a private row back.
      if (isSharedCredential(ctx)) {
        throw new WorkspaceKeyPrivateVisibilityError();
      }
      dropAllGrants = true;
    } else if (targetMode === "teams") {
      // `teamGrants` is the declarative FULL set; diff against current rows.
      const current = await listGrantsForResource(
        baseCtx.workspaceId,
        "knowledge_base",
        base.id,
      );
      const currentByTeam = new Map(current.map((g) => [g.teamId, g.level]));
      const desiredByTeam =
        patch.teamGrants !== undefined
          ? new Map(patch.teamGrants.map((g) => [g.teamId, g.level]))
          : currentByTeam;
      const addedOrRaised = [...desiredByTeam].filter(
        ([teamId, level]) => currentByTeam.get(teamId) !== level,
      );
      grantTeamIdsToRemove = [...currentByTeam.keys()].filter(
        (teamId) => !desiredByTeam.has(teamId),
      );

      // Non-admins may add/raise only their own teams; removal always OK.
      if (!isAdmin && addedOrRaised.length > 0) {
        const myTeams = new Set(
          await listTeamIdsForUser(baseCtx.workspaceId, ctx.userId),
        );
        if (addedOrRaised.some(([teamId]) => !myTeams.has(teamId))) {
          throw new TeamScopeForbiddenError();
        }
      }

      for (const [teamId, level] of addedOrRaised) {
        await upsertGrant(
          baseCtx.workspaceId,
          teamId,
          "knowledge_base",
          base.id,
          level,
        );
      }
      // Narrowing is unchecked on purpose: no cross-resource dependency survives for it to strand.
    }
    // → workspace is pure widening: grants stay as inert rows, remembered if re-narrowed.

    // Write both columns whenever sharing was touched, so grant-only edits still bump `updated_at` (CAS).
    resolvedVisibility = targetVisibility;
    resolvedAccessMode = targetMode;
  }

  await assertBaseWritable(baseCtx, base);
  if (expectedUpdatedAt && base.updatedAt !== expectedUpdatedAt) {
    throw new KnowledgeStaleVersionError(expectedUpdatedAt, base.updatedAt);
  }
  if (patch.slug && patch.slug !== base.slug) {
    const taken = await repo.listBaseSlugsForWorkspace(baseCtx.workspaceId);
    if (taken.includes(patch.slug)) {
      throw new KnowledgeBaseSlugConflictError(patch.slug);
    }
  }
  try {
    const saved = await repo.updateBaseRow(
      id,
      {
        name: patch.name,
        slug: patch.slug,
        description: patch.description,
        agentWriteEnabled: patch.agentWriteEnabled,
        visibility: resolvedVisibility,
        accessMode: resolvedAccessMode,
      },
      expectedUpdatedAt,
    );
    // Grant deletions only after the row update succeeds, else a stale-version rejection half-applies them.
    if (saved !== null) {
      if (dropAllGrants) {
        await deleteGrantsForResource(
          baseCtx.workspaceId,
          "knowledge_base",
          base.id,
        );
      } else {
        for (const teamId of grantTeamIdsToRemove) {
          await deleteGrantRow(teamId, "knowledge_base", base.id);
        }
      }
    }
    if (saved === null) {
      const fresh = await getBaseById(baseCtx, id);
      throw new KnowledgeStaleVersionError(expectedUpdatedAt!, fresh.updatedAt);
    }
    await recordBaseRevision(
      baseCtx,
      saved,
      patch.name !== undefined ? "rename" : "edit",
    );
    return saved;
  } catch (err) {
    if (errorCode(err) === "23505" && patch.slug) {
      throw new KnowledgeBaseSlugConflictError(patch.slug);
    }
    throw err;
  }
}

/**
 * Permanent delete of a base and everything in it. Grants are not cleared here: `resource_grants` has a
 * polymorphic `resource_id` with no FK, so the AFTER DELETE trigger `resource_grants_cleanup` does it.
 */
export async function deleteBase(
  ctx: KnowledgeContext,
  id: string,
): Promise<void> {
  const { ctx: baseCtx, value: base } = await getBaseForWrite(ctx, id);
  assertAgentCanDelete(ctx, base);
  await assertBaseWritable(baseCtx, base);
  await repo.hardDeleteBase(baseCtx.workspaceId, id);
  await recordBaseRevision(baseCtx, base, "delete");
}
