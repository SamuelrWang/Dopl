import "server-only";
import { meetsMinRole } from "@/features/workspaces/types";
import {
  validateKbGoingPrivate,
  validateKbNarrowing,
} from "@/features/teams/server/invariant";
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
import { getBaseById } from "./service-bases";

/**
 * Knowledge base writes — create / update (incl. sharing-scope
 * transitions) / delete. Delete is PERMANENT (2026-08-07): there is no
 * trash and no restore.
 */

const SLUG_RETRY_MAX = 3;

export async function createBase(
  ctx: KnowledgeContext,
  input: KnowledgeBaseCreateInput
): Promise<KnowledgeBase> {
  // Agent gate: creating a base is a workspace-level action, but the
  // toggle is per-base — it doesn't apply to creation. (You can't have
  // a base with the toggle off until that base exists.) Agent-origin
  // creates are allowed by default; tighten in Item 4 if needed.
  //
  // Slug uniqueness within workspace is preserved here so MCP `kb_*`
  // tools that address bases by slug stay unambiguous. PublicId is
  // the URL routing key; slug stays the agent-facing handle.
  // Audit B6 + B15: visibility default depends on the caller.
  //   • Workspace-scoped API key  → must be 'public'. Workspace keys
  //     may be shared among humans, and `canSeeBase` blocks them from
  //     reading their own private rows back, so creating a private one
  //     would strand the resource. Reject explicit 'private' loudly
  //     and default to 'public'.
  //   • Session caller / personal key  → default 'private'. The owner
  //     opts to publish via the "Make public" button when ready.
  const fromWorkspaceKey = ctx.apiKeyWorkspaceId != null;
  let resolvedVisibility = input.visibility;
  if (fromWorkspaceKey) {
    if (resolvedVisibility === "private") {
      throw new WorkspaceKeyPrivateVisibilityError();
    }
    resolvedVisibility = resolvedVisibility ?? "public";
  } else {
    resolvedVisibility = resolvedVisibility ?? "private";
  }

  // Three-way scope: teams mode is a human-only decision (mirrors the
  // agent restrictions on visibility), and non-admin creators may only
  // grant teams they belong to.
  const wantsTeams = input.accessMode === "teams";
  const teamGrants = wantsTeams ? (input.teamGrants ?? []) : [];
  if (wantsTeams) {
    if (ctx.source === "agent") {
      throw new AgentWriteDisabledError(
        "(new)",
        "Sharing scope is a human-only setting — agents cannot create teams-scoped knowledge bases."
      );
    }
    if (!meetsMinRole(ctx.role, "admin")) {
      const myTeams = new Set(
        await listTeamIdsForUser(ctx.workspaceId, ctx.userId)
      );
      if (teamGrants.some((g) => !myTeams.has(g.teamId))) {
        throw new TeamScopeForbiddenError();
      }
    }
    // Teams scope implies shared — schema already rejects private+teams.
    resolvedVisibility = "public";
  }

  let attempt = 0;
  let baseSlug =
    input.slug ?? deriveSlug(input.name, await listSlugs(ctx.workspaceId));
  let base: KnowledgeBase;
  while (true) {
    try {
      base = await repo.insertBase({
        workspaceId: ctx.workspaceId,
        name: input.name,
        slug: baseSlug,
        description: input.description ?? null,
        // Default true: a brand-new base belongs to its creator (visibility
        // defaults to private above), and the creator's agent should be
        // able to write to it without an extra opt-in step. Actual write
        // enforcement is the team grant check in `requireEffectiveAccess`,
        // not this column — keeping the column TRUE here just stops the
        // UI/MCP messaging from misrepresenting the access state.
        agentWriteEnabled: input.agentWriteEnabled ?? true,
        visibility: resolvedVisibility,
        accessMode: wantsTeams ? "teams" : "workspace",
        createdBy: ctx.userId,
      });
      break;
    } catch (err) {
      const code = errorCode(err);
      if (code === "23505" && attempt < SLUG_RETRY_MAX) {
        attempt += 1;
        baseSlug = deriveSlug(input.name, await listSlugs(ctx.workspaceId));
        continue;
      }
      if (code === "23505") {
        throw new KnowledgeBaseSlugConflictError(baseSlug);
      }
      throw err;
    }
  }

  // Initial grants. A brand-new base has no attached workflows, so no
  // invariant check is needed. Roll the base back on failure so a retry
  // doesn't trip the slug uniqueness constraint with an orphan.
  if (teamGrants.length > 0) {
    try {
      for (const grant of teamGrants) {
        await upsertGrant(
          ctx.workspaceId,
          grant.teamId,
          "knowledge_base",
          base.id,
          grant.level
        );
      }
    } catch (err) {
      await repo.hardDeleteBase(ctx.workspaceId, base.id).catch(() => {});
      throw err;
    }
  }
  return base;
}

