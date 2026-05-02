import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { slugify } from "@/shared/lib/slug/slugify";
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
  apiKeyId?: string | null;
}

export function buildSkillContext(auth: AuthLike): SkillContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.apiKeyId ? "agent" : "user",
  };
}

// ─── Skill reads ────────────────────────────────────────────────────

export async function listSkills(ctx: SkillContext): Promise<Skill[]> {
  const existing = await repo.listSkillsForWorkspace(ctx.workspaceId);
  if (existing.length > 0) return existing;
  const workspaceCreatedAt = await fetchWorkspaceCreatedAt(ctx.workspaceId);
  if (
    workspaceCreatedAt !== null &&
    Date.now() - workspaceCreatedAt.getTime() < TWENTY_FOUR_HOURS_MS
  ) {
    await seedWorkspace(ctx);
    return repo.listSkillsForWorkspace(ctx.workspaceId);
  }
  return existing;
}

export async function getSkillBySlug(
  ctx: SkillContext,
  slug: string
): Promise<Skill> {
  const skill = await repo.findSkillBySlug(ctx.workspaceId, slug);
  if (!skill) throw new SkillNotFoundError(slug);
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
        agentWriteEnabled: input.agentWriteEnabled ?? false,
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
  patch: SkillUpdateInput
): Promise<Skill> {
  const skill = await getSkillBySlug(ctx, slug);
  // Agents can't flip the toggle itself, regardless of current state.
  if (ctx.source === "agent" && patch.agentWriteEnabled !== undefined) {
    throw new SkillAgentWriteDisabledError(slug);
  }
  if (ctx.source === "agent" && !skill.agentWriteEnabled) {
    throw new SkillAgentWriteDisabledError(slug);
  }
  if (patch.slug && patch.slug !== skill.slug) {
    const taken = await repo.listSlugsForWorkspace(ctx.workspaceId);
    if (taken.includes(patch.slug)) throw new SkillSlugConflictError(patch.slug);
  }
  try {
    return await repo.updateSkillRow(skill.id, {
      name: patch.name,
      description: patch.description,
      whenToUse: patch.whenToUse,
      whenNotToUse: patch.whenNotToUse,
      slug: patch.slug,
      status: patch.status,
      agentWriteEnabled: patch.agentWriteEnabled,
      lastEditedBy: ctx.userId,
      lastEditedSource: ctx.source,
    });
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
  if (ctx.source === "agent" && !skill.agentWriteEnabled) {
    throw new SkillAgentWriteDisabledError(slug);
  }
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
  input: SkillFileWriteInput
): Promise<SkillFile> {
  const skill = await getSkillBySlug(ctx, slug);
  await assertAgentWriteAllowed(ctx, skill);
  const file = await repo.findFileByName(skill.id, fileName);
  if (!file) throw new SkillFileNotFoundError(slug, fileName);
  return repo.updateFileRow(file.id, {
    body: input.body,
    lastEditedBy: ctx.userId,
    lastEditedSource: ctx.source,
  });
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

export async function assertAgentWriteAllowed(
  ctx: SkillContext,
  skill: Skill
): Promise<void> {
  if (ctx.source !== "agent") return;
  if (!skill.agentWriteEnabled) {
    throw new SkillAgentWriteDisabledError(skill.slug);
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
