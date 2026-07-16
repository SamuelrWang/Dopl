import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import { slugify } from "@/shared/lib/slug/slugify";
import { HttpError } from "@/shared/lib/http-error";
import { meetsMinRole } from "@/features/workspaces/types";
import {
  deleteGrantsForResource,
  insertReadGrantsIfMissing,
  listGrantsForResources,
  listTeamIdsForUser,
} from "@/features/teams/server/repository";
import type { Skill, SkillContext, SkillFile } from "../types";
import type { SkillCreateInput, SkillUpdateInput } from "../schema";
import {
  SkillSlugConflictError,
  SkillStaleVersionError,
  WorkspaceKeyPrivateSkillError,
} from "./errors";
import * as repo from "./repository";
import * as history from "./history";
import { assertAgentWriteAllowed } from "./service-shared";
import { getSkillBySlug } from "./service-reads";

/**
 * Skill writes — create / update (incl. sharing-scope transitions) /
 * delete / duplicate. Every mutation records history through the single
 * `./history` choke-point (`recordVersion` / `recordEvent`).
 */

const SLUG_RETRY_MAX = 3;

export async function createSkill(
  ctx: SkillContext,
  input: SkillCreateInput
): Promise<{ skill: Skill; primaryFile: SkillFile }> {
  // Since F-029 the SKILL.md body is a column on the skill row, so the
  // skill and its body are one atomic insert (no more two-phase insert +
  // rollback). Slug collisions still retry.

  // Audit B6 + B15: visibility default depends on the caller. Same
  // rules as createBase — workspace-scoped keys default to public and
  // can't create private; everyone else defaults to private.
  const fromWorkspaceKey = ctx.apiKeyWorkspaceId != null;
  let resolvedVisibility = input.visibility;
  if (fromWorkspaceKey) {
    if (resolvedVisibility === "private") {
      throw new WorkspaceKeyPrivateSkillError();
    }
    resolvedVisibility = resolvedVisibility ?? "public";
  } else {
    resolvedVisibility = resolvedVisibility ?? "private";
  }

  if (input.slug && isUuid(input.slug)) {
    throw HttpError.badRequest(
      "Slug may not be UUID-shaped — UUID-form references resolve to skill ids."
    );
  }
  let attempt = 0;
  let baseSlug =
    input.slug ??
    deriveSlug(input.name, await repo.listSlugsForWorkspace(ctx.workspaceId));

  let skill: Skill | null = null;
  while (skill === null) {
    try {
      skill = await repo.insertSkill({
        workspaceId: ctx.workspaceId,
        slug: baseSlug,
        name: input.name,
        description: input.description,
        whenToUse: input.whenToUse,
        whenNotToUse: input.whenNotToUse ?? null,
        status: input.status ?? "active",
        // Default true to mirror knowledge_bases — creator's agent gets
        // write by default. Real enforcement is the access matrix in
        // `requireResourceAccess`; this column just keeps UI/MCP
        // messaging in sync with reality.
        agentWriteEnabled: input.agentWriteEnabled ?? true,
        visibility: resolvedVisibility,
        folder: normalizeFolder(input.folder),
        body: input.body ?? "",
        createdBy: ctx.userId,
        source: ctx.source,
      });
    } catch (err) {
      const code = repo.pgErrorCode(err);
      if (code === "23505" && attempt < SLUG_RETRY_MAX) {
        attempt += 1;
        baseSlug = deriveSlug(
          input.name,
          await repo.listSlugsForWorkspace(ctx.workspaceId)
        );
        continue;
      }
      if (code === "23505") throw new SkillSlugConflictError(baseSlug);
      throw err;
    }
  }

  const primaryFile = await repo.readSkillBody(ctx.workspaceId, skill.id);
  if (!primaryFile) throw new Error("Skill body missing right after insert");
  await history.recordVersion({ ctx, skillId: skill.id, body: primaryFile.body });
  await history.recordEvent({ ctx, skillId: skill.id, type: "skill.created" });
  return { skill, primaryFile };
}

