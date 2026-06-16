import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { slugify } from "@/shared/lib/slug/slugify";
import { HttpError } from "@/shared/lib/http-error";
import { meetsMinRole } from "@/features/workspaces/types";
import { findMembership } from "@/features/workspaces/server/repository";
import { PRIMARY_SKILL_FILE_NAME } from "../types";
import type {
  ResolvedSkill,
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
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
}

export function buildSkillContext(auth: AuthLike): SkillContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.agentTokenId ? "agent" : "user",
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
  };
}

/**
 * M-10 visibility filter for skills — see `canSeeBase` in
 * features/knowledge/server/service.ts for the matching rationale.
 *   - Public: always.
 *   - Private via session or personal API key: owner-only.
 *   - Private via workspace-scoped API key: never.
 */
function canSeeSkill(ctx: SkillContext, skill: Skill): boolean {
  if (skill.visibility === "public") return true;
  if (ctx.apiKeyWorkspaceId) return false;
  return skill.createdBy === ctx.userId;
}

// ─── Skill reads ────────────────────────────────────────────────────

export async function listSkills(ctx: SkillContext): Promise<Skill[]> {
  const all = await repo.listSkillsForWorkspace(ctx.workspaceId);
  const visible = all.filter((s) => canSeeSkill(ctx, s));
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
    const seeded = await repo.listSkillsForWorkspace(ctx.workspaceId);
    return seeded.filter((s) => canSeeSkill(ctx, s));
  }
  return visible;
}

export async function getSkillBySlug(
  ctx: SkillContext,
  slug: string
): Promise<Skill> {
  const skill = await repo.findSkillBySlug(ctx.workspaceId, slug);
  if (!skill) throw new SkillNotFoundError(slug);
  if (!canSeeSkill(ctx, skill)) throw new SkillNotFoundError(slug);
  return skill;
}

export async function getSkillByPublicId(
  ctx: SkillContext,
  publicId: string
): Promise<Skill> {
  const skill = await repo.findSkillByPublicId(ctx.workspaceId, publicId);
  if (!skill) throw new SkillNotFoundError(publicId);
  if (!canSeeSkill(ctx, skill)) throw new SkillNotFoundError(publicId);
  return skill;
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
  // Agents can't flip the toggle itself, regardless of current state.
  if (ctx.source === "agent" && patch.agentWriteEnabled !== undefined) {
    throw new SkillAgentWriteDisabledError(slug);
  }
  // M-10: visibility flips are owner-only and one-way (private →
  // public). Schema already restricts to "public"; here we check the
  // prior state + caller is the owner. Agents can never publish.
  let effectiveVisibility = patch.visibility;
  if (effectiveVisibility !== undefined) {
    if (ctx.source === "agent") {
      throw new SkillAgentWriteDisabledError(slug);
    }
    if (skill.createdBy !== ctx.userId) {
      throw new SkillNotFoundError(slug);
    }
    if (skill.visibility === "public") {
      // Already public — no-op (UI may double-submit).
      effectiveVisibility = undefined;
    }
  }
  await assertAgentWriteAllowed(ctx, skill);
  if (expectedUpdatedAt && skill.updatedAt !== expectedUpdatedAt) {
    throw new SkillStaleVersionError(expectedUpdatedAt, skill.updatedAt);
  }
  if (patch.slug && patch.slug !== skill.slug) {
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
        agentWriteEnabled: patch.agentWriteEnabled,
        visibility: effectiveVisibility,
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
    return saved;
  } catch (err) {
    if (repo.pgErrorCode(err) === "23505" && patch.slug) {
      throw new SkillSlugConflictError(patch.slug);
    }
    throw err;
  }
}

export async function deleteSkill(
  ctx: SkillContext,
  slug: string
): Promise<void> {
  const skill = await getSkillBySlug(ctx, slug);
  await assertAgentWriteAllowed(ctx, skill);
  await repo.markSkillDeleted(skill.id);
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
    throw new SkillFileConflictError(input.name);
  }
  const existing = await repo.findFileByName(skill.id, input.name);
  if (existing) throw new SkillFileConflictError(input.name);
  const siblings = await repo.listFilesForSkill(skill.id, { includeBody: false });
  const nextPos =
    siblings.length === 0 ? 1 : Math.max(...siblings.map((f) => f.position)) + 1;
  try {
    return await repo.insertFile({
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
    return await repo.updateFileRow(file.id, {
      name: input.name,
      lastEditedBy: ctx.userId,
      lastEditedSource: ctx.source,
    });
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
}

// ─── Trash ──────────────────────────────────────────────────────────

/**
 * Returns every soft-deleted skill and skill_file row in the workspace,
 * sorted newest-deletion-first. Used by the trash modal. Mirrors
 * `listTrash` in the knowledge service.
 */
export async function listTrash(
  ctx: SkillContext
): Promise<repo.DeletedSkillRows> {
  return repo.listDeletedForWorkspace(ctx.workspaceId);
}

export async function restoreSkill(
  ctx: SkillContext,
  id: string
): Promise<Skill> {
  const skill = await repo.findSkillById(ctx.workspaceId, id, true);
  if (!skill) throw new SkillNotFoundError(id);
  await assertAgentWriteAllowed(ctx, skill);
  return repo.restoreSkillRow(id);
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
  await assertAgentWriteAllowed(ctx, skill);
  return repo.restoreFileRow(id);
}

/**
 * Hard-delete every soft-deleted skill / file in the workspace older
 * than `beforeIso`. Idempotent. Agents are blocked — purge is a
 * destructive admin-only action with no UI undo.
 */
export async function purgeTrashOlderThan(
  ctx: SkillContext,
  beforeIso: string
): Promise<{ deleted: number }> {
  if (ctx.source === "agent") {
    throw new SkillAgentWriteDisabledError("trash");
  }
  const counts = await repo.hardDeleteForWorkspaceOlderThan(
    ctx.workspaceId,
    beforeIso
  );
  return { deleted: counts.skills + counts.files };
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
 * Gate for agent-origin skill writes. The per-(member, skill) override
 * matrix is gone (teams scope knowledge bases and workflows, not
 * skills), so the rule collapses to the role default: member+ can
 * write, viewer cannot.
 *
 * `SkillAgentWriteDisabledError` is still thrown when an agent tries
 * to flip `agentWriteEnabled` itself in updateSkill — that path
 * doesn't call here.
 */
export async function assertAgentWriteAllowed(
  ctx: SkillContext,
  _skill: Skill
): Promise<void> {
  if (ctx.source !== "agent") return;
  const membership = await findMembership(ctx.workspaceId, ctx.userId);
  if (!membership || membership.status !== "active") {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }
  if (!meetsMinRole(membership.role, "member")) {
    throw new HttpError(
      403,
      "RESOURCE_ACCESS_DENIED",
      "Your access on this skill is read-only"
    );
  }
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
      examples: fixture.examples,
      recentRuns: fixture.recentRuns,
      totalInvocations: fixture.totalInvocations,
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
