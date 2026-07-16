import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isUuid } from "@/shared/lib/id/uuid";
import type {
  ResolvedSkill,
  ResolvedSkillReference,
  Skill,
  SkillContext,
  SkillFile,
  WorkspaceKbSummary,
} from "../types";
import { parseSkillBody, type SkillRef } from "../skill-body";
import { SkillNotFoundError } from "./errors";
import * as repo from "./repository";
import {
  canSeeSkill,
  grantsForSkills,
  withGrantSet,
} from "./service-shared";
import { seedWorkspace } from "./service-seed";

/**
 * Skill reads. `getSkillBySlug` is the foundational visibility-checked
 * lookup every other skill op funnels through (slug OR stable uuid ref).
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

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
  slug: string
): Promise<SkillFile[]> {
  const skill = await getSkillBySlug(ctx, slug);
  const file = await repo.readSkillBody(ctx.workspaceId, skill.id);
  return file ? [file] : [];
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
  const file = await repo.readSkillBody(ctx.workspaceId, skill.id);
  const files = file ? [file] : [];
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

export async function listWorkspaceKnowledgeBases(
  ctx: SkillContext
): Promise<WorkspaceKbSummary[]> {
  return repo.listWorkspaceKnowledgeBases(ctx.workspaceId);
}

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
