import "server-only";
import type { Chat, ChatDetail, ChatFolder, ExportFormat } from "../types";
import type {
  ChatAppendInput,
  ChatExportInput,
  ChatUpdateInput,
} from "../schema";
import {
  ChatFolderConflictError,
  ChatFolderNotFoundError,
  ChatForbiddenError,
  ChatNotFoundError,
} from "./errors";
import { mapChatRow, mapFolderRow, mapMessageRow, mapOwner } from "./dto";
import type { ChatRow, ProfileRef } from "./dto";
import * as repo from "./repository";

export interface ChatContext {
  workspaceId: string;
  userId: string;
  source: "user" | "agent";
  /** Set when the caller authenticated with a workspace-scoped API key
   *  (shared credential) — private chats are hidden entirely (M-10). */
  apiKeyWorkspaceId: string | null;
}

export interface AuthLike {
  userId: string;
  workspaceId: string;
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
}

export function buildChatContext(auth: AuthLike): ChatContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.agentTokenId ? "agent" : "user",
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
  };
}

const UNIQUE_VIOLATION = "23505";

// ─── Reads ──────────────────────────────────────────────────────────

/** Everything the caller may read: their own chats + workspace-public ones. */
export async function listChats(ctx: ChatContext): Promise<Chat[]> {
  const rows = await repo.listVisibleChats(ctx.workspaceId, ctx.userId);
  const visible = rows.filter((row) => canSeeChat(ctx, row));
  const profiles = await profilesById(visible.map((r) => r.owner_id));
  return visible.map((row) =>
    withFolderPrivacy(
      ctx,
      row,
      mapChatRow(row, mapOwner(row.owner_id, profiles.get(row.owner_id)), repo.countOf(row))
    )
  );
}

export async function getChat(ctx: ChatContext, chatId: string): Promise<ChatDetail> {
  const row = await repo.findChatById(ctx.workspaceId, chatId);
  if (!row || !canSeeChat(ctx, row)) throw new ChatNotFoundError(chatId);
  const [messages, profiles] = await Promise.all([
    repo.listMessages(chatId),
    profilesById([row.owner_id]),
  ]);
  return {
    ...withFolderPrivacy(
      ctx,
      row,
      mapChatRow(row, mapOwner(row.owner_id, profiles.get(row.owner_id)), messages.length)
    ),
    messages: messages.map(mapMessageRow),
  };
}

// ─── Export (create / idempotent re-export) ─────────────────────────

/**
 * Agent-facing export. When `clientSessionId` matches one of the
 * caller's earlier exports, the chat's header and transcript are
 * replaced in place (visibility, pinned state, and folder are kept
 * unless the payload names a folder) — re-exporting a session never
 * duplicates it. `format` is derived from the messages, never taken
 * from the caller.
 */
export async function exportChat(
  ctx: ChatContext,
  input: ChatExportInput
): Promise<ChatDetail> {
  const folderId = input.folder
    ? (await resolveOrCreateFolder(ctx, input.folder)).id
    : null;

  const existing = input.clientSessionId
    ? await repo.findChatByClientSession(ctx.workspaceId, ctx.userId, input.clientSessionId)
    : null;

  const header = {
    title: input.title,
    overview: input.overview,
    source: input.source,
    project: input.project ?? null,
    format: deriveFormat(input.messages),
    ...(input.sessionDate ? { session_date: input.sessionDate } : {}),
    deliverables: input.deliverables,
    learnings: input.learnings,
    exported_at: new Date().toISOString(),
  };
  const payload = messagePayload(input.messages);

  let chat: ChatRow;
  if (existing) {
    chat = await repo.updateChat(existing.id, {
      ...header,
      ...(folderId ? { folder_id: folderId } : {}),
    });
    await repo.replaceMessages(chat.id, ctx.workspaceId, payload);
  } else {
    try {
      chat = await repo.insertChat({
        workspace_id: ctx.workspaceId,
        owner_id: ctx.userId,
        folder_id: folderId,
        client_session_id: input.clientSessionId ?? null,
        visibility: input.visibility,
        ...header,
      });
    } catch (err) {
      // Lost a first-export race on client_session_id — converge on the
      // winner's row and treat this call as the re-export it now is.
      const raced =
        repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientSessionId
          ? await repo.findChatByClientSession(
              ctx.workspaceId,
              ctx.userId,
              input.clientSessionId
            )
          : null;
      if (!raced) throw err;
      chat = await repo.updateChat(raced.id, {
        ...header,
        ...(folderId ? { folder_id: folderId } : {}),
      });
    }
    try {
      await repo.replaceMessages(chat.id, ctx.workspaceId, payload);
    } catch (err) {
      // Never leave a header-only chat behind: a create whose transcript
      // write failed is rolled back so the caller's retry starts clean.
      if (!existing && !input.clientSessionId) {
        await repo.deleteChat(chat.id).catch(() => {});
      }
      throw err;
    }
  }

  return getChat(ctx, chat.id);
}

// ─── Mutations (owner-only) ─────────────────────────────────────────

export async function appendMessages(
  ctx: ChatContext,
  chatId: string,
  input: ChatAppendInput
): Promise<ChatDetail> {
  const chat = await requireOwnChat(ctx, chatId, "append to it");
  await repo.appendMessagesTx(chat.id, ctx.workspaceId, messagePayload(input.messages));
  // The transcript's verbatim mix may have changed — keep format honest.
  const allMessages = await repo.listMessages(chat.id);
  const format = deriveFormat(
    allMessages.map((m) => ({ verbatim: m.verbatim ?? undefined }))
  );
  if (format !== chat.format) {
    await repo.updateChat(chat.id, { format });
  }
  return getChat(ctx, chat.id);
}

