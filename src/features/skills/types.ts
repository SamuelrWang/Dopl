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

import type { Role } from "@/features/workspaces/types";
import type { SourceProvider, SourceConnection } from "@/shared/lib/source-types";

export type SkillStatus = "active" | "draft";

export type SkillWriteSource = "user" | "agent";

export interface SkillConnector extends SourceConnection {
  /** Human-readable note about why this skill calls this connector. */
  usedFor: string;
}

/**
 * Per-resource visibility. Skills use the full KB/chat three-way model
 * (since the skill_team_sharing migration):
 *
 *   private   → visibility 'private'                          (owner only)
 *   team      → visibility 'public' + accessMode 'teams'      (granted teams)
 *   workspace → visibility 'public' + accessMode 'workspace'  (everyone)
 *
 * Sharing is fully re-scopable by the owner or a workspace admin — the
 * old M-10 "once public, always public" rule is retired.
 */
export type Visibility = "public" | "private";

/** Public reach: the whole workspace, or only specifically granted teams. */
export type SkillAccessMode = "workspace" | "teams";

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
  accessMode: SkillAccessMode;
  /** Optional plain-text organizing label. Null = unfiled. Skills are
   *  single-file and small; folders group the many. */
  folder: string | null;
  /** Teams granted read access — populated only when accessMode is
   *  'teams', and only for the owner / workspace admins. */
  grantedTeamIds: string[];
  createdBy: string | null;
  lastEditedBy: string | null;
  lastEditedSource: SkillWriteSource;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * The single SKILL.md procedure backing a skill. Since F-029 the body
 * lives in columns ON the skill row (no `skill_files` table); this shape
 * is synthesized from those columns (`server/dto.ts mapSkillBodyRow`)
 * and kept as the API's `file` object so the external contract is
 * unchanged. `updatedAt` is the body's CAS clock (`body_updated_at`).
 * Long reference material lives in knowledge bases, linked via
 * `dopl://kb/<slug>` refs.
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
 * One append-only snapshot of the SKILL.md body, taken after every
 * content save (user or agent). Metadata shape — the body itself is
 * fetched separately by version id (it can be large; lists never carry
 * it). Keyed off the skill alone (F-029 dropped the file linkage).
 */
export interface SkillVersion {
  id: string;
  skillId: string;
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
 * NOT events — they're `SkillVersion` rows; the history UI merges both
 * streams by `createdAt`. The `file.*` variants are historic-only (the
 * app stopped emitting them at F-029) but stay in the union so old rows
 * render.
 */
export interface SkillEvent {
  id: string;
  skillId: string;
  type: SkillEventType;
  /** Event-specific payload, e.g. `{fields}` for metadata updates. */
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
  accessMode: SkillAccessMode;
  folder: string | null;
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
  /** Caller's workspace role; null when the auth layer didn't resolve
   *  one (treated as non-admin — team-scoped skills then require a
   *  grant). Mirrors `ChatContext.role`. */
  role: Role | null;
  /**
   * Same semantics as `KnowledgeContext.apiKeyWorkspaceId` — non-null
   * only when the request used a workspace-scoped API key. Service
   * layer treats these callers as "no private visibility" per M-10.
   */
  apiKeyWorkspaceId?: string | null;
}

export type { SourceProvider };

/** Agent read activity for a skill, derived from mcp_events. */
export interface SkillUsage {
  /** MCP reads in the last 30 days (workspace-scoped attribution). */
  count30d: number;
  lastUsedAt: string | null;
}
