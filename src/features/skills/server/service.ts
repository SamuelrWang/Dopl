import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isUuid } from "@/shared/lib/id/uuid";
import { slugify } from "@/shared/lib/slug/slugify";
import { HttpError } from "@/shared/lib/http-error";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { findMembership } from "@/features/workspaces/server/repository";
import { meetsLevel } from "@/features/teams/access-levels";
import { effectiveResourceAccess } from "@/features/teams/server/access";
import {
  deleteGrantsForResource,
  insertReadGrantsIfMissing,
  listGrantsForResources,
  listTeamIdsForUser,
} from "@/features/teams/server/repository";
import { PRIMARY_SKILL_FILE_NAME } from "../types";
import type {
  ResolvedSkill,
  SkillUsage,
  ResolvedSkillReference,
  Skill,
  SkillContext,
  SkillFile,
  WorkspaceKbSummary,
} from "../types";
import { parseSkillBody, type SkillRef } from "../skill-body";
import type {
  SkillCreateInput,
  SkillFileCreateInput,
  SkillFileRenameInput,
  SkillFileWriteInput,
  SkillUpdateInput,
} from "../schema";
import {
  SkillAgentWriteDisabledError,
  SkillFileConflictError,
  SkillFileNotFoundError,
  SkillNotFoundError,
  SkillPrimaryFileImmutableError,
  SkillSlugConflictError,
  SkillStaleVersionError,
  WorkspaceKeyPrivateSkillError,
} from "./errors";
import * as repo from "./repository";
import * as history from "./history";
import { buildSeedSkills } from "./seed";

/**
 * Service layer for the skills feature.
 *
 * Single source of truth for both REST handlers and MCP tools. Builds a
 * `SkillContext` from auth metadata at the route boundary, resolves
 * slugs to ids, and enforces the per-skill `agent_write_enabled`
 * toggle on every agent-origin mutation.
 *
 * The repository (`./repository.ts`) bypasses RLS via the service-role
 * client — every method here MUST filter by `ctx.workspaceId` so cross-
 * workspace leakage stays impossible.
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SLUG_RETRY_MAX = 3;

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role?: Role | null;
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
}

export function buildSkillContext(auth: AuthLike): SkillContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.agentTokenId ? "agent" : "user",
    role: auth.role ?? null,
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
  };
}

/** Precomputed grant context for visibility checks over a set of rows.
 *  Mirrors `grantsForRows` in the chats service. */
interface SkillGrantCtx {
  /** Teams the caller belongs to. Fetched only when needed. */
  myTeamIds: Set<string>;
  /** skillId → teamIds granted read access. */
  bySkill: Map<string, string[]>;
}

const EMPTY_SKILL_GRANTS: SkillGrantCtx = {
  myTeamIds: new Set(),
  bySkill: new Map(),
};

/** Fetch the caller's teams + skill grants — but only when some row is
 *  team-scoped and not the caller's own (fixed query count per request). */
async function grantsForSkills(
  ctx: SkillContext,
  rows: Skill[]
): Promise<SkillGrantCtx> {
  const teamScoped = rows.filter(
    (s) => s.visibility === "public" && s.accessMode === "teams"
  );
  if (teamScoped.length === 0) return EMPTY_SKILL_GRANTS;
  const needsMembership = teamScoped.some((s) => s.createdBy !== ctx.userId);
  const [myTeams, grants] = await Promise.all([
    needsMembership && !ctx.apiKeyWorkspaceId
      ? listTeamIdsForUser(ctx.workspaceId, ctx.userId)
      : Promise.resolve([]),
    listGrantsForResources(
      ctx.workspaceId,
      "skill",
      teamScoped.map((s) => s.id)
    ),
  ]);
  const bySkill = new Map<string, string[]>();
  for (const g of grants) {
    bySkill.set(g.resourceId, [...(bySkill.get(g.resourceId) ?? []), g.teamId]);
  }
  return { myTeamIds: new Set(myTeams), bySkill };
}

