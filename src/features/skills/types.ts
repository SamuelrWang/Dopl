/**
 * Skills domain types. Workspace-scoped procedural prompts served to
 * agents over MCP. Body markdown carries `dopl://` refs, parsed by
 * `parseSkillBody`. camelCase here; snake_case row shape in `server/dto.ts`.
 */

import type { Role } from "@/features/workspaces/types";
import type { SourceProvider, SourceConnection } from "@/shared/lib/source-types";

export type SkillStatus = "active" | "draft";

export type SkillWriteSource = "user" | "agent";

export interface SkillConnector extends SourceConnection {
  /** Why this skill calls this connector. */
  usedFor: string;
}

/**
 * Per-resource visibility. Three-way model, same as KB/chat:
 *   private   → visibility 'private'                          (owner only)
 *   team      → visibility 'public' + accessMode 'teams'      (granted teams)
 *   workspace → visibility 'public' + accessMode 'workspace'  (everyone)
 * Re-scopable in any direction by owner or workspace admin.
 */
export type Visibility = "public" | "private";

/** Public reach: whole workspace, or only granted teams. */
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
  /** Plain-text organizing label. Null = unfiled. */
  folder: string | null;
  /** Teams granted read. Populated only when accessMode is 'teams', and
   *  only for owner / workspace admins. */
  grantedTeamIds: string[];
  createdBy: string | null;
  lastEditedBy: string | null;
  lastEditedSource: SkillWriteSource;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * The single SKILL.md procedure. No `skill_files` table — body lives in
 * columns on the skill row; this shape is synthesized by
 * `server/dto.ts mapSkillBodyRow` and kept as the API's `file` object so
 * the external contract holds. `updatedAt` = CAS clock (`body_updated_at`).
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

/** Append-only body snapshot after every content save. Metadata only — the
 *  body is fetched separately by version id; lists never carry it. */
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
 * One structural change in a skill's audit timeline. ⚠ Content edits are
 * NOT events — they're `SkillVersion` rows; history UI merges both
 * streams by `createdAt`. `file.*` variants no longer emitted; stay in
 * the union so old rows render.
 */
export interface SkillEvent {
  id: string;
  skillId: string;
  type: SkillEventType;
  /** e.g. `{fields}` for metadata updates. */
  detail: Record<string, unknown>;
  authorId: string | null;
  source: SkillWriteSource;
  createdAt: string;
}

export const PRIMARY_SKILL_FILE_NAME = "SKILL.md";

/** Workspace KB row for the detail-page picker. Declared here, not imported
 *  from features/knowledge, to avoid a cross-feature dependency. */
export interface WorkspaceKbSummary {
  slug: string;
  name: string;
}

/** Metadata projection for `skill_list` / library cards. No body — keeps
 *  the index payload small. */
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

/** `resolveSkillBody` output: body plus an availability check per
 *  reference. Drives `skill_get` and the detail page's broken-ref badges. */
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

/** Request-scoped context from auth metadata at the route layer. `source`:
 *  API-key callers = agent, session callers = user; enforced only in
 *  service.ts, where `agentWriteEnabled` matters. */
export interface SkillContext {
  workspaceId: string;
  userId: string;
  source: SkillWriteSource;
  /** Caller's workspace role. Null when auth didn't resolve one → treated
   *  as non-admin, so team-scoped skills require a grant. Mirrors
   *  `ChatContext.role`. */
  role: Role | null;
  /** Non-null only for workspace-scoped API-key requests. Service layer
   *  gives these callers no private visibility. Same semantics as
   *  `KnowledgeContext.apiKeyWorkspaceId`. */
  apiKeyWorkspaceId?: string | null;
}

export type { SourceProvider };

/** Agent read activity for a skill, derived from mcp_events. */
export interface SkillUsage {
  /** MCP reads in the last 30 days, workspace-scoped. */
  count30d: number;
  lastUsedAt: string | null;
}