export async function updateChatHeader(
  ctx: ChatContext,
  chatId: string,
  patch: ChatUpdateInput
): Promise<Chat> {
  const chat = await requireOwnChat(ctx, chatId, "update it");

  let folderPatch: { folder_id: string | null } | undefined;
  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) {
      const folder = await repo.findFolderById(ctx.workspaceId, ctx.userId, patch.folderId);
      if (!folder) throw new ChatFolderNotFoundError(patch.folderId);
    }
    folderPatch = { folder_id: patch.folderId };
  } else if (patch.folder !== undefined) {
    folderPatch = {
      folder_id:
        patch.folder === null ? null : (await resolveOrCreateFolder(ctx, patch.folder)).id,
    };
  }

  const row = await repo.updateChat(chat.id, {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.overview !== undefined ? { overview: patch.overview } : {}),
    ...(patch.project !== undefined ? { project: patch.project } : {}),
    ...(patch.sessionDate !== undefined ? { session_date: patch.sessionDate } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
    ...(patch.deliverables !== undefined ? { deliverables: patch.deliverables } : {}),
    ...(patch.learnings !== undefined ? { learnings: patch.learnings } : {}),
    ...(folderPatch ?? {}),
  });

  const [count, profiles] = await Promise.all([
    repo.countMessages(row.id),
    profilesById([row.owner_id]),
  ]);
  return mapChatRow(row, mapOwner(row.owner_id, profiles.get(row.owner_id)), count);
}

export async function deleteChat(ctx: ChatContext, chatId: string): Promise<void> {
  const chat = await requireOwnChat(ctx, chatId, "delete it");
  await repo.deleteChat(chat.id);
}

// ─── Folders ────────────────────────────────────────────────────────

export async function listFolders(ctx: ChatContext): Promise<ChatFolder[]> {
  const rows = await repo.listFolders(ctx.workspaceId, ctx.userId);
  return rows.map(mapFolderRow);
}

export async function createFolder(ctx: ChatContext, name: string): Promise<ChatFolder> {
  try {
    return mapFolderRow(await repo.insertFolder(ctx.workspaceId, ctx.userId, name));
  } catch (err) {
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      throw new ChatFolderConflictError(name);
    }
    throw err;
  }
}

export async function renameFolderForUser(
  ctx: ChatContext,
  folderId: string,
  name: string
): Promise<ChatFolder> {
  const folder = await repo.findFolderById(ctx.workspaceId, ctx.userId, folderId);
  if (!folder) throw new ChatFolderNotFoundError(folderId);
  try {
    return mapFolderRow(await repo.renameFolder(folder.id, name));
  } catch (err) {
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      throw new ChatFolderConflictError(name);
    }
    throw err;
  }
}

export async function deleteFolderForUser(
  ctx: ChatContext,
  folderId: string
): Promise<void> {
  const folder = await repo.findFolderById(ctx.workspaceId, ctx.userId, folderId);
  if (!folder) throw new ChatFolderNotFoundError(folderId);
  await repo.deleteFolder(folder.id);
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * M-10 visibility filter — same rationale as `canSeeSkill`:
 *   - Public: always.
 *   - Private via session or personal credential: owner-only.
 *   - Private via workspace-scoped API key (shared credential): never.
 */
function canSeeChat(ctx: ChatContext, chat: ChatRow): boolean {
  if (chat.visibility === "public") return true;
  if (ctx.apiKeyWorkspaceId) return false;
  return chat.owner_id === ctx.userId;
}

async function requireOwnChat(
  ctx: ChatContext,
  chatId: string,
  action: string
): Promise<ChatRow> {
  const chat = await repo.findChatById(ctx.workspaceId, chatId);
  if (!chat || !canSeeChat(ctx, chat)) throw new ChatNotFoundError(chatId);
  if (chat.owner_id !== ctx.userId || ctx.apiKeyWorkspaceId) {
    throw new ChatForbiddenError(action);
  }
  return chat;
}

/** Folders are personal — a foreign folder id means nothing to the
 *  viewer of a public chat and shouldn't leak. */
function withFolderPrivacy(ctx: ChatContext, row: ChatRow, chat: Chat): Chat {
  if (row.owner_id === ctx.userId) return chat;
  return { ...chat, folderId: null };
}

async function resolveOrCreateFolder(
  ctx: ChatContext,
  name: string
): Promise<ChatFolder> {
  const existing = await repo.findFolderByName(ctx.workspaceId, ctx.userId, name);
  if (existing) return mapFolderRow(existing);
  try {
    return mapFolderRow(await repo.insertFolder(ctx.workspaceId, ctx.userId, name));
  } catch (err) {
    // Lost a create race — the concurrent winner is the folder we want.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      const winner = await repo.findFolderByName(ctx.workspaceId, ctx.userId, name);
      if (winner) return mapFolderRow(winner);
    }
    throw err;
  }
}

function deriveFormat(
  messages: Array<{ verbatim?: string | null }>
): ExportFormat {
  const verbatimCount = messages.filter((m) => m.verbatim).length;
  if (verbatimCount === 0) return "summarized";
  if (verbatimCount === messages.length) return "verbatim";
  return "mixed";
}

function messagePayload(
  messages: ChatExportInput["messages"]
): Array<{ role: string; summary: string; verbatim: string | null }> {
  return messages.map((m) => ({
    role: m.role,
    summary: m.summary,
    verbatim: m.verbatim ?? null,
  }));
}

async function profilesById(userIds: string[]): Promise<Map<string, ProfileRef>> {
  const unique = [...new Set(userIds)];
  const profiles = await repo.fetchProfiles(unique);
  return new Map(profiles.map((p) => [p.id, p]));
}