/**
 * Three-way visibility filter (M-10 extended for team scoping — the
 * exact model `canSeeChat` uses):
 *   - Public + workspace mode: always.
 *   - Public + teams mode: owner, workspace admins, or members of a
 *     granted team. Never via a workspace-scoped API key.
 *   - Private via session or personal credential: owner-only.
 *   - Private via workspace-scoped API key: never.
 */
function canSeeSkill(
  ctx: SkillContext,
  skill: Skill,
  grants: SkillGrantCtx
): boolean {
  if (skill.visibility === "public" && skill.accessMode !== "teams") return true;
  if (ctx.apiKeyWorkspaceId) return false;
  if (skill.createdBy === ctx.userId) return true;
  if (skill.visibility !== "public") return false;
  if (ctx.role !== null && meetsMinRole(ctx.role, "admin")) return true;
  const granted = grants.bySkill.get(skill.id) ?? [];
  return granted.some((teamId) => grants.myTeamIds.has(teamId));
}

/** Grant set for the DTO — owners (and admins) see it; other viewers get
 *  an empty list so team composition doesn't leak through a shared skill. */
function withGrantSet(
  ctx: SkillContext,
  skill: Skill,
  grants: SkillGrantCtx
): Skill {
  if (skill.accessMode !== "teams") return skill;
  const isAdmin = ctx.role !== null && meetsMinRole(ctx.role, "admin");
  if (skill.createdBy !== ctx.userId && !isAdmin) return skill;
  return { ...skill, grantedTeamIds: grants.bySkill.get(skill.id) ?? [] };
}

// ─── Skill reads ────────────────────────────────────────────────────

export async function listSkills(
  ctx: SkillContext,
  opts: { includeConnectors?: boolean } = {}
): Promise<Skill[]> {
  const all = await repo.listSkillsForWorkspace(ctx.workspaceId, opts);
  const grants = await grantsForSkills(ctx, all);
  const visible = all
    .filter((s) => canSeeSkill(ctx, s, grants))
    .map((s) => withGrantSet(ctx, s, grants));
  if (visible.length > 0) return visible;
  // CRITICAL: same reasoning as `listBases` — seed only when the
  // workspace has NO skills at all, not when the caller sees zero.
  if (all.length > 0) return visible;
  // DEMO BYPASS: auto-seed disabled. Mirrors the same guard in
  // src/features/knowledge/server/service.ts `listBases`. Flip
  // DEMO_DISABLE_AUTO_SEED to false (or delete the guard) to restore
  // the original onboarding-seed behavior below.
  const DEMO_DISABLE_AUTO_SEED: boolean = true;
  if (DEMO_DISABLE_AUTO_SEED) return visible;
  const workspaceCreatedAt = await fetchWorkspaceCreatedAt(ctx.workspaceId);
  if (
    workspaceCreatedAt !== null &&
    Date.now() - workspaceCreatedAt.getTime() < TWENTY_FOUR_HOURS_MS
  ) {
    await seedWorkspace(ctx);
    const seeded = await repo.listSkillsForWorkspace(ctx.workspaceId, opts);
    const seededGrants = await grantsForSkills(ctx, seeded);
    return seeded
      .filter((s) => canSeeSkill(ctx, s, seededGrants))
      .map((s) => withGrantSet(ctx, s, seededGrants));
  }
  return visible;
}

/**
 * Resolve a skill by slug OR stable UUID id (MCP-14: renames change the
 * slug, so agents need an immutable handle). Every skill read/write op
 * funnels through here, so id acceptance applies uniformly.
 */
export async function getSkillBySlug(
  ctx: SkillContext,
  ref: string
): Promise<Skill> {
  const skill = isUuid(ref)
    ? await repo.findSkillById(ctx.workspaceId, ref)
    : await repo.findSkillBySlug(ctx.workspaceId, ref);
  if (!skill) throw new SkillNotFoundError(ref);
  const grants = await grantsForSkills(ctx, [skill]);
  if (!canSeeSkill(ctx, skill, grants)) throw new SkillNotFoundError(ref);
  return withGrantSet(ctx, skill, grants);
}

