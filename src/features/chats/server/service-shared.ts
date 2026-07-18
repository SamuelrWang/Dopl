import "server-only";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import {
  deleteGrantsForResource,
  insertReadGrantsIfMissing,
  listGrantsForResources,
  listTeamIdsForUser,
} from "@/features/teams/server/repository";
import type { Chat, ExportFormat } from "../types";
import type { ChatExportInput } from "../schema";
import { ChatForbiddenError, ChatNotFoundError } from "./errors";
import type { ChatFolderRow, ChatRow, ProfileRef } from "./dto";
import * as repo from "./repository";

/**
 * Shared internals for the chats service: the `ChatContext` construction
 * + the cross-cutting helpers (visibility gates, ownership guard, folder
 * inheritance, format derivation, profile hydration) used by more than
 * one of the per-domain service modules (`service-reads`,
 * `service-writes`, `service-folders`).
 */

export interface ChatContext {
  workspaceId: string;
  userId: string;
  source: "user" | "agent";
  /** Caller's workspace role; null when the auth layer didn't resolve one
   *  (treated as non-admin — team-scoped chats then require a grant). */
  role: Role | null;
  /** Set when the caller authenticated with a workspace-scoped API key
   *  (shared credential) — private chats are hidden entirely (M-10). */
  apiKeyWorkspaceId: string | null;
}

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role?: Role | null;
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
}

export function buildChatContext(auth: AuthLike): ChatContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.agentTokenId ? "agent" : "user",
    role: auth.role ?? null,
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
  };
}

export const UNIQUE_VIOLATION = "23505";

// ─── Helpers ────────────────────────────────────────────────────────

const NUL = String.fromCharCode(0);

/**
 * Strip NUL (U+0000) from every string in a payload before it reaches
 * Postgres (F-7). Postgres text/jsonb reject the NUL code point, so an
 * agent that exports a transcript carrying a stray NUL used to blow up with
 * an INTERNAL_ERROR 500 (and, pre-F-12, orphan a header row). NUL carries no
 * meaning in a chat summary, so it is stripped rather than rejected — the
 * export still lands. Applied at the chat write boundary (export / append /
 * update / folder writes).
 */
