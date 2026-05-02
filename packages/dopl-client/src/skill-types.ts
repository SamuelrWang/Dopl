/**
 * Domain types for skills exposed over the Dopl API.
 *
 * Mirrors `src/features/skills/types.ts` in the main app — kept in
 * sync by hand. If they ever drift, the API responses are the source
 * of truth.
 */

export type SkillStatus = "active" | "draft";
export type SkillWriteSource = "user" | "agent";

export type SkillProvider =
  | "slack"
  | "google-drive"
  | "gmail"
  | "notion"
  | "github";

export interface SkillConnector {
  provider: SkillProvider;
  name: string;
  status: "connected" | "available";
  meta?: string;
  usedFor: string;
}

export interface SkillExample {
  id: string;
  title: string;
  input: string;
  output: string;
}

export interface SkillRun {
  id: string;
  invokedBy: string;
  invokedAt: string;
  durationMs: number;
  status: "success" | "error";
  summary: string;
}

export interface Skill {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string | null;
  connectors: SkillConnector[];
  examples: SkillExample[];
  recentRuns: SkillRun[];
  totalInvocations: number;
  status: SkillStatus;
  agentWriteEnabled: boolean;
  createdBy: string | null;
  lastEditedBy: string | null;
  lastEditedSource: SkillWriteSource;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * One file inside a skill. The canonical entry point is named
 * `SKILL.md` and holds the procedure body. Supplementary files
 * (e.g. `examples.md`) live in the same flat namespace.
 */
export interface SkillFile {
  id: string;
  workspaceId: string;
  skillId: string;
  name: string;
  body: string;
  position: number;
  createdBy: string | null;
  lastEditedBy: string | null;
  lastEditedSource: SkillWriteSource;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ResolvedSkillReference {
  kind: "kb" | "connector";
  slug?: string;
  provider?: string;
  field?: string;
  label: string;
  available: boolean;
}

export interface ResolvedSkill {
  skill: Skill;
  files: SkillFile[];
  references: ResolvedSkillReference[];
}