export async function updateBase(
  ctx: KnowledgeContext,
  id: string,
  patch: KnowledgeBaseUpdateInput,
  expectedUpdatedAt?: string
): Promise<KnowledgeBase> {
  const base = await getBaseById(ctx, id);
  // Updating the toggle itself is a settings change — agents can't
  // flip it, regardless of the toggle's current state. Other writes
  // (name, description, slug) honor the toggle if it's off.
  if (ctx.source === "agent" && patch.agentWriteEnabled !== undefined) {
    throw new AgentWriteDisabledError(base.id);
  }
  // Sharing scope (visibility / accessMode / teamGrants) is fully
  // changeable, but only by the owner or a workspace admin, and never
  // by agents — same human-only rule as the agent-write toggle.
  // Narrowing transitions are invariant-checked against attached
  // workflows; widening never conflicts.
  const sharingRequested =
    patch.visibility !== undefined ||
    patch.accessMode !== undefined ||
    patch.teamGrants !== undefined;
  let resolvedVisibility: "public" | "private" | undefined;
  let resolvedAccessMode: "workspace" | "teams" | undefined;
  let grantTeamIdsToRemove: string[] = [];
  let dropAllGrants = false;

  if (sharingRequested) {
    // Agents MAY publish (private→public) a base they created — needed so an
    // agent can reference its own KB in a workflow (which requires public
    // KBs). A "pure publish" is visibility:'public' with no accessMode/team
    // change. Everything else about sharing scope (accessMode, team grants,
    // un-publishing) stays human-only.
    const agentPurePublish =
      ctx.source === "agent" &&
      patch.visibility === "public" &&
      patch.accessMode === undefined &&
      patch.teamGrants === undefined;
    if (ctx.source === "agent" && !agentPurePublish) {
      throw new AgentWriteDisabledError(
        base.id,
        "Sharing scope is a human-only setting — an agent can only publish (make public) a base it created."
      );
    }
    const isAdmin = meetsMinRole(ctx.role, "admin");
    const isCreator = base.createdBy === ctx.userId;
    // Agent publish is creator-only (no admin override — an agent acts only
    // on its own resources). Human path keeps the creator-or-admin rule.
    if (agentPurePublish ? !isCreator : !isCreator && !isAdmin) {
      throw new ScopeChangeForbiddenError();
    }

    const targetVisibility = patch.visibility ?? base.visibility;
    const targetMode =
      targetVisibility === "private"
        ? "workspace"
        : (patch.accessMode ?? base.accessMode);

    if (targetVisibility === "private") {
      // → private. Workspace-scoped keys can never read private rows
      // back, so they may not create this state either.
      if (ctx.apiKeyWorkspaceId != null) {
        throw new WorkspaceKeyPrivateVisibilityError();
      }
      if (base.visibility === "public") {
        await validateKbGoingPrivate({
          workspaceId: ctx.workspaceId,
          knowledgeBaseId: base.id,
          knowledgeBaseName: base.name,
        });
      }
      dropAllGrants = true;
    } else if (targetMode === "teams") {
      // → teams (or grant edits within teams mode). `teamGrants` is the
      // declarative full set; diff against current rows.
      const current = await listGrantsForResource(
        ctx.workspaceId,
        "knowledge_base",
        base.id
      );
      const currentByTeam = new Map(current.map((g) => [g.teamId, g.level]));
      const desiredByTeam =
        patch.teamGrants !== undefined
          ? new Map(patch.teamGrants.map((g) => [g.teamId, g.level]))
          : currentByTeam;
      const addedOrRaised = [...desiredByTeam].filter(
        ([teamId, level]) => currentByTeam.get(teamId) !== level
      );
      grantTeamIdsToRemove = [...currentByTeam.keys()].filter(
        (teamId) => !desiredByTeam.has(teamId)
      );

      // Non-admin owners may add/change grants only for their own teams;
      // removing any team from their own KB is always allowed.
      if (!isAdmin && addedOrRaised.length > 0) {
        const myTeams = new Set(
          await listTeamIdsForUser(ctx.workspaceId, ctx.userId)
        );
        if (addedOrRaised.some(([teamId]) => !myTeams.has(teamId))) {
          throw new TeamScopeForbiddenError();
        }
      }

      // Upsert new grants BEFORE the narrowing checks so freshly granted
      // teams aren't counted as losing access.
      for (const [teamId, level] of addedOrRaised) {
        await upsertGrant(
          ctx.workspaceId,
          teamId,
          "knowledge_base",
          base.id,
          level
        );
      }
      if (grantTeamIdsToRemove.length > 0) {
        await validateKbNarrowing({
          workspaceId: ctx.workspaceId,
          knowledgeBaseId: base.id,
          knowledgeBaseName: base.name,
          losingTeamIds: grantTeamIdsToRemove,
        });
      }
      // Flipping a workspace-visible base to teams narrows it for every
      // non-granted audience member. (private → teams is pure widening.)
      if (base.visibility === "public" && base.accessMode === "workspace") {
        await validateKbNarrowing({
          workspaceId: ctx.workspaceId,
          knowledgeBaseId: base.id,
          knowledgeBaseName: base.name,
          losingTeamIds: "allUngranted",
        });
      }
    }
    // → workspace is pure widening: grants stay as inert rows (the mode
    // remembers them if re-narrowed), matching `setResourceAccessMode`.

    // Always write both columns when sharing was touched: keeps the row
    // update non-empty for grant-only edits and bumps `updated_at` so
    // CAS clients refresh their snapshot.
    resolvedVisibility = targetVisibility;
    resolvedAccessMode = targetMode;
  }

  await assertBaseWritable(ctx, base);
  if (expectedUpdatedAt && base.updatedAt !== expectedUpdatedAt) {
    throw new KnowledgeStaleVersionError(expectedUpdatedAt, base.updatedAt);
  }
  if (patch.slug && patch.slug !== base.slug) {
    const taken = await repo.listBaseSlugsForWorkspace(ctx.workspaceId);
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
      expectedUpdatedAt
    );
    // Grant-row deletions land only after the row update succeeded, so a
    // stale-version rejection can't half-apply the scope change.
    if (saved !== null) {
      if (dropAllGrants) {
        await deleteGrantsForResource(ctx.workspaceId, "knowledge_base", base.id);
      } else {
        for (const teamId of grantTeamIdsToRemove) {
          await deleteGrantRow(teamId, "knowledge_base", base.id);
        }
      }
    }
    if (saved === null) {
      const fresh = await getBaseById(ctx, id);
      throw new KnowledgeStaleVersionError(expectedUpdatedAt!, fresh.updatedAt);
    }
    return saved;
  } catch (err) {
    if (errorCode(err) === "23505" && patch.slug) {
      throw new KnowledgeBaseSlugConflictError(patch.slug);
    }
    throw err;
  }
}