export async function updateSkill(
  ctx: SkillContext,
  slug: string,
  patch: SkillUpdateInput,
  expectedUpdatedAt?: string
): Promise<Skill> {
  const skill = await getSkillBySlug(ctx, slug);
  // Agents can't flip the agent-write toggle (it's a human-controlled,
  // per-skill setting). Silently IGNORE the field for agent callers rather
  // than failing the whole update — agents routinely echo it back alongside
  // legitimate metadata edits, and rejecting on mere presence (with a
  // "writes disabled" message that is wrong when the toggle is ON) was a
  // confusing dead end. Human callers may still set it.
  const nextAgentWriteEnabled =
    ctx.source === "agent" ? undefined : patch.agentWriteEnabled;
  // Sharing scope (full three-way model). Changing it is owner-or-
  // workspace-admin only; agents may re-scope skills THEY created
  // (needed so an agent can publish its own skill for workflow refs).
  // Going team-scoped replaces the grant set wholesale; any other scope
  // drops all grants. Non-admin owners may only grant teams they belong
  // to (plus already-granted teams) — the KB/chat rule.
  const isAdmin = ctx.role !== null && meetsMinRole(ctx.role, "admin");
  let sharingPatch: {
    visibility?: "public" | "private";
    accessMode?: "workspace" | "teams";
  } = {};
  let grantTeamIds: string[] | null = null;
  if (patch.visibility !== undefined) {
    if (skill.createdBy !== ctx.userId && !isAdmin) {
      throw new HttpError(
        403,
        "RESOURCE_ACCESS_DENIED",
        "Only the skill's owner or a workspace admin can change sharing"
      );
    }
    const wantsTeams =
      patch.visibility === "public" && patch.accessMode === "teams";
    sharingPatch = {
      visibility: patch.visibility,
      accessMode: wantsTeams ? "teams" : "workspace",
    };
    // Workflow invariant: attached skills must stay workspace-public
    // (attachment requires it — see assertSkillAttachable). Narrowing
    // to private or team scope would silently break every workflow
    // that references the skill, so it's rejected with the list.
    const narrows = patch.visibility === "private" || wantsTeams;
    if (narrows) {
      const usedBy = await repo.listSkillUsedBy(ctx.workspaceId, skill.id);
      if (usedBy.workflows.length > 0) {
        const names = usedBy.workflows.map((w) => `"${w.name}"`).join(", ");
        throw new HttpError(
          409,
          "SKILL_ATTACHED_TO_WORKFLOWS",
          `This skill is attached to ${usedBy.workflows.length} workflow${
            usedBy.workflows.length === 1 ? "" : "s"
          } (${names}) — detach it before narrowing its sharing`
        );
      }
    }
    if (wantsTeams) {
      grantTeamIds = [...new Set(patch.teamIds ?? [])];
      if (!isAdmin && grantTeamIds.length > 0) {
        const [myTeams, existing] = await Promise.all([
          listTeamIdsForUser(ctx.workspaceId, ctx.userId),
          listGrantsForResources(ctx.workspaceId, "skill", [skill.id]),
        ]);
        const allowed = new Set([...myTeams, ...existing.map((g) => g.teamId)]);
        if (grantTeamIds.some((id) => !allowed.has(id))) {
          throw new HttpError(
            403,
            "RESOURCE_ACCESS_DENIED",
            "You can only grant teams you belong to"
          );
        }
      }
    }
  }
  await assertAgentWriteAllowed(ctx, skill);
  if (expectedUpdatedAt && skill.updatedAt !== expectedUpdatedAt) {
    throw new SkillStaleVersionError(expectedUpdatedAt, skill.updatedAt);
  }
  if (patch.slug && patch.slug !== skill.slug) {
    if (isUuid(patch.slug)) {
      throw HttpError.badRequest(
        "Slug may not be UUID-shaped — UUID-form references resolve to skill ids."
      );
    }
    const taken = await repo.listSlugsForWorkspace(ctx.workspaceId);
    if (taken.includes(patch.slug)) throw new SkillSlugConflictError(patch.slug);
  }
  try {
    const saved = await repo.updateSkillRow(
      skill.id,
      {
        name: patch.name,
        description: patch.description,
        whenToUse: patch.whenToUse,
        whenNotToUse: patch.whenNotToUse,
        slug: patch.slug,
        status: patch.status,
        agentWriteEnabled: nextAgentWriteEnabled,
        folder:
          patch.folder === undefined ? undefined : normalizeFolder(patch.folder),
        ...sharingPatch,
        lastEditedBy: ctx.userId,
        lastEditedSource: ctx.source,
      },
      expectedUpdatedAt
    );
    // null = atomic CAS lost the race; re-fetch for the actual version.
    if (saved === null) {
      const fresh = await getSkillBySlug(ctx, slug);
      throw new SkillStaleVersionError(expectedUpdatedAt!, fresh.updatedAt);
    }
    if (patch.visibility !== undefined) {
      // Replace-set semantics: clear, then re-insert the new grant set.
      await deleteGrantsForResource(ctx.workspaceId, "skill", skill.id);
      if (grantTeamIds && grantTeamIds.length > 0) {
        await insertReadGrantsIfMissing(
          ctx.workspaceId,
          "skill",
          skill.id,
          grantTeamIds
        );
      }
      if (skill.visibility === "private" && patch.visibility === "public") {
        await history.recordEvent({ ctx, skillId: skill.id, type: "skill.published" });
      } else if (
        patch.visibility !== skill.visibility ||
        sharingPatch.accessMode !== skill.accessMode
      ) {
        await history.recordEvent({
          ctx,
          skillId: skill.id,
          type: "skill.updated",
          detail: { fields: ["sharing"] },
        });
      }
    }
    const changed = (
      ["name", "description", "whenToUse", "whenNotToUse", "slug", "status"] as const
    ).filter((k) => patch[k] !== undefined && patch[k] !== skill[k]);
    if (changed.length > 0) {
      await history.recordEvent({
        ctx,
        skillId: skill.id,
        type: "skill.updated",
        detail: { fields: changed },
      });
    }
    // Keep the returned grant set honest for the caller's UI — but only
    // owners/admins get to see it (no team-composition leak), and the
    // fetch is skipped entirely for everyone else.
    const seesGrants = saved.createdBy === ctx.userId || isAdmin;
    const teamIds =
      saved.accessMode === "teams" && seesGrants
        ? (grantTeamIds ?? (await currentGrantIds(ctx, saved)))
        : [];
    return { ...saved, grantedTeamIds: teamIds };
  } catch (err) {
    if (repo.pgErrorCode(err) === "23505" && patch.slug) {
      throw new SkillSlugConflictError(patch.slug);
    }
    throw err;
  }
}

