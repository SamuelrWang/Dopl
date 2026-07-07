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

import type { SourceProvider, SourceConnection } from "@/shared/lib/source-types";

export type SkillStatus = "active" | "draft";

export type SkillWriteSource = "user" | "agent";

export interface SkillConnector extends SourceConnection {
  /** Human-readable note about why this skill calls this connector. */
  usedFor: string;
}

/**
 * Per-resource visibility (M-10). Mirrors the KB type — see
 * src/features/knowledge/types.ts for the full doc. Once-public-stays-
 * public: no path from `'public'` back to `'private'`.
 */
export type Visibility = "public" | "private";

export interface Skill {
  id: string;
  workspaceId: string;
  slug: string;
  publicId: string;
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string | null;
  connectors: SkillConnector[];
  status: SkillStatus;
  agentWriteEnabled: boolean;
  visibility: Visibility;
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

/**
 * One append-only snapshot of a file body, taken after every content
 * save (user or agent). Metadata shape — the body itself is fetched
 * separately by version id (it can be large; lists never carry it).
 * `fileName` is denormalized at snapshot time so history stays legible
 * across renames.
 */
export interface SkillFileVersion {
  id: string;
  skillId: string;
  fileId: string;
  fileName: string;
  authorId: string | null;
  source: SkillWriteSource;
  createdAt: string;
  bodyBytes: number;
}

export type SkillEventType =
  | "skill.created"
  | "skill.updated"
  | "skill.published"
  | "skill.trashed"
  | "skill.restored"
  | "file.created"
  | "file.renamed"
  | "file.trashed"
  | "file.restored"
  | "file.rolled_back";

/**
 * One structural change in a skill's audit timeline. Content edits are
 * NOT events — they're `SkillFileVersion` rows; the history UI merges
 * both streams by `createdAt`.
 */
export interface SkillEvent {
  id: string;
  skillId: string;
  fileId: string | null;
  type: SkillEventType;
  /** Event-specific payload, e.g. `{from, to}` for renames or `{fields}` for metadata updates. */
  detail: Record<string, unknown>;
  authorId: string | null;
  source: SkillWriteSource;
  createdAt: string;
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
  publicId: string;
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string | null;
  status: SkillStatus;
  agentWriteEnabled: boolean;
  visibility: Visibility;
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
  /**
   * Same semantics as `KnowledgeContext.apiKeyWorkspaceId` — non-null
   * only when the request used a workspace-scoped API key. Service
   * layer treats these callers as "no private visibility" per M-10.
   */
  apiKeyWorkspaceId?: string | null;
}

export type { SourceProvider };

/** Clusters + workflows a skill is attached to (detail-page insights). */
export interface SkillUsedBy {
  clusters: Array<{ id: string; name: string; slug: string }>;
  workflows: Array<{ id: string; name: string }>;
}

/** Agent read activity for a skill, derived from mcp_events. */
export interface SkillUsage {
  /** MCP reads in the last 30 days (workspace-scoped attribution). */
  count30d: number;
  lastUsedAt: string | null;
}
