import "server-only";
import type { KnowledgeContext } from "@/features/knowledge/types";
import type { SkillContext } from "@/features/skills/types";
import { DOPL_GUIDE_SLUG } from "@/features/knowledge/server/seed";
import { findBaseBySlug } from "@/features/knowledge/server/repository";
import { seedWorkspace as seedKnowledge } from "@/features/knowledge/server/service-seed";
import { seedWorkspace as seedSkills } from "@/features/skills/server/service-seed";
import { seedWorkspace as seedOntology } from "@/features/ontology/server/service-seed";
import { seedWorkspace as seedWorkflow } from "@/features/workflows/server/service-seed";
import { seedWorkspace as seedChat } from "@/features/chats/server/service-seed";

/**
 * New-workspace seeding orchestrator. When a workspace is first created,
 * this populates it with the "how to use Dopl" starter corpus across
 * every surface: a Knowledge guide, four Skills, an Ontology playbook, a
 * Workflow, and one sample Chat — all cross-referenced by real ids.
 *
 * Contract:
 *   - Single entry point: `seedNewWorkspace(workspaceId, userId)`.
 *   - Idempotent: returns early if the Dopl Guide KB already exists.
 *   - Dependency-ordered: knowledge + skills first (their ids feed the
 *     ontology, workflow, and cross-refs), then ontology → workflow → chat.
 *   - Best-effort: each surface is wrapped so one failure logs and the
 *     rest still seed. This function never throws — workspace creation
 *     must never be blocked by a seed hiccup.
 *
 * Only called from the actual workspace-CREATION path (see
 * `service.ensureDefaultWorkspace` + `service.createWorkspaceForUser`);
 * pre-existing workspaces are never seeded.
 */

export interface SeedNewWorkspaceResult {
  seeded: boolean;
  knowledgeBases: number;
  skills: number;
  objects: number;
  relationships: number;
  workflowSteps: number;
  chats: number;
}

const EMPTY_RESULT: SeedNewWorkspaceResult = {
  seeded: false,
  knowledgeBases: 0,
  skills: 0,
  objects: 0,
  relationships: 0,
  workflowSteps: 0,
  chats: 0,
};

function logSeedFailure(surface: string, err: unknown): void {
  console.error(`[seed-workspace] ${surface} seeding failed:`, err);
}

export async function seedNewWorkspace(
  workspaceId: string,
  userId: string
): Promise<SeedNewWorkspaceResult> {
  // Idempotency: the Dopl Guide is the anchor; if it exists, this
  // workspace was already seeded (or the owner recreated it deliberately).
  try {
    const existing = await findBaseBySlug(workspaceId, DOPL_GUIDE_SLUG);
    if (existing) return EMPTY_RESULT;
  } catch (err) {
    // A failed existence check shouldn't wedge creation — but we also
    // can't safely proceed to insert (risk of duplicates), so bail.
    logSeedFailure("idempotency-check", err);
    return EMPTY_RESULT;
  }

  const result: SeedNewWorkspaceResult = { ...EMPTY_RESULT, seeded: true };

  // 1. Knowledge — the cross-reference anchor. Entry ids feed everything.
  let entryIdByKey: Record<string, string> = {};
  let kbBaseId: string | null = null;
  try {
    const ctx: KnowledgeContext = {
      workspaceId,
      userId,
      source: "user",
      role: "owner",
      apiKeyWorkspaceId: null,
    };
    const res = await seedKnowledge(ctx);
    result.knowledgeBases = res.basesCreated;
    if (res.guide) {
      kbBaseId = res.guide.baseId;
      entryIdByKey = Object.fromEntries(
        Object.entries(res.guide.entryIdByKey).map(([k, v]) => [k, v.id])
      );
    }
  } catch (err) {
    logSeedFailure("knowledge", err);
  }

  // 2. Skills — ids feed the ontology + workflow.
  let skillIdBySlug: Record<string, string> = {};
  try {
    const ctx: SkillContext = {
      workspaceId,
      userId,
      source: "user",
      role: "owner",
      apiKeyWorkspaceId: null,
    };
    const res = await seedSkills(ctx);
    result.skills = res.skillsCreated;
    skillIdBySlug = Object.fromEntries(
      Object.entries(res.skillIdBySlug).map(([slug, v]) => [slug, v.id])
    );
  } catch (err) {
    logSeedFailure("skills", err);
  }

  // 3. Ontology — objects whose attributes point at the seeded entries/skills.
  try {
    const res = await seedOntology(
      { workspaceId, userId },
      { entryIdByKey, skillIdBySlug }
    );
    result.objects = res.objectsCreated;
    result.relationships = res.relationshipsCreated;
  } catch (err) {
    logSeedFailure("ontology", err);
  }

  // 4. Workflow — needs the KB base id + entry ids + skill ids. Skipped
  //    if knowledge seeding didn't produce a guide base to read from.
  if (kbBaseId) {
    try {
      const res = await seedWorkflow(workspaceId, userId, {
        kbBaseId,
        entryIdByKey,
        skillIdBySlug,
      });
      result.workflowSteps = res.stepCount;
    } catch (err) {
      logSeedFailure("workflow", err);
    }
  }

  // 5. Chat — self-contained sample export.
  try {
    await seedChat(workspaceId, userId);
    result.chats = 1;
  } catch (err) {
    logSeedFailure("chat", err);
  }

  return result;
}
