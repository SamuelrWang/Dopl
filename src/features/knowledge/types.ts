/**
 * Domain types (camelCase). snake_case row types + row→domain mappers live in
 * `server/dto.ts`, server-only so the row schema stays out of client bundles.
 *
 * Bases are workspace-scoped folder/file trees; `KnowledgeEntry.body` is
 * markdown. Soft-delete: `deletedAt` on every type, `null` = active.
 */

import type { Role } from "@/features/workspaces/types";

export type KnowledgeEntryType = "note" | "doc" | "transcript" | "imported";

/**
 * Write origin, set at route boundary: API key → "agent", session cookie →
 * "user". Checked against `KnowledgeBase.agentWriteEnabled` before any
 * agent-origin mutation.
 */
export type WriteSource = "user" | "agent";

/**
 * Per-resource visibility (M-10). `public` = every member at role default
 * level; `private` = owner-only, invisible in lists/search/canvas to others
 * (RLS enforces; service layer belt-and-suspenders).
 *
 * KBs are two-way (owner or admin flips via Sharing settings, narrowing
 * unchecked); skills stay one-way private → public. The DB column defaults to
 * `'public'` so existing rows stay visible; `createBase` / `createSkill`
 * override to `'private'` for new items.
 */
export type Visibility = "public" | "private";

/**
 * Which shelf a base lives on: the /home Knowledge pane's "across all channels"
 * scope, or the workspace Knowledge page (ruling 2026-08-26). Since 2026-09-02
 * these are two containers — the personal shelf is the caller's own
 * `kind='personal'` workspace — so the shelf resolves to a `workspace_id`, not
 * to a `WHERE`.
 *
 * Not a field on `KnowledgeBase` and never make it one: it is a write input
 * (`KnowledgeBaseCreateInput.homeScoped`, which routes the row) and a read
 * filter (`GET /api/knowledge/bases?shelf=`). A surface that must show the shelf
 * gets a sibling key on the list response, which is what stops the SDK-mirrored
 * row type widening (`scripts/check-knowledge-type-drift.ts`).
 *
 * Absent is not a third value — it means no filter, which is what keeps MCP
 * `kb_list_bases` and workspace search seeing the whole workspace.
 */
export type KbShelf = "home" | "workspace";