/** The skill's current team grant set (empty unless team-scoped). */
async function currentGrantIds(
  ctx: SkillContext,
  skill: Skill
): Promise<string[]> {
  if (skill.accessMode !== "teams" || skill.visibility !== "public") return [];
  const grants = await listGrantsForResources(ctx.workspaceId, "skill", [skill.id]);
  return grants.map((g) => g.teamId);
}

export async function deleteSkill(
  ctx: SkillContext,
  slug: string
): Promise<void> {
  const skill = await getSkillBySlug(ctx, slug);
  await assertAgentWriteAllowed(ctx, skill);
  await repo.markSkillDeleted(skill.id);
  await history.recordEvent({ ctx, skillId: skill.id, type: "skill.trashed" });
}

/**
 * Fork a skill: copies metadata + the single SKILL.md into a new
 * private draft ("<name> (copy)"). Composed from createSkill so history
 * records the fork like any other authored skill.
 */
export async function duplicateSkill(
  ctx: SkillContext,
  slug: string
): Promise<{ skill: Skill; primaryFile: SkillFile }> {
  const source = await getSkillBySlug(ctx, slug);
  const primary = await repo.readSkillBody(ctx.workspaceId, source.id);

  const created = await createSkill(ctx, {
    name: `${source.name} (copy)`,
    description: source.description,
    whenToUse: source.whenToUse,
    whenNotToUse: source.whenNotToUse,
    status: "draft",
    folder: source.folder,
    body: primary?.body ?? "",
  });
  // createSkill's input has no connectors field (they're display
  // metadata, not caller-authored) — copy them onto the fork directly
  // so the duplicate keeps its connector chips.
  let skill = created.skill;
  if (source.connectors.length > 0) {
    skill = await repo.updateSkillRow(skill.id, {
      connectors: source.connectors,
    });
  }
  return { skill, primaryFile: created.primaryFile };
}

function deriveSlug(input: string, taken: string[]): string {
  return slugify(input, "skill", taken);
}

/** Trim a folder label; empty (or whitespace-only) becomes unfiled (null). */
function normalizeFolder(folder: string | null | undefined): string | null {
  if (folder == null) return null;
  const trimmed = folder.trim();
  return trimmed === "" ? null : trimmed;
}