export async function listFiles(
  ctx: SkillContext,
  slug: string,
  opts: { includeBody?: boolean } = {}
): Promise<SkillFile[]> {
  const skill = await getSkillBySlug(ctx, slug);
  return repo.listFilesForSkill(skill.id, opts);
}

export async function readFile(
  ctx: SkillContext,
  slug: string,
  fileName: string
): Promise<SkillFile> {
  const skill = await getSkillBySlug(ctx, slug);
  const file = await repo.findFileByName(skill.id, fileName);
  if (!file) throw new SkillFileNotFoundError(slug, fileName);
  return file;
}

/**
 * Resolves a skill for the agent: returns the skill record, every file,
 * and a per-reference availability check. Pointer-with-hint resolution
 * — KB content is not inlined; the agent calls `kb_read_file` if it
 * needs the actual KB content.
 */
export async function resolveSkillBody(
  ctx: SkillContext,
  slug: string
): Promise<ResolvedSkill> {
  const skill = await getSkillBySlug(ctx, slug);
  const files = await repo.listFilesForSkill(skill.id);
  const seen = new Set<string>();
  const refs: SkillRef[] = [];
  for (const file of files) {
    const parsed = parseSkillBody(file.body);
    for (const ref of parsed.references) {
      const key = ref.kind === "kb"
        ? `kb:${ref.slug}`
        : `connector:${ref.provider}${ref.field ? `.${ref.field}` : ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push(ref);
      }
    }
  }
  const references = await Promise.all(refs.map((r) => resolveReference(ctx, r)));
  return { skill, files, references };
}

// ─── Skill writes ───────────────────────────────────────────────────

export async function createSkill(
  ctx: SkillContext,
  input: SkillCreateInput
): Promise<{ skill: Skill; primaryFile: SkillFile }> {
  // Two-phase insert: skill row first (with slug retry), then SKILL.md.
  // If the file insert fails, soft-delete the just-created skill so we
  // don't leave an orphan row pointing to nothing the UI can render.
  // Supabase JS doesn't expose transactions outside RPCs; this rollback
  // pattern is the next-best thing.

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

  try {
    const primaryFile = await repo.insertFile({
      workspaceId: ctx.workspaceId,
      skillId: skill.id,
      name: PRIMARY_SKILL_FILE_NAME,
      body: input.body ?? "",
      position: 0,
      createdBy: ctx.userId,
      source: ctx.source,
    });
    await history.recordVersion({
      ctx,
      skillId: skill.id,
      fileId: primaryFile.id,
      fileName: primaryFile.name,
      body: primaryFile.body,
    });
    await history.recordEvent({ ctx, skillId: skill.id, type: "skill.created" });
    return { skill, primaryFile };
  } catch (fileErr) {
    // Roll back the skill row so the failure doesn't leave a
    // SKILL.md-less skill the UI can't render. Best-effort — if the
    // rollback itself fails, the original error is still the one we
    // surface.
    try {
      await repo.markSkillDeleted(skill.id);
    } catch {
      // Swallow: the original fileErr is more useful to the caller.
    }
    throw fileErr;
  }
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

// ─── File writes ────────────────────────────────────────────────────

export async function createFile(
  ctx: SkillContext,
  slug: string,
  input: SkillFileCreateInput
): Promise<SkillFile> {
  const skill = await getSkillBySlug(ctx, slug);
  await assertAgentWriteAllowed(ctx, skill);
  if (input.name === PRIMARY_SKILL_FILE_NAME) {
    // The primary file is created by op=create and is immutable via the
    // file ops — reject explicitly (rather than as a generic "already
    // exists" conflict) so the reason is clear even if no SKILL.md row
    // currently exists. Mirrors the rename/delete guards below.
    throw new SkillPrimaryFileImmutableError(
      "SKILL.md is the primary file (created with the skill) and can't be added via create_file."
    );
  }
  const existing = await repo.findFileByName(skill.id, input.name);
  if (existing) throw new SkillFileConflictError(input.name);
  const siblings = await repo.listFilesForSkill(skill.id, { includeBody: false });
  const nextPos =
    siblings.length === 0 ? 1 : Math.max(...siblings.map((f) => f.position)) + 1;
  let created: SkillFile;
  try {
    created = await repo.insertFile({
      workspaceId: ctx.workspaceId,
      skillId: skill.id,
      name: input.name,
      body: input.body ?? "",
      position: nextPos,
      createdBy: ctx.userId,
      source: ctx.source,
    });
  } catch (err) {
    if (repo.pgErrorCode(err) === "23505") {
      throw new SkillFileConflictError(input.name);
    }
    throw err;
  }
  await history.recordVersion({
    ctx,
    skillId: skill.id,
    fileId: created.id,
    fileName: created.name,
    body: created.body,
  });
  await history.recordEvent({
    ctx,
    skillId: skill.id,
    type: "file.created",
    fileId: created.id,
    detail: { name: created.name },
  });
  return created;
}

export async function writeFile(
  ctx: SkillContext,
  slug: string,
  fileName: string,
  input: SkillFileWriteInput,
  expectedUpdatedAt?: string
): Promise<{ file: SkillFile; skill: Skill }> {
  const skill = await getSkillBySlug(ctx, slug);
  await assertAgentWriteAllowed(ctx, skill);
  const file = await repo.findFileByName(skill.id, fileName);
  if (!file) throw new SkillFileNotFoundError(slug, fileName);
  if (expectedUpdatedAt && file.updatedAt !== expectedUpdatedAt) {
    throw new SkillStaleVersionError(expectedUpdatedAt, file.updatedAt);
  }
  // No-op saves (autosave echoes, agent re-writes of identical content)
  // neither touch the row nor mint a version.
  if (input.body === file.body) {
    return { file, skill };
  }
  const saved = await repo.updateFileRow(
    file.id,
    {
      body: input.body,
      lastEditedBy: ctx.userId,
      lastEditedSource: ctx.source,
    },
    expectedUpdatedAt
  );
  // null = atomic CAS lost the race; re-fetch for the actual version.
  if (saved === null) {
    const fresh = await repo.findFileByName(skill.id, fileName);
    throw new SkillStaleVersionError(
      expectedUpdatedAt!,
      fresh?.updatedAt ?? "concurrent"
    );
  }
  await history.recordVersion({
    ctx,
    skillId: skill.id,
    fileId: saved.id,
    fileName: saved.name,
    body: saved.body,
  });
  return { file: saved, skill };
}

export async function renameFile(
  ctx: SkillContext,
  slug: string,
  currentName: string,
  input: SkillFileRenameInput
): Promise<SkillFile> {
  const skill = await getSkillBySlug(ctx, slug);
  await assertAgentWriteAllowed(ctx, skill);
  if (currentName === PRIMARY_SKILL_FILE_NAME) {
    throw new SkillPrimaryFileImmutableError("SKILL.md cannot be renamed");
  }
  if (input.name === PRIMARY_SKILL_FILE_NAME) {
    throw new SkillFileConflictError(input.name);
  }
  const file = await repo.findFileByName(skill.id, currentName);
  if (!file) throw new SkillFileNotFoundError(slug, currentName);
  if (input.name === currentName) return file;
  const collision = await repo.findFileByName(skill.id, input.name);
  if (collision) throw new SkillFileConflictError(input.name);
  try {
    const renamed = await repo.updateFileRow(file.id, {
      name: input.name,
      lastEditedBy: ctx.userId,
      lastEditedSource: ctx.source,
    });
    await history.recordEvent({
      ctx,
      skillId: skill.id,
      type: "file.renamed",
      fileId: file.id,
      detail: { from: currentName, to: input.name },
    });
    return renamed;
  } catch (err) {
    if (repo.pgErrorCode(err) === "23505") {
      throw new SkillFileConflictError(input.name);
    }
    throw err;
  }
}

export async function deleteFile(
  ctx: SkillContext,
  slug: string,
  fileName: string
): Promise<void> {
  const skill = await getSkillBySlug(ctx, slug);
  await assertAgentWriteAllowed(ctx, skill);
  if (fileName === PRIMARY_SKILL_FILE_NAME) {
    throw new SkillPrimaryFileImmutableError("SKILL.md cannot be deleted");
  }
  const file = await repo.findFileByName(skill.id, fileName);
  if (!file) throw new SkillFileNotFoundError(slug, fileName);
  await repo.markFileDeleted(file.id);
  await history.recordEvent({
    ctx,
    skillId: skill.id,
    type: "file.trashed",
    fileId: file.id,
    detail: { name: file.name },
  });
}

// ─── Trash ──────────────────────────────────────────────────────────

/**
 * Returns the soft-deleted skill and skill_file rows the CALLER MAY
 * SEE, sorted newest-deletion-first. Used by the trash modal. The
 * visibility rule is the same `canSeeSkill` the live list uses —
 * without it the trash would leak other members' private (or
 * non-granted team-scoped) skills' names.
 */
export async function listTrash(
  ctx: SkillContext
): Promise<repo.DeletedSkillRows> {
  const deleted = await repo.listDeletedForWorkspace(ctx.workspaceId);
  // Trashed files may belong to LIVE parents (file trashed alone), so
  // resolve every parent skill before filtering.
  const parents = new Map(deleted.skills.map((s) => [s.id, s]));
  const missingIds = [
    ...new Set(
      deleted.files
        .map((f) => f.skillId)
        .filter((id) => !parents.has(id))
    ),
  ];
  for (const s of await repo.listSkillsByIds(ctx.workspaceId, missingIds)) {
    parents.set(s.id, s);
  }
  const grants = await grantsForSkills(ctx, [...parents.values()]);
  const canSee = (skillId: string) => {
    const s = parents.get(skillId);
    return s !== undefined && canSeeSkill(ctx, s, grants);
  };
  return {
    skills: deleted.skills.filter((s) => canSee(s.id)),
    files: deleted.files.filter((f) => canSee(f.skillId)),
  };
}

/** Restore-path visibility gate — a forged id for a skill the caller
 *  can't see must 404, exactly like the read paths. */
async function assertTrashedSkillVisible(
  ctx: SkillContext,
  skill: Skill
): Promise<void> {
  const grants = await grantsForSkills(ctx, [skill]);
  if (!canSeeSkill(ctx, skill, grants)) throw new SkillNotFoundError(skill.id);
}

export async function restoreSkill(
  ctx: SkillContext,
  id: string
): Promise<Skill> {
  const skill = await repo.findSkillById(ctx.workspaceId, id, true);
  if (!skill) throw new SkillNotFoundError(id);
  await assertTrashedSkillVisible(ctx, skill);
  await assertAgentWriteAllowed(ctx, skill);
  const restored = await repo.restoreSkillRow(id);
  await history.recordEvent({ ctx, skillId: skill.id, type: "skill.restored" });
  return restored;
}

export async function restoreSkillFile(
  ctx: SkillContext,
  id: string
): Promise<SkillFile> {
  const file = await repo.findFileById(id, true);
  if (!file) throw new SkillFileNotFoundError("(unknown)", id);
  // Workspace scope — files don't carry workspace_id directly in code-
  // path but the column exists; cross-check via the parent skill so a
  // forged id from another workspace still 404s.
  const skill = await repo.findSkillById(ctx.workspaceId, file.skillId, true);
  if (!skill) throw new SkillNotFoundError(file.skillId);
  await assertTrashedSkillVisible(ctx, skill);
  await assertAgentWriteAllowed(ctx, skill);
  const restored = await repo.restoreFileRow(id);
  await history.recordEvent({
    ctx,
    skillId: skill.id,
    type: "file.restored",
    fileId: restored.id,
    detail: { name: restored.name },
  });
  return restored;
}

// ─── Workspace KB list ──────────────────────────────────────────────

export async function listWorkspaceKnowledgeBases(
  ctx: SkillContext
): Promise<WorkspaceKbSummary[]> {
  return repo.listWorkspaceKnowledgeBases(ctx.workspaceId);
}

// ─── Resolution helpers ─────────────────────────────────────────────

async function resolveReference(
  ctx: SkillContext,
  ref: SkillRef
): Promise<ResolvedSkillReference> {
  if (ref.kind === "kb") {
    const exists = await repo.knowledgeBaseSlugExists(ctx.workspaceId, ref.slug);
    return {
      kind: "kb",
      slug: ref.slug,
      label: ref.label,
      available: exists,
    };
  }
  return {
    kind: "connector",
    provider: ref.provider,
    field: ref.field,
    label: ref.label,
    available: true,
  };
}

// ─── Agent-write enforcement ────────────────────────────────────────

/**
 * Gate for agent-origin skill writes. Skills participate in the team
 * access matrix now (skill_team_sharing), so the rule is the effective
 * access level: role default on workspace-mode skills, grant level on
 * team-mode ones. Writes need 'edit'.
 *
 * `SkillAgentWriteDisabledError` is still thrown when an agent tries
 * to flip `agentWriteEnabled` itself in updateSkill — that path
 * doesn't call here.
 */
export async function assertAgentWriteAllowed(
  ctx: SkillContext,
  skill: Skill
): Promise<void> {
  if (ctx.source !== "agent") return;
  const membership = await findMembership(ctx.workspaceId, ctx.userId);
  if (!membership || membership.status !== "active") {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }
  const level = await effectiveResourceAccess(
    ctx.userId,
    ctx.workspaceId,
    "skill",
    skill.id,
    { role: membership.role }
  );
  if (level === null || !meetsLevel(level, "edit")) {
    throw new HttpError(
      403,
      "RESOURCE_ACCESS_DENIED",
      "Your access on this skill is read-only"
    );
  }
}

// ─── Duplicate ──────────────────────────────────────────────────────

/**
 * Fork a skill: copies metadata + every file into a new private draft
 * ("<name> (copy)"). Composed from createSkill/createFile so history
 * records the fork like any other authored skill.
 */
export async function duplicateSkill(
  ctx: SkillContext,
  slug: string
): Promise<{ skill: Skill; primaryFile: SkillFile }> {
  const source = await getSkillBySlug(ctx, slug);
  const files = await repo.listFilesForSkill(source.id);
  const primary = files.find((f) => f.name === PRIMARY_SKILL_FILE_NAME);

  const created = await createSkill(ctx, {
    name: `${source.name} (copy)`,
    description: source.description,
    whenToUse: source.whenToUse,
    whenNotToUse: source.whenNotToUse,
    status: "draft",
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
  for (const file of files) {
    if (file.name === PRIMARY_SKILL_FILE_NAME) continue;
    await createFile(ctx, created.skill.slug, {
      name: file.name,
      body: file.body,
    });
  }
  return { skill, primaryFile: created.primaryFile };
}

// ─── Insights ───────────────────────────────────────────────────────

/**
 * Agent read activity from mcp_events (workspace-scoped via the
 * workspace_id column added in the phase-3 migration; rows logged
 * before that migration have NULL workspace_id and are excluded).
 * Matches both the skill read and its file reads.
 */
export async function getSkillUsage(
  ctx: SkillContext,
  slug: string
): Promise<SkillUsage> {
  const skill = await getSkillBySlug(ctx, slug);
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const exact = `GET /api/skills/${skill.slug}`;
  const prefix = `GET /api/skills/${skill.slug}/%`;
  const scoped = () =>
    db
      .from("mcp_events")
      .select("created_at", { count: "exact" })
      .eq("workspace_id", ctx.workspaceId)
      .or(`endpoint.eq.${exact},endpoint.like.${prefix}`);
  const [countRes, lastRes] = await Promise.all([
    scoped().gte("created_at", since).limit(1),
    scoped().order("created_at", { ascending: false }).limit(1),
  ]);
  if (countRes.error) throw countRes.error;
  if (lastRes.error) throw lastRes.error;
  const last = (lastRes.data as Array<{ created_at: string }> | null)?.[0];
  return {
    count30d: countRes.count ?? 0,
    lastUsedAt: last?.created_at ?? null,
  };
}

/** Clusters + workflows this skill is attached to. */
export async function getSkillUsedBy(ctx: SkillContext, slug: string) {
  const skill = await getSkillBySlug(ctx, slug);
  return repo.listSkillUsedBy(ctx.workspaceId, skill.id);
}

// ─── History (versions + audit timeline) ───────────────────────────

/** Version metadata + events for the history panel, newest first. */
export async function getSkillHistory(
  ctx: SkillContext,
  slug: string,
  opts: { limit?: number } = {}
) {
  const skill = await getSkillBySlug(ctx, slug);
  return history.listHistory(ctx, skill.id, opts);
}

/** One snapshot with its full body (for the diff view). */
export async function getFileVersion(ctx: SkillContext, versionId: string) {
  const version = await history.findVersionWithBody(ctx, versionId);
  if (!version) {
    throw new SkillFileNotFoundError("(version)", versionId);
  }
  // Visibility check rides on the parent skill: if the caller can't see
  // the skill, the version doesn't exist for them either.
  const skill = await repo.findSkillById(ctx.workspaceId, version.skillId);
  if (!skill || !canSeeSkill(ctx, skill, await grantsForSkills(ctx, [skill]))) {
    throw new SkillFileNotFoundError("(version)", versionId);
  }
  return version;
}

/**
 * Roll a file back to a snapshot. Restore never rewrites history: it
 * writes the old body as a NEW save (minting a fresh version) and logs
 * a `file.rolled_back` event. No-ops when the file already matches.
 */
export async function restoreFileVersion(
  ctx: SkillContext,
  versionId: string
): Promise<SkillFile> {
  const version = await getFileVersion(ctx, versionId);
  const skill = await repo.findSkillById(ctx.workspaceId, version.skillId);
  if (!skill) throw new SkillNotFoundError(version.skillId);
  await assertAgentWriteAllowed(ctx, skill);
  // findFileById excludes trashed files — restoring into a trashed file
  // 404s (restore the file from trash first).
  const file = await repo.findFileById(version.fileId);
  if (!file) throw new SkillFileNotFoundError(skill.slug, version.fileName);
  if (file.body === version.body) return file;
  const saved = await repo.updateFileRow(file.id, {
    body: version.body,
    lastEditedBy: ctx.userId,
    lastEditedSource: ctx.source,
  });
  await history.recordVersion({
    ctx,
    skillId: skill.id,
    fileId: saved.id,
    fileName: saved.name,
    body: saved.body,
  });
  await history.recordEvent({
    ctx,
    skillId: skill.id,
    type: "file.rolled_back",
    fileId: saved.id,
    detail: { versionId, fileName: version.fileName },
  });
  return saved;
}

// ─── Seeding ────────────────────────────────────────────────────────

export async function seedWorkspace(
  ctx: SkillContext
): Promise<{ skillsCreated: number }> {
  const existing = await repo.listSkillsForWorkspace(ctx.workspaceId);
  if (existing.length > 0) return { skillsCreated: 0 };

  let skillsCreated = 0;
  for (const fixture of buildSeedSkills()) {
    const skill = await repo.insertSkill({
      workspaceId: ctx.workspaceId,
      slug: fixture.slug,
      name: fixture.name,
      description: fixture.description,
      whenToUse: fixture.whenToUse,
      whenNotToUse: fixture.whenNotToUse,
      connectors: fixture.connectors,
      status: fixture.status,
      // Seeded fixtures are starter content — public so every member
      // can see and run them. Owner-explicit `createSkill` defaults
      // to private; only the seed path overrides.
      visibility: "public",
      createdBy: ctx.userId,
      source: "user",
    });
    await repo.insertFile({
      workspaceId: ctx.workspaceId,
      skillId: skill.id,
      name: PRIMARY_SKILL_FILE_NAME,
      body: fixture.body,
      position: 0,
      createdBy: ctx.userId,
      source: "user",
    });
    skillsCreated += 1;
  }
  return { skillsCreated };
}

// ─── Internal helpers ───────────────────────────────────────────────

function deriveSlug(input: string, taken: string[]): string {
  return slugify(input, "skill", taken);
}

async function fetchWorkspaceCreatedAt(
  workspaceId: string
): Promise<Date | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspaces")
    .select("created_at")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return new Date((data as { created_at: string }).created_at);
}