export interface KnowledgeBase {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  publicId: string;
  description: string | null;
  agentWriteEnabled: boolean;
  visibility: Visibility;
  /** 'workspace' = every member (role default level); 'teams' = granted teams only. */
  accessMode: "workspace" | "teams";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Per-base list-view counters, computed not stored. A sibling of
 * `KnowledgeBase`, never fields on it: that type is hand-mirrored into
 * `packages/dopl-client/src/knowledge-types.ts` and pinned field-for-field by
 * `scripts/check-knowledge-type-drift.ts`, so widening it pushes display-only
 * numbers onto every MCP `kb_*` payload.
 *
 * `lastEntryUpdatedAt` is content freshness (newest active entry write), not
 * `KnowledgeBase.updatedAt`, which moves on name/description/sharing writes.
 */
export interface KnowledgeBaseStats {
  entryCount: number;
  lastEntryUpdatedAt: string | null;
  /**
   * Stored `knowledge_bases.storage_bytes` counter, not a re-sum per request.
   * `0` = empty base, `null` = unknown (e.g. build deployed ahead of the
   * migration); the meter renders for `0` and is suppressed for `null`.
   */
  storageBytes: number | null;
}

/** A (knowledge_base, channel) grant's three states collapse to two stored
 *  levels plus absence (no row = not shared). See
 *  `20260827120000_channel_resource_grants.sql`. */
export type ChannelGrantLevel = "agent_only" | "visible";

/** One KB's grant on one channel, projected onto the `channelGrants` sibling
 *  key of `GET /api/knowledge/bases?channelId=`. `guestWrite` lives on the
 *  grant, not the KB — a KB shared into N channels is N audience questions —
 *  and it rides the list response so it never widens the SDK-mirrored row
 *  type (`check-knowledge-type-drift`). */
export interface ChannelResourceGrant {
  level: ChannelGrantLevel;
  guestWrite: boolean;
}

/**
 * What a writer may ask for: the two stored levels plus the third state.
 *
 * `"none"` exists on the wire and nowhere else — storage admits
 * `agent_only`/`visible` only and the service turns `none` into a DELETE. So the
 * write states the desired end state in full and a retry is idempotent, rather
 * than "not shared" being said by omitting a field.
 */
export type ChannelGrantLevelInput = ChannelGrantLevel | "none";

/**
 * One channel the grants section may offer, as the settings read projects it.
 * The list is built server-side from the caller's visible channels; a
 * client-side one would put unreadable rooms' names on the wire.
 */
export interface ChannelGrantChannelRef {
  id: string;
  name: string;
  /** DMs are channels the caller belongs to; the row labels them as such. */
  isDirect: boolean;
}

export interface KnowledgeFolder {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  parentId: string | null;
  name: string;
  /** Agent-facing summary (≤300 chars), surfaced in MCP get_tree / list_dir.
   *  Entries use `excerpt`, bases use `description`, same purpose. */
  description: string | null;
  position: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface KnowledgeEntry {
  id: string;
  workspaceId: string;
  knowledgeBaseId: string;
  folderId: string | null;
  title: string;
  excerpt: string | null;
  body: string;
  entryType: KnowledgeEntryType;
  position: number;
  createdBy: string | null;
  lastEditedBy: string | null;
  lastEditedSource: WriteSource;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Request-scoped context every service method takes. Built at route boundary
 *  in `server/service.ts#buildKnowledgeContext`. */
export interface KnowledgeContext {
  workspaceId: string;
  userId: string;
  source: WriteSource;
  /** Caller's workspace role — team-access resolution without refetching membership. */
  role: Role;
  /**
   * Workspace this credential is locked to; `null` for session callers and
   * unlocked tokens. It answers which workspace and nothing else: it used to
   * double as the M-10 visibility gate, which is the F-336 defect — see
   * {@link KnowledgeContext.credentialSubjectUserId}.
   */
  apiKeyWorkspaceId?: string | null;
  /**
   * Whose reach this credential inherits (`mcp_tokens.subject_user_id`): the one
   * human it acts as, or `null` for a credential that may be passed between
   * humans. Never read it directly; the one reader is
   * `shared/auth/credential-audience.ts › isSharedCredential`.
   *
   * M-10: a credential with no single human behind it inherits nobody's personal
   * reach. A container session does have one — the operator — so it reads
   * private rows as its operator does, while staying fenced to one container by
   * the other axis and to granted bases by layer A.
   */
  credentialSubjectUserId: string | null;
  /**
   * `X-Dopl-Session-Id` verbatim (the desktop's slot key, `<channelId>:<tail>`),
   * or `null`/absent for every caller that sends none.
   *
   * A non-authorization signal (`shared/auth/session-header.ts`) and the only
   * forgeable field on this context. It is read in exactly one place —
   * `service-audience.ts › narrowToSessionChannel` — where it may only NARROW an
   * already-fenced channel set. Nothing else may read it, and nothing may grant
   * on it.
   */
  sessionId?: string | null;
}

/** Snapshot of a base's contents. Folders and entries are flat arrays; the UI
 *  builds the hierarchy from `parentId`/`folderId`. */
export interface KnowledgeTreeSnapshot {
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  /** Present only when entry paging was requested (`entryLimit`). */
  entryTotal?: number;
  /** Opaque cursor for the next entry page; null = last page. */
  nextEntryCursor?: string | null;
}

// ─── Source provider types ──────────────────────────────────────────
// Canonical home: @/shared/lib/source-types. Re-exported for
// knowledge-internal consumers.

export type {
  SourceConnection,
  SourceProvider,
} from "@/shared/lib/source-types";
