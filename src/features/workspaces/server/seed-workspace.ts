import "server-only";
import type { KnowledgeContext } from "@/features/knowledge/types";
import type { SkillContext } from "@/features/skills/types";
import { DOPL_GUIDE_SLUG } from "@/features/knowledge/server/seed";
import { findBaseBySlug } from "@/features/knowledge/server/repository";
import { seedWorkspace as seedKnowledge } from "@/features/knowledge/server/service-seed";
import { seedWorkspace as seedSkills } from "@/features/skills/server/service-seed";
import { seedWorkspace as seedOntology } from "@/features/ontology/server/service-seed";
import { seedWorkspace as seedChat } from "@/features/chats/server/service-seed";

/**
 * New-workspace seeding orchestrator: the "how to use Dopl" starter corpus
 * (Knowledge guide, three Skills, Ontology playbook, one sample Chat), all
 * cross-referenced by real ids.
 *
 * Contract:
 *   - Single entry point: `seedNewWorkspace(workspaceId, userId)`.
 *   - Idempotent: returns early if the Dopl Guide KB already exists.
 *   - ⚠ Dependency-ordered: knowledge + skills first (their entry keys and
 *     skill slugs feed the ontology cross-refs), then ontology → chat.
 *   - ⚠ Best-effort and NEVER throws — workspace creation must not be blocked
 *     by a seed hiccup.
 *
 * Only called from the workspace-CREATION path
 * (`service.ensurePersonalContainer` / `service.createWorkspaceForUser`).
 */

export interface SeedNewWorkspaceResult {
  seeded: boolean;
  knowledgeBases: number;
  skills: number;
  objects: number;
  relationships: number;
  chats: number;
}

const EMPTY_RESULT: SeedNewWorkspaceResult = {
  seeded: false,
  knowledgeBases: 0,
  skills: 0,
  objects: 0,
  relationships: 0,
  chats: 0,
};

function logSeedFailure(surface: string, err: unknown): void {
  console.error(`[seed-workspace] ${surface} seeding failed:`, err);
}

export async function seedNewWorkspace(
  workspaceId: string,
  userId: string
): Promise<SeedNewWorkspaceResult> {
  // Idempotency anchor: the Dopl Guide existing means already seeded.
  try {
    const existing = await findBaseBySlug(workspaceId, DOPL_GUIDE_SLUG);
    if (existing) return EMPTY_RESULT;
  } catch (err) {
    // Failed existence check must not wedge creation, but inserting risks
    // duplicates — so bail.
    logSeedFailure("idempotency-check", err);
    return EMPTY_RESULT;
  }

  const result: SeedNewWorkspaceResult = { ...EMPTY_RESULT, seeded: true };

  // 1. Knowledge — cross-reference anchor; entry ids feed everything.
  let entryIdByKey: Record<string, string> = {};
  try {
    const ctx: KnowledgeContext = {
      workspaceId,
      userId,
      source: "user",
      role: "owner",
      apiKeyWorkspaceId: null,
      credentialSubjectUserId: userId,
    };
    const res = await seedKnowledge(ctx);
    result.knowledgeBases = res.basesCreated;
    if (res.guide) {
      entryIdByKey = Object.fromEntries(
        Object.entries(res.guide.entryIdByKey).map(([k, v]) => [k, v.id])
      );
    }
  } catch (err) {
    logSeedFailure("knowledge", err);
  }

  // 2. Skills — ids feed the ontology cross-references.
  let skillIdBySlug: Record<string, string> = {};
  try {
    const ctx: SkillContext = {
      workspaceId,
      userId,
      source: "user",
      role: "owner",
      apiKeyWorkspaceId: null,
      credentialSubjectUserId: userId,
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

  // 4. Chat — self-contained sample export.
  try {
    await seedChat(workspaceId, userId);
    result.chats = 1;
  } catch (err) {
    logSeedFailure("chat", err);
  }

  return result;
}
