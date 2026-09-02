import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
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

/** Shared chats-service internals: `ChatContext` construction plus the
 *  cross-cutting helpers (visibility gates, ownership guard, folder
 *  inheritance, format derivation, profile hydration). */

export interface ChatContext {
  workspaceId: string;
  userId: string;
  source: "user" | "agent";
  /** Null when auth didn't resolve one → treated as non-admin, so
   *  team-scoped chats require a grant. */
  role: Role | null;
  /** Workspace this credential is fenced to. ⚠ *WHICH WORKSPACE* only — not
   *  the visibility answer (F-336). */
  apiKeyWorkspaceId: string | null;
  /** WHOSE REACH this credential inherits (`mcp_tokens.subject_user_id`).
   *  ⚠ Read only via `shared/auth/credential-audience.ts ›
   *  isSharedCredential`. Private chats are hidden entirely from a SHARED
   *  credential — one with no single human behind it — never from a container
   *  SESSION, which carries its operator's id here. */
  credentialSubjectUserId: string | null;
}

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role?: Role | null;
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
  /** WHOSE REACH the credential inherits; `null` = nobody in particular.
   *  ⚠ REQUIRED — this axis has no safe default (F-336). */
  credentialSubjectUserId: string | null;
}

export function buildChatContext(auth: AuthLike): ChatContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.agentTokenId ? "agent" : "user",
    role: auth.role ?? null,
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
    credentialSubjectUserId: auth.credentialSubjectUserId,
  };
}

export const UNIQUE_VIOLATION = "23505";

// ─── Helpers ────────────────────────────────────────────────────────

const NUL = String.fromCharCode(0);

/** ⚠ Postgres text/jsonb reject U+0000, so a transcript carrying a stray NUL
 *  500s. Stripped rather than rejected (it carries no meaning) so the export
 *  still lands. Applied at every chat write boundary. */
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

/** Caller's teams + chat grants, fetched only when some row is team-scoped
 *  and not the caller's own. Fixed query count per request. */
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
    needsMembership && !isSharedCredential(ctx)
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
 * Visibility filter:
 *   - public + workspace mode: always
 *   - public + teams mode: owner, workspace admins, or a granted team's
 *     members. Never via a SHARED credential.
 *   - private via a credential with a person behind it: owner-only
 *   - private via a SHARED credential: never
 *
 * ⚠ ARM 2 IS `isSharedCredential`, NOT THE WORKSPACE LOCK — the mirror of
 * `knowledge/server/service-shared.ts › canSeeBase`, moved with it on
 * 2026-08-27 (F-336). A container-session credential is one human's session, so
 * it reads that human's own private transcripts; a credential that may be
 * shared between humans still reads none.
 */
export function canSeeChat(ctx: ChatContext, chat: ChatRow, grants: GrantCtx): boolean {
  if (chat.visibility === "public" && chat.access_mode !== "teams") return true;
  if (isSharedCredential(ctx)) return false;
  if (chat.owner_id === ctx.userId) return true;
  if (chat.visibility !== "public") return false;
  if (ctx.role !== null && meetsMinRole(ctx.role, "admin")) return true;
  const granted = grants.byChat.get(chat.id) ?? [];
  return granted.some((teamId) => grants.myTeamIds.has(teamId));
}

/** ⚠ Grant set for the DTO: owners and admins only. Other viewers get an
 *  empty list — team composition must not leak through a shared chat. */
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
  if (chat.owner_id !== ctx.userId || isSharedCredential(ctx)) {
    throw new ChatForbiddenError(action);
  }
  return chat;
}

/** ⚠ Folders are personal: a foreign folder id means nothing to the viewer
 *  of a public chat and must not leak. */
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
    // Lost a create race — converge on the winner.
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