export function stripNulDeep<T>(value: T): T {
  if (typeof value === "string") {
    return value.includes(NUL)
      ? (value.split(NUL).join("") as unknown as T)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => stripNulDeep(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripNulDeep(v);
    return out as T;
  }
  return value;
}

/** Precomputed grant context for visibility checks over a set of rows. */
interface GrantCtx {
  /** Teams the caller belongs to. Fetched only when needed. */
  myTeamIds: Set<string>;
  /** chatId → teamIds granted read access. */
  byChat: Map<string, string[]>;
}

const EMPTY_GRANTS: GrantCtx = { myTeamIds: new Set(), byChat: new Map() };

/** Fetch the caller's teams + chat grants — but only when some row is
 *  team-scoped and not the caller's own (fixed query count per request). */
export async function grantsForRows(
  ctx: ChatContext,
  rows: ChatRow[]
): Promise<GrantCtx> {
  const teamScoped = rows.filter(
    (r) => r.visibility === "public" && r.access_mode === "teams"
  );
  if (teamScoped.length === 0) return EMPTY_GRANTS;
  const needsMembership = teamScoped.some((r) => r.owner_id !== ctx.userId);
  const [myTeams, grants] = await Promise.all([
    needsMembership && !ctx.apiKeyWorkspaceId
      ? listTeamIdsForUser(ctx.workspaceId, ctx.userId)
      : Promise.resolve([]),
    listGrantsForResources(
      ctx.workspaceId,
      "chat",
      teamScoped.map((r) => r.id)
    ),
  ]);
  const byChat = new Map<string, string[]>();
  for (const g of grants) {
    byChat.set(g.resourceId, [...(byChat.get(g.resourceId) ?? []), g.teamId]);
  }
  return { myTeamIds: new Set(myTeams), byChat };
}

/**
 * M-10 visibility filter, extended for team scoping:
 *   - Public + workspace mode: always.
 *   - Public + teams mode: owner, workspace admins, or members of a
 *     granted team. Never via a workspace-scoped API key (shared
 *     credential — same conservatism as private).
 *   - Private via session or personal credential: owner-only.
 *   - Private via workspace-scoped API key: never.
 */
export function canSeeChat(ctx: ChatContext, chat: ChatRow, grants: GrantCtx): boolean {
  if (chat.visibility === "public" && chat.access_mode !== "teams") return true;
  if (ctx.apiKeyWorkspaceId) return false;
  if (chat.owner_id === ctx.userId) return true;
  if (chat.visibility !== "public") return false;
  if (ctx.role !== null && meetsMinRole(ctx.role, "admin")) return true;
  const granted = grants.byChat.get(chat.id) ?? [];
  return granted.some((teamId) => grants.myTeamIds.has(teamId));
}

/** Grant set for the DTO — owners (and admins) see it; other viewers get
 *  an empty list so team composition doesn't leak through a shared chat. */
export function grantedTeamIdsFor(
  ctx: ChatContext,
  row: ChatRow,
  byChat: Map<string, string[]>
): string[] {
  if (row.access_mode !== "teams") return [];
  const isAdmin = ctx.role !== null && meetsMinRole(ctx.role, "admin");
  if (row.owner_id !== ctx.userId && !isAdmin) return [];
  return byChat.get(row.id) ?? [];
}

export async function requireOwnChat(
  ctx: ChatContext,
  chatId: string,
  action: string
): Promise<ChatRow> {
  const chat = await repo.findChatById(ctx.workspaceId, chatId);
  if (!chat) throw new ChatNotFoundError(chatId);
  const grants = await grantsForRows(ctx, [chat]);
  if (!canSeeChat(ctx, chat, grants)) throw new ChatNotFoundError(chatId);
  if (chat.owner_id !== ctx.userId || ctx.apiKeyWorkspaceId) {
    throw new ChatForbiddenError(action);
  }
  return chat;
}

/** Folders are personal — a foreign folder id means nothing to the
 *  viewer of a public chat and shouldn't leak. */
export function withFolderPrivacy(ctx: ChatContext, row: ChatRow, chat: Chat): Chat {
  if (row.owner_id === ctx.userId) return chat;
  return { ...chat, folderId: null };
}

export async function resolveOrCreateFolderRow(
  ctx: ChatContext,
  name: string
): Promise<ChatFolderRow> {
  const existing = await repo.findFolderByName(ctx.workspaceId, ctx.userId, name);
  if (existing) return existing;
  try {
    return await repo.insertFolder(ctx.workspaceId, ctx.userId, name);
  } catch (err) {
    // Lost a create race — the concurrent winner is the folder we want.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      const winner = await repo.findFolderByName(ctx.workspaceId, ctx.userId, name);
      if (winner) return winner;
    }
    throw err;
  }
}

/** The folder's team grant set (empty unless team-scoped). */
export async function folderGrantIds(
  ctx: ChatContext,
  folder: ChatFolderRow
): Promise<string[]> {
  if (folder.access_mode !== "teams" || folder.visibility !== "public") return [];
  const grants = await listGrantsForResources(ctx.workspaceId, "chat_folder", [
    folder.id,
  ]);
  return grants.map((g) => g.teamId);
}

/** Inheritance: replace the chat's grant set with its folder's. */
export async function syncChatGrantsToFolder(
  ctx: ChatContext,
  chatId: string,
  folder: ChatFolderRow
): Promise<void> {
  const teamIds = await folderGrantIds(ctx, folder);
  await deleteGrantsForResource(ctx.workspaceId, "chat", chatId);
  if (teamIds.length > 0) {
    await insertReadGrantsIfMissing(ctx.workspaceId, "chat", chatId, teamIds);
  }
}

export function deriveFormat(
  messages: Array<{ verbatim?: string | null }>
): ExportFormat {
  const verbatimCount = messages.filter((m) => m.verbatim).length;
  if (verbatimCount === 0) return "summarized";
  if (verbatimCount === messages.length) return "verbatim";
  return "mixed";
}

export function messagePayload(
  messages: ChatExportInput["messages"]
): Array<{ role: string; summary: string; verbatim: string | null }> {
  return messages.map((m) => ({
    role: m.role,
    summary: m.summary,
    verbatim: m.verbatim ?? null,
  }));
}

export async function profilesById(userIds: string[]): Promise<Map<string, ProfileRef>> {
  const unique = [...new Set(userIds)];
  const profiles = await repo.fetchProfiles(unique);
  return new Map(profiles.map((p) => [p.id, p]));
}
