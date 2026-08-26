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
 * unchecked); skills stay one-way private → public.
 * ⚠ DB column default is `'public'` so existing rows stay visible;
 * `createBase` / `createSkill` override to `'private'` for new items.
 */
export type Visibility = "public" | "private";

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
 * Per-base list-view counters, computed not stored. ⚠ SIBLING of
 * `KnowledgeBase`, never fields on it: `KnowledgeBase` is hand-mirrored
 * into `packages/dopl-client/src/knowledge-types.ts` and pinned
 * field-for-field by `scripts/check-knowledge-type-drift.ts`, so widening
 * it pushes display-only numbers onto every MCP `kb_*` payload. Keyed by
 * base id alongside `bases` in the list response, like `ownerNames`.
 *
 * `lastEntryUpdatedAt` = CONTENT freshness (newest active entry write),
 * NOT `KnowledgeBase.updatedAt` (moves on name/description/sharing writes,
 * stands still while an agent fills the base).
 */
export interface KnowledgeBaseStats {
  entryCount: number;
  lastEntryUpdatedAt: string | null;
  /**
   * Stored `knowledge_bases.storage_bytes` counter (summed
   * `octet_length(body)` of live entries), NOT a re-sum per request.
   * ⚠ `0` = empty base, `null` = UNKNOWN (counter unreadable, e.g. build
   * deployed ahead of migration). Meter renders for `0`, suppressed for
   * `null` — never drawn on a guess.
   */
  storageBytes: number | null;
}

/** A (knowledge_base, channel) grant's three states collapse to TWO stored
 *  levels plus ABSENCE (no row = not shared). See
 *  `20260827120000_channel_resource_grants.sql`. */
export type ChannelGrantLevel = "agent_only" | "visible";

/** One KB's grant on ONE channel, as projected onto the `channelGrants` sibling
 *  key of `GET /api/knowledge/bases?channelId=`. `guestWrite` lives on the
 *  grant, not the KB — a KB shared into N channels is N audience questions.
 *  ⚠ NOT a field on `KnowledgeBase`: it rides the LIST response, so it never
 *  widens the SDK-mirrored row type (`check-knowledge-type-drift`). */
export interface ChannelResourceGrant {
  level: ChannelGrantLevel;
  guestWrite: boolean;
}

/**
 * What a WRITER may ask for (M1) — the two stored levels plus the third state
 * spelled out.
 *
 * ⚠ `"none"` EXISTS ON THE WIRE AND NOWHERE ELSE. Storage has no such value
 * (the CHECK admits `agent_only`/`visible` only); the service turns it into a
 * DELETE. A caller cannot say "not shared" by omitting a field, so the write is
 * a full statement of the desired end state and a retry is idempotent — the
 * `PUT`/`DELETE` star argument (`bases/[baseId]/star/route.ts`), reached by a
 * different road because here the third state is the interesting one.
 */
export type ChannelGrantLevelInput = ChannelGrantLevel | "none";

/**
 * One channel the grants section may offer, as the settings read projects it.
 * ⚠ The list is built SERVER-side from the caller's visible channels — never a
 * client-side workspace channel list, which would put unreadable rooms' names
 * on the wire.
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
   * Workspace a workspace-scoped API key is locked to; `null` for session
   * callers and personal API keys. ⚠ M-10 gate: workspace-scoped keys must
   * NOT see private items even ones owned by the calling user — such keys
   * may be shared between humans, so a teammate's draft would leak.
   */
  apiKeyWorkspaceId?: string | null;
}

/** Snapshot of a base's contents. Folders and entries are FLAT arrays; UI
 *  builds hierarchy from `parentId`/`folderId`. */
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
