import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isUuid } from "@/shared/lib/id/uuid";
import {
  readResourceById,
  type ContainerRead,
} from "@/shared/tenancy/read-resource";
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

/** Skill reads. `getSkillBySlug` is the visibility-checked lookup every other
 *  skill op funnels through (slug OR stable uuid ref). */

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
  // ⚠ Seed only when the workspace has NO skills at all, not when the CALLER
  // sees zero. Same rule as `listBases`.
  if (all.length > 0) return visible;
  // DEMO BYPASS: auto-seed disabled. Mirrors the guard in
  // src/features/knowledge/server/service.ts `listBases`. Set false to restore
  // the onboarding seed below.
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
 * Resolve by slug OR stable UUID id — renames change the slug, so agents need an
 * immutable handle. Every read/write op funnels through here, so id acceptance
 * applies uniformly.
 *
 * 🔒 ⚠ **KEYED TO `ctx.workspaceId`, AND IT MUST STAY THAT WAY — IT IS THE WRITE
 * GATE.** `service-writes.ts`, `service-body.ts`, `service-history.ts` and
 * `service-insights.ts` all funnel through it, so the tenancy it reads in is the
 * tenancy those writes land in. The ID-RESOLVING read is {@link readSkillByRef};
 * the split is A12's, restated for this feature (INVARIANTS §T35).
 */
export async function getSkillBySlug(
  ctx: SkillContext,
  ref: string
): Promise<Skill> {
  const skill = await loadVisibleSkill(ctx, ref);
  if (!skill) throw new SkillNotFoundError(ref);
  return skill;
}

/** The read every skill door shares: one row, in ONE named container, through
 *  the matrix and the grant set. `null` = not visible, which the callers turn
 *  into the single 404. */
async function loadVisibleSkill(
  ctx: SkillContext,
  ref: string
): Promise<Skill | null> {
  const skill = isUuid(ref)
    ? await repo.findSkillById(ctx.workspaceId, ref)
    : await repo.findSkillBySlug(ctx.workspaceId, ref);
  if (!skill) return null;
  const grants = await grantsForSkills(ctx, [skill]);
  if (!canSeeSkill(ctx, skill, grants)) return null;
  return withGrantSet(ctx, skill, grants);
}

/**
 * 🔒 **THE ID-RESOLVING READ (B2)** — the same row, the same matrix, the same
 * 404, but a UUID says which container to apply them in.
 *
 * ⚠ **ONLY A UUID FOLLOWS, AND A SLUG DELIBERATELY DOES NOT.** `skills` is
 * unique on `(workspace_id, slug)` — per CONTAINER, not globally — so a slug can
 * legitimately name a different skill in each container the caller belongs to,
 * and every tie-break ("mine wins", "newest wins") silently resolves one the
 * caller did not choose. An id is a primary key and has no such question, which
 * is exactly why `workspace=` is redundant on it and not on a slug.
 *
 * ⚠ It returns the CONTEXT the read succeeded in: a skill's body, its files and
 * its KB references are three more workspace-keyed reads, and composing them
 * against the original context would read the row from one container and its
 * contents from another.
 */
async function readSkillByRef(
  ctx: SkillContext,
  ref: string
): Promise<ContainerRead<SkillContext, Skill> | null> {
  if (!isUuid(ref)) {
    const value = await loadVisibleSkill(ctx, ref);
    return value ? { ctx, value } : null;
  }
  return readResourceById(ctx, "skill", ref, loadVisibleSkill);
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
 * Skill record + files + per-reference availability. Pointer-with-hint:
 * ⚠ KB content is never inlined — the agent calls `kb_read_file` itself.
 *
 * 🔒 **THE READ DOOR, SO IT FOLLOWS THE ID** ({@link readSkillByRef}) — and
 * every read under it runs in the container the id named, `found`, never
 * `ctx`.
 */
export async function resolveSkillBody(
  ctx: SkillContext,
  ref: string
): Promise<ResolvedSkill> {
  const hit = await readSkillByRef(ctx, ref);
  if (!hit) throw new SkillNotFoundError(ref);
  const { ctx: found, value: skill } = hit;
  const file = await repo.readSkillBody(found.workspaceId, skill.id);
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
  const references = await Promise.all(
    refs.map((r) => resolveReference(found, r))
  );
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
