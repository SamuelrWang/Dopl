import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
import { meetsMinRole } from "@/features/workspaces/types";
// 🔒 G16 — the ONE statement of the publish-into-a-peer's-room precondition,
// shared with `agent-templates/server/service-writes.ts`. Two copies of a
// tenancy predicate is how the shelf fence ended up divergent (findings §6 #3).
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
import { getBaseById } from "./service-bases";
// ⚠ THE TWO PRE-WRITE GATES, SPLIT OUT AT THE §1 CAP (2026-09-02). Read that
// module's header for the seam. `assertCreatorCanReadItBack` asks the SAME
// ceiling question `listBases` / `getBaseBySlug` will ask a millisecond later,
// or this writes rows nobody can reach.
import {
  assertCreatorCanReadItBack,
  resolveHomeScope,
} from "./service-base-gates";
import { setChannelKnowledgeGrant } from "./service-channel-grants";

/**
 * Knowledge base writes — create / update (incl. sharing-scope transitions) /
 * delete. Delete is PERMANENT: no trash, no restore.
 */

const SLUG_RETRY_MAX = 3;

export async function createBase(
  ctx: KnowledgeContext,
  input: KnowledgeBaseCreateInput,
): Promise<KnowledgeBase> {
  // 🔒 THE AUDIENCE CEILING, ASKED BEFORE THE INSERT rather than only by the
  // reads afterwards (F-323's authoring half) — see
  // `assertCreatorCanReadItBack`. ⚠ FIRST, before any other validation and
  // before the slug derivation's read: a caller that may not create here should
  // spend no round trips finding out, and must not be told about a slug
  // collision with a row it cannot see.
  await assertCreatorCanReadItBack(ctx);

  // No per-base agent-write gate on CREATE — that toggle is per-base and the
  // base doesn't exist yet. Slug unique per workspace keeps MCP `kb_*` slug
  // addressing unambiguous; publicId is the URL routing key.
  //
  // Visibility default by caller: a SHARED credential must be 'public'
  // (⚠ `canSeeBase` blocks such credentials from reading their own private rows
  // back, so a private one is stranded — explicit 'private' rejected loudly);
  // session caller / container session → 'private', owner publishes later.
  //
  // ⚠ THE PREDICATE MOVED WITH `canSeeBase` ON 2026-08-27 (F-336) BECAUSE THE
  // COMMENT ABOVE IS THE WHOLE JUSTIFICATION FOR THE FENCE. A container-session
  // credential CAN read its own private rows back now, so the stranding it
  // guards against does not exist for it, and forcing 'public' would have the
  // operator's agent publish into the room the PEER is standing in — the
  // opposite of what this branch is for.
  const fromWorkspaceKey = isSharedCredential(ctx);
  let resolvedVisibility = input.visibility;
  if (fromWorkspaceKey) {
    if (resolvedVisibility === "private") {
      throw new WorkspaceKeyPrivateVisibilityError();
    }
    resolvedVisibility = resolvedVisibility ?? "public";
  } else {
    resolvedVisibility = resolvedVisibility ?? "private";
  }

  // Teams mode is human-only; non-admin creators may only grant teams they
  // belong to.
  const wantsTeams = input.accessMode === "teams";
  const teamGrants = wantsTeams ? (input.teamGrants ?? []) : [];
  if (wantsTeams) {
    if (ctx.source === "agent") {
      throw new AgentWriteDisabledError(
        "(new)",
        "Sharing scope is a human-only setting — agents cannot create teams-scoped knowledge bases.",
      );
    }
    if (!meetsMinRole(ctx.role, "admin")) {
      const myTeams = new Set(
        await listTeamIdsForUser(ctx.workspaceId, ctx.userId),
      );
      if (teamGrants.some((g) => !myTeams.has(g.teamId))) {
        throw new TeamScopeForbiddenError();
      }
    }
    // Teams implies shared — schema already rejects private+teams.
    resolvedVisibility = "public";
  }

  // 🔒 WHICH SHELF, decided BEFORE the insert loop so a slug retry cannot
  // re-ask a question with a side effect. Throws rather than returning false.
  const homeScoped = await resolveHomeScope(
    ctx,
    input,
    resolvedVisibility,
    fromWorkspaceKey,
  );

  // 🔒 G16 — PUBLISHING INTO THE ROOM A PEER IS STANDING IN. ⚠ The RESOLVED
  // visibility, after the teams branch has had its say: `accessMode: "teams"`
  // rewrites it to `public`, and reading `input.visibility` would let that
  // rewrite publish unacknowledged. Same reason `resolveHomeScope` takes the
  // resolved value rather than the raw input.
  // ⚠ BEFORE THE SLUG LOOP, so a refusal costs no slug and cannot half-land.
  await assertSharedPublishAcknowledged({
    workspaceId: ctx.workspaceId,
    publishes: resolvedVisibility === "public",
    acknowledged: input.acknowledgeShared,
    noun: "knowledge base",
  });

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
        // Default true so the creator's agent can write without an opt-in
        // step. ⚠ Real enforcement is `requireEffectiveAccess`'s grant check,
        // NOT this column — TRUE here only keeps UI/MCP messaging honest.
        agentWriteEnabled: input.agentWriteEnabled ?? true,
        visibility: resolvedVisibility,
        accessMode: wantsTeams ? "teams" : "workspace",
        homeScoped,
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

  // Roll the base back on grant failure, else a retry trips slug uniqueness
  // against the orphan.
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
      await repo.hardDeleteBase(ctx.workspaceId, base.id).catch(() => {});
      throw err;
    }
  }

  // 🔒 CREATE-AND-SHARE, ATOMIC BY THE SAME ROLLBACK THE TEAM GRANTS USE
  // (Samuel's ruling 2026-08-27 — the /home Shared section's create button).
  //
  // ⚠ THE ROLLBACK IS NOT TIDINESS. Two independent statements is what this is,
  // so the failure mode without it is a base that exists, is shared with nobody,
  // and is INVISIBLE on the surface that made it (/home shows a container base
  // only through a grant) — and whose slug then collides with the retry. Hard
  // delete, not soft: the row must stop existing, not become a tombstone that
  // still owns the slug.
  //
  // ⚠ THE GRANT IS ALWAYS `visible`, NEVER `agent_only`. The button says
  // "shared"; `agent_only` is a different audience (the operator's agent, not
  // the person in the room) and is reached from the base's own settings, which
  // is where a THREE-state control belongs. `guestWrite` starts FALSE — handing
  // a guest a pen is its own decision, taken later and deliberately.
  //
  // ⚠ NOT A FORKED WRITE PATH. `setChannelKnowledgeGrant` is the same service
  // the sharing settings section calls; it owns `canManageChannelGrants` (which
  // the creator passes by construction), the trigger's same-workspace refusal,
  // and — since 2026-08-27 — the agent refusal this second caller made
  // necessary. The CHANNEL ITSELF is fenced by the ROUTE (`isChannelVisibleTo`)
  // before this function runs, exactly as the grant PUT does it.
  if (input.shareToChannelId) {
    try {
      await setChannelKnowledgeGrant(ctx, base, {
        channelId: input.shareToChannelId,
        level: "visible",
        guestWrite: false,
      });
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
  expectedUpdatedAt?: string,
): Promise<KnowledgeBase> {
  const base = await getBaseById(ctx, id);
  // Agents can never flip the toggle itself, whatever its current state.
  // Other writes (name, description, slug) honor it when off.
  if (ctx.source === "agent" && patch.agentWriteEnabled !== undefined) {
    throw new AgentWriteDisabledError(base.id);
  }
  // Sharing scope (visibility / accessMode / teamGrants): owner or workspace
  // admin only, never agents — same human-only rule as the write toggle.
  const sharingRequested =
    patch.visibility !== undefined ||
    patch.accessMode !== undefined ||
    patch.teamGrants !== undefined;
  let resolvedVisibility: "public" | "private" | undefined;
  let resolvedAccessMode: "workspace" | "teams" | undefined;
  let grantTeamIdsToRemove: string[] = [];
  let dropAllGrants = false;

  if (sharingRequested) {
    // Carve-out: agents MAY publish a base they created. "Pure publish" =
    // visibility:'public' with no accessMode/teamGrants change. Un-publishing,
    // accessMode and grants stay human-only.
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
    const isAdmin = meetsMinRole(ctx.role, "admin");
    const isCreator = base.createdBy === ctx.userId;
    // Agent publish is creator-only — no admin override, an agent acts only
    // on its own resources. Human path keeps creator-or-admin.
    if (agentPurePublish ? !isCreator : !isCreator && !isAdmin) {
      throw new ScopeChangeForbiddenError();
    }

    // 🔒 G16 — the same precondition on the UPDATE path, which is the door
    // `dopl_kb(op="set_visibility")` and the sharing settings both come through.
    // ⚠ `patch.visibility`, NOT `targetVisibility`: a grant-only or accessMode
    // edit on a base that is ALREADY public changes no audience, and gating it
    // would be a gate on the wrong verb.
    // ⚠ AFTER the creator/admin check above and BEFORE any grant upsert, so a
    // refusal leaves neither a row nor a grant behind.
    await assertSharedPublishAcknowledged({
      workspaceId: ctx.workspaceId,
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
      // SHARED credentials can't read private rows back, so they may not
      // create this state either. ⚠ Same predicate as `canSeeBase` on purpose
      // (F-336): the fence is "can this caller read it back?", not "is it
      // locked?".
      if (isSharedCredential(ctx)) {
        throw new WorkspaceKeyPrivateVisibilityError();
      }
      dropAllGrants = true;
    } else if (targetMode === "teams") {
      // `teamGrants` is the declarative FULL set; diff against current rows.
      const current = await listGrantsForResource(
        ctx.workspaceId,
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
          await listTeamIdsForUser(ctx.workspaceId, ctx.userId),
        );
        if (addedOrRaised.some(([teamId]) => !myTeams.has(teamId))) {
          throw new TeamScopeForbiddenError();
        }
      }

      for (const [teamId, level] of addedOrRaised) {
        await upsertGrant(
          ctx.workspaceId,
          teamId,
          "knowledge_base",
          base.id,
          level,
        );
      }
      // NARROWING IS UNCHECKED, DELIBERATELY: no cross-resource dependency
      // survives that a narrowed base could strand.
    }
    // → workspace is pure widening: grants stay as inert rows, remembered if
    // re-narrowed, matching `setResourceAccessMode`.

    // ⚠ Write BOTH columns whenever sharing was touched: keeps the row update
    // non-empty for grant-only edits and bumps `updated_at` so CAS clients
    // refresh their snapshot.
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
      expectedUpdatedAt,
    );
    // ⚠ Grant deletions only AFTER the row update succeeds, else a
    // stale-version rejection half-applies the scope change.
    if (saved !== null) {
      if (dropAllGrants) {
        await deleteGrantsForResource(
          ctx.workspaceId,
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
 * PERMANENT delete of a base and everything in it. Gates: caller must SEE the
 * base (`getBaseById`), agents can't delete an `agent_write_enabled=false` base
 * (F-10), caller needs `edit`.
 *
 * ⚠ Team grants NOT cleared here on purpose — `team_resource_access` has a
 * polymorphic `resource_id` with no FK, so cleanup is the AFTER DELETE trigger
 * `knowledge_base_grants_cleanup`, which also covers paths this function isn't
 * (workspace cascade, admin SQL).
 */
export async function deleteBase(
  ctx: KnowledgeContext,
  id: string,
): Promise<void> {
  const base = await getBaseById(ctx, id);
  // F-10: agent-read-only base is undeletable by an agent even its own
  // creator — destructive path honors `agent_write_enabled` like writes do.
  assertAgentCanDelete(ctx, base);
  await assertBaseWritable(ctx, base);
  await repo.hardDeleteBase(ctx.workspaceId, id);
}
