/**
 * Domain types for the skills feature.
 *
 * Skills are workspace-scoped procedural prompts surfaced to a
 * connected agent over MCP. The body is markdown with `dopl://` link
 * references that the renderer / resolver pick up via `parseSkillBody`.
 *
 * Mirrors the camelCase convention from features/knowledge — the
 * snake_case row shape lives in `server/dto.ts`.
 */

import type { SourceProvider, SourceConnection } from "@/features/knowledge/source-types";

export type SkillStatus = "active" | "draft";

export type SkillWriteSource = "user" | "agent";

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

export interface SkillConnector extends SourceConnection {
  /** Human-readable note about why this skill calls this connector. */
  usedFor: string;
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

export const PRIMARY_SKILL_FILE_NAME = "SKILL.md";

/**
 * Lightweight workspace KB row, used by the detail-page picker. Owns
 * its own type rather than importing from features/knowledge so skills
 * doesn't take a cross-feature dependency.
 */
export interface WorkspaceKbSummary {
  slug: string;
  name: string;
}

/**
 * Cheap metadata projection used by `skill_list` and the library-card
 * row before expand. Skips the body to keep the index payload small.
 */
export interface SkillSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string | null;
  status: SkillStatus;
  agentWriteEnabled: boolean;
  totalInvocations: number;
  updatedAt: string;
}

/**
 * Resolved view returned by `resolveSkillBody` — the markdown body plus
 * an availability check on every reference. Consumed by `skill_get` and
 * by the detail page when surfacing broken-ref badges.
 */
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

/**
 * Request-scoped context. Built from auth metadata at the route layer.
 * Source comes from the auth wrapper — API-key callers are agents,
 * session callers are users. Only enforced in service.ts when the
 * skill's `agentWriteEnabled` flag matters.
 */
export interface SkillContext {
  workspaceId: string;
  userId: string;
  source: SkillWriteSource;
}

export type { SourceProvider };
