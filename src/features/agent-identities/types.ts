/**
 * Agent-identity domain types (camelCase; row shapes in `server/dto.ts`). Visibility is one field
 * here where skills/chats/KBs store `visibility` × `accessMode`: `team` here == `public` + `teams` there.
 */

import type { IdentityVisibility } from "@dopl/contracts";

export type { IdentityVisibility };

import type { Role } from "@/features/workspaces/types";

/** How a field's value is typed in the editor — input affordance only; the value is always a string. */
export const IDENTITY_FIELD_TYPES = ["text", "number", "date", "boolean", "url"] as const;

export type IdentityFieldType = (typeof IDENTITY_FIELD_TYPES)[number];

/** The fallback spelled once — `?? IDENTITY_FIELD_TYPE_DEFAULT` at every read. */
export const IDENTITY_FIELD_TYPE_DEFAULT: IdentityFieldType = "text";

/** One free-form custom field; both halves are labels spliced into the launch payload. */
export interface IdentityField {
  key: string;
  value: string;
  /** Absent is `text`. */
  type?: IdentityFieldType;
}

export interface IdentityKnowledgeBaseRef {
  id: string;
  name: string;
}

/**
 * A folder scope means its subtree including later additions (never expanded to rows). An attachment,
 * not a permission: the session's read ceiling stays base-keyed.
 */
export type IdentityKnowledgeScopeKind = "base" | "folder" | "entry";

/** The write shape — ids only; knowledge paths are derived, so a path on the wire would rot on rename. */
export type IdentityKnowledgeScope =
  | { baseId: string; scope: "base" }
  | { baseId: string; scope: "folder"; folderId: string }
  | { baseId: string; scope: "entry"; entryId: string };

/** One top-level folder on a base card: a name and, when it has one, its own clause (never ids). */
export interface IdentityKnowledgeFolderBrief {
  name: string;
  /** `knowledge_folders.description`; absent (never clipped) when longer than a card carries. */
  summary?: string;
}

/**
 * The read shape — one attached scope resolved for the reading caller. `path` is display-only
 * (`Base / Folder / Entry`, recomputed per read) and user text the desktop sanitizes.
 */
export interface IdentityKnowledgeRef {
  baseId: string;
  baseName: string;
  scope: IdentityKnowledgeScopeKind;
  folderId?: string;
  folderName?: string;
  entryId?: string;
  entryTitle?: string;
  path: string;
  /** The base-relative knowledge path (`Deploys/Rollback.md`); absent on a base scope. Never derive it from `path`. */
  toolPath?: string;
  /**
   * Base card (`scope: "base"` only): fixed-size by construction — the desktop renders ≤400 chars
   * per base by dropping whole facts (`prompt-framing-agent-identity.js › baseCard`).
   * The slug is an address (`dopl_kb` accepts it as `base`), emitted only if it survives `idToken`.
   */
  baseSlug?: string;
  /** `knowledge_bases.description`, carried whole or not at all. */
  baseSummary?: string;
  /** Top-level folders only, capped. */
  baseFolders?: IdentityKnowledgeFolderBrief[];
  /** The TRUE top-level folder count; the folder line renders only when it equals `baseFolders.length`. */
  baseFolderCount?: number;
}

/**
 * Which surface lists an identity — /home's Personal section (the caller's personal container) or
 * the workspace Identities page. Mirrors `knowledge/types.ts › KbShelf` (§1). A write input and a read
 * filter, never a field on the row; not the visibility axis. Absent = no filter.
 */
export type IdentityShelf = "home" | "workspace";

export interface AgentIdentity {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  instructions: string | null;
  /** Null = the runtime's own default; this layer holds no model roster. */
  model: string | null;
  /** Preferred runtime (`claude`, `codex`, …); `null` = the channel decides. Optional per §8: read `?? null`. */
  runtime?: string | null;
  fields: IdentityField[];
  visibility: IdentityVisibility;
  /** Populated only on a `team` row, and only for the creator or a workspace admin. */
  teamIds: string[];
  /** Viewer-filtered base-level slice of {@link AgentIdentity.knowledge}, kept for older readers. */
  knowledgeBases: IdentityKnowledgeBaseRef[];
  /**
   * Every attached scope, viewer-filtered. Optional per §8 — the payload is IndexedDB-persisted, so
   * every reader spells `?? EMPTY_KNOWLEDGE` inline (`lib/knowledge-scopes.ts`).
   */
  knowledge?: IdentityKnowledgeRef[];
  /** How many attachments the viewer filter dropped — a count, never a location. Optional: read `?? 0`. */
  unreachableKnowledgeBaseCount?: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The flattened launch payload (`GET …/resolve`): only what starting an agent needs, no ids. */
export interface ResolvedAgentIdentity {
  name: string;
  instructions: string | null;
  model: string | null;
  /** The identity's runtime, or `null` for no preference. */
  runtime: string | null;
  fields: IdentityField[];
  knowledgeBases: IdentityKnowledgeBaseRef[];
  /** Every scope. Beside `knowledgeBases`, never instead: the desktop narrows by allowlist. */
  knowledge: IdentityKnowledgeRef[];
  /** Attachments this launch cannot reach — a count, never a location; it never blocks a launch. */
  unreachableKnowledgeBaseCount: number;
  /**
   * Did the resolving caller write it? Picks the desktop's security header. A computed boolean,
   * never `createdBy`; `false` once the author leaves (`created_by` SET NULL).
   */
  authoredByCaller: boolean;
}

/** Request-scoped context built at the route boundary (mirrors `SkillContext` / `KnowledgeContext`). */
export interface AgentIdentityContext {
  workspaceId: string;
  userId: string;
  /** API-key callers = agent, session callers = user. */
  source: "user" | "agent";
  /** Null when auth resolved none → non-admin. */
  role: Role | null;
  /** Which workspace the credential is fenced to — not the visibility answer (F-333/F-336). */
  apiKeyWorkspaceId?: string | null;
  /**
   * Whose reach the credential inherits; `null` = nobody. Read only through
   * `shared/auth/credential-audience.ts › isSharedCredential` (M-10: shared credentials get no private reach).
   */
  credentialSubjectUserId: string | null;
}