/**
 * PERMANENTLY delete a base and every folder/entry inside it. There is no
 * trash and no restore — the delete lands immediately (2026-08-07). The
 * gates are unchanged from the old soft-delete path: the caller must be
 * able to SEE the base (`getBaseById`), an agent may not delete a base
 * flagged `agent_write_enabled=false` (F-10), and the caller needs `edit`.
 *
 * Team grants are NOT cleared here on purpose: `team_resource_access` has a
 * polymorphic `resource_id` with no FK, so the cleanup is an AFTER DELETE
 * trigger on `knowledge_bases` (`knowledge_base_grants_cleanup`, migration
 * 20260807130000) — the same shape workflows, chats, chat folders and skills
 * already use. The trigger also covers the delete paths this function isn't
 * (workspace cascade, admin SQL), which a DELETE statement here would miss.
 */
export async function deleteBase(
  ctx: KnowledgeContext,
  id: string
): Promise<void> {
  const base = await getBaseById(ctx, id);
  // F-10: a base flagged read-only to agents must not be deletable by an
  // agent, even though it's the base's own creator — the destructive path
  // honors `agent_write_enabled` the same way content writes do.
  assertAgentCanDelete(ctx, base);
  await assertBaseWritable(ctx, base);
  await repo.hardDeleteBase(ctx.workspaceId, id);
}
