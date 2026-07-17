import "server-only";
import { GUIDE_ENTRY_KEYS } from "@/features/knowledge/server/seed";
import { SEED_SKILL_SLUGS } from "@/features/skills/server/seed";

/**
 * Seed workflow for a brand-new workspace: "Workspace upkeep" — a real
 * branching process that walks the maintenance loop the Dopl Guide
 * describes. Its steps read the seeded knowledge entries and run the
 * seeded skills, so a fresh workspace ships a workflow that's wired, not
 * empty.
 *
 * Pure content — steps reference knowledge entries by key and skills by
 * slug; `service-seed.ts` resolves those to real ids and builds the graph
 * via the ordinary `setGraph` authoring path.
 */

export const WORKSPACE_UPKEEP_NAME = "Workspace upkeep";

export interface WorkflowSeedStep {
  ref: string;
  title: string;
  description: string;
  /** Guide entries this step should read (resolved to `reads`). */
  readEntryKeys: string[];
  /** Seeded skills this step should run (resolved to `actions`). */
  actionSkillSlugs: string[];
  nextInstructions: string;
}

export interface WorkflowSeedEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface WorkflowSeed {
  name: string;
  description: string;
  steps: WorkflowSeedStep[];
  edges: WorkflowSeedEdge[];
}

export function buildWorkflowSeed(): WorkflowSeed {
  return {
    name: WORKSPACE_UPKEEP_NAME,
    description:
      "Weekly loop that keeps the workspace current: review recent sessions, file what's durable, update the graph, and archive.",
    steps: [
      {
        ref: "review-chats",
        title: "Review recent chats",
        description:
          "Read the recent session archive (dopl_chats op=list) and skim for anything durable — decisions, gotchas, references — that isn't yet filed.",
        readEntryKeys: [GUIDE_ENTRY_KEYS.sessionRitual],
        actionSkillSlugs: [],
        nextInstructions:
          "If any session surfaced a reusable learning that isn't in Knowledge yet, take the 'new learnings' branch. Otherwise skip filing.",
      },
      {
        ref: "file-learnings",
        title: "File new learnings",
        description:
          "For each durable learning, add or update a knowledge entry. Don't duplicate — search first, then write.",
        readEntryKeys: [GUIDE_ENTRY_KEYS.knowledgeVsSkills],
        actionSkillSlugs: [SEED_SKILL_SLUGS.fileKnowledge],
        nextInstructions: "Once every learning is filed, continue to updating the ontology.",
      },
      {
        ref: "skip-filing",
        title: "Nothing new to file",
        description:
          "No new durable learnings this cycle — record that you checked and move on.",
        readEntryKeys: [],
        actionSkillSlugs: [],
        nextInstructions: "Continue to updating the ontology.",
      },
      {
        ref: "update-ontology",
        title: "Update ontology objects",
        description:
          "Reconcile the graph with reality: update any object whose attributes or relationships have drifted (a shipped project, a changed owner).",
        readEntryKeys: [GUIDE_ENTRY_KEYS.buildingOntology],
        actionSkillSlugs: [SEED_SKILL_SLUGS.authorOntology],
        nextInstructions: "When the graph reflects reality, archive the session.",
      },
      {
        ref: "export-session",
        title: "Export the session",
        description:
          "Archive this upkeep session so the trail is durable — summary per message, deliverables checked off, learnings captured.",
        readEntryKeys: [],
        actionSkillSlugs: [SEED_SKILL_SLUGS.archiveSession],
        nextInstructions: "Done. The workspace is current for the next session.",
      },
    ],
    edges: [
      { from: "review-chats", to: "file-learnings", condition: "New learnings surfaced that aren't filed yet" },
      { from: "review-chats", to: "skip-filing", condition: "No new durable learnings this cycle" },
      { from: "file-learnings", to: "update-ontology" },
      { from: "skip-filing", to: "update-ontology" },
      { from: "update-ontology", to: "export-session" },
    ],
  };
}
