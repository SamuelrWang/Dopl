import "server-only";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import {
  deleteGrantsForResource,
  insertReadGrantsIfMissing,
  listGrantsForResources,
  listTeamIdsForUser,
} from "@/features/teams/server/repository";
import type { Chat, ChatDetail, ChatFolder, ExportFormat } from "../types";
import type {
  ChatAppendInput,
  ChatExportInput,
  ChatFolderUpdateInput,
  ChatUpdateInput,
} from "../schema";
import {
  ChatFolderConflictError,
  ChatFolderNotFoundError,
  ChatFolderScopeError,
  ChatForbiddenError,
  ChatNotFoundError,
} from "./errors";
import { mapChatRow, mapFolderRow, mapMessageRow, mapOwner } from "./dto";
import type { ChatFolderRow, ChatRow, ProfileRef } from "./dto";
import * as repo from "./repository";

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

const UNIQUE_VIOLATION = "23505";

// ─── Reads ──────────────────────────────────────────────────────────

/** Everything the caller may read: own chats, workspace-shared ones, and
 *  team-scoped ones granted to one of the caller's teams. */
export async function listChats(ctx: ChatContext): Promise<Chat[]> {
  const rows = await repo.listVisibleChats(ctx.workspaceId, ctx.userId);
  const grants = await grantsForRows(ctx, rows);
  const visible = rows.filter((row) => canSeeChat(ctx, row, grants));
  const profiles = await profilesById(visible.map((r) => r.owner_id));
  return visible.map((row) =>
    withFolderPrivacy(
      ctx,
      row,
      mapChatRow(
        row,
        mapOwner(row.owner_id, profiles.get(row.owner_id)),
        repo.countOf(row),
        grantedTeamIdsFor(ctx, row, grants.byChat)
      )
    )
  );
}

export async function getChat(ctx: ChatContext, chatId: string): Promise<ChatDetail> {
  const row = await repo.findChatById(ctx.workspaceId, chatId);
  if (!row) throw new ChatNotFoundError(chatId);
  const grants = await grantsForRows(ctx, [row]);
  if (!canSeeChat(ctx, row, grants)) throw new ChatNotFoundError(chatId);
  const [messages, profiles] = await Promise.all([
    repo.listMessages(chatId),
    profilesById([row.owner_id]),
  ]);
  return {
    ...withFolderPrivacy(
      ctx,
      row,
      mapChatRow(
        row,
        mapOwner(row.owner_id, profiles.get(row.owner_id)),
        messages.length,
        grantedTeamIdsFor(ctx, row, grants.byChat)
      )
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
  // Filing into a folder means inheriting the folder's sharing — the
  // folder's scope is authoritative, so any caller-passed visibility is
  // superseded when a folder is named.
  const folderRow = input.folder
    ? await resolveOrCreateFolderRow(ctx, input.folder)
    : null;
  const folderId = folderRow?.id ?? null;
  const inherited = folderRow
    ? { visibility: folderRow.visibility, access_mode: folderRow.access_mode }
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
      ...(folderId ? { folder_id: folderId, ...inherited } : {}),
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
        ...(inherited ?? {}),
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
        ...(folderId ? { folder_id: folderId, ...inherited } : {}),
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

  // Inheritance covers grants too: a chat filed into a team-scoped
  // folder gets the folder's team grant set (replace-set).
  if (folderRow) {
    await syncChatGrantsToFolder(ctx, chat.id, folderRow);
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

  // Resolve the folder move first — inheritance and the filed-chat
  // sharing guard both depend on where the chat ends up.
  let folderPatch: { folder_id: string | null } | undefined;
  let targetFolder: ChatFolderRow | null = null;
  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) {
      targetFolder = await repo.findFolderById(ctx.workspaceId, ctx.userId, patch.folderId);
      if (!targetFolder) throw new ChatFolderNotFoundError(patch.folderId);
    }
    folderPatch = { folder_id: patch.folderId };
  } else if (patch.folder !== undefined) {
    if (patch.folder !== null) {
      targetFolder = await resolveOrCreateFolderRow(ctx, patch.folder);
    }
    folderPatch = { folder_id: targetFolder?.id ?? null };
  }

  // Filed chats inherit their folder's sharing — a direct visibility
  // change is rejected unless this same patch unfiles the chat. (The
  // schema already blocks visibility combined with filing INTO a folder.)
  if (
    patch.visibility !== undefined &&
    chat.folder_id !== null &&
    !(folderPatch && folderPatch.folder_id === null)
  ) {
    const currentFolder = await repo.findFolderById(
      ctx.workspaceId,
      ctx.userId,
      chat.folder_id
    );
    throw new ChatFolderScopeError(currentFolder?.name ?? "its folder");
  }

  // Sharing scope. Going team-scoped replaces the grant set wholesale;
  // any other scope drops all grants. Non-admin owners may only grant
  // teams they belong to (plus already-granted teams, which the share
  // UI renders locked) — mirrors the KB rule. Moving into a folder
  // instead inherits the folder's scope + grants.
  let sharingPatch: { visibility?: string; access_mode?: string } = {};
  let grantTeamIds: string[] | null = null;
  if (targetFolder) {
    sharingPatch = {
      visibility: targetFolder.visibility,
      access_mode: targetFolder.access_mode,
    };
  } else if (patch.visibility !== undefined) {
    const wantsTeams = patch.visibility === "public" && patch.accessMode === "teams";
    sharingPatch = {
      visibility: patch.visibility,
      access_mode: wantsTeams ? "teams" : "workspace",
    };
    if (wantsTeams) {
      grantTeamIds = [...new Set(patch.teamIds ?? [])];
      const isAdmin = ctx.role !== null && meetsMinRole(ctx.role, "admin");
      if (!isAdmin && grantTeamIds.length > 0) {
        const [myTeams, existing] = await Promise.all([
          listTeamIdsForUser(ctx.workspaceId, ctx.userId),
          listGrantsForResources(ctx.workspaceId, "chat", [chat.id]),
        ]);
        const allowed = new Set([...myTeams, ...existing.map((g) => g.teamId)]);
        if (grantTeamIds.some((id) => !allowed.has(id))) {
          throw new ChatForbiddenError("grant teams you don't belong to");
        }
      }
    }
  }

  const row = await repo.updateChat(chat.id, {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.overview !== undefined ? { overview: patch.overview } : {}),
    ...(patch.project !== undefined ? { project: patch.project } : {}),
    ...(patch.sessionDate !== undefined ? { session_date: patch.sessionDate } : {}),
    ...sharingPatch,
    ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
    ...(patch.deliverables !== undefined ? { deliverables: patch.deliverables } : {}),
    ...(patch.learnings !== undefined ? { learnings: patch.learnings } : {}),
    ...(folderPatch ?? {}),
  });

  if (targetFolder) {
    // Inheritance covers grants too — the chat adopts the folder's set.
    await syncChatGrantsToFolder(ctx, chat.id, targetFolder);
  } else if (patch.visibility !== undefined) {
    // Replace-set semantics: clear, then re-insert the new grant set.
    await deleteGrantsForResource(ctx.workspaceId, "chat", chat.id);
    if (grantTeamIds && grantTeamIds.length > 0) {
      await insertReadGrantsIfMissing(ctx.workspaceId, "chat", chat.id, grantTeamIds);
    }
  }

  const [count, profiles] = await Promise.all([
    repo.countMessages(row.id),
    profilesById([row.owner_id]),
  ]);
  // Keep the returned grant set honest even when sharing wasn't touched.
  const teamIds =
    grantTeamIds ??
    (row.access_mode === "teams"
      ? (await listGrantsForResources(ctx.workspaceId, "chat", [row.id])).map(
          (g) => g.teamId
        )
      : []);
  return mapChatRow(
    row,
    mapOwner(row.owner_id, profiles.get(row.owner_id)),
    count,
    teamIds
  );
}

export async function deleteChat(ctx: ChatContext, chatId: string): Promise<void> {
  const chat = await requireOwnChat(ctx, chatId, "delete it");
  await repo.deleteChat(chat.id);
}

// ─── Folders ────────────────────────────────────────────────────────

export async function listFolders(ctx: ChatContext): Promise<ChatFolder[]> {
  const rows = await repo.listFolders(ctx.workspaceId, ctx.userId);
  const teamScoped = rows.filter((r) => r.access_mode === "teams");
  const byFolder = new Map<string, string[]>();
  if (teamScoped.length > 0) {
    const grants = await listGrantsForResources(
      ctx.workspaceId,
      "chat_folder",
      teamScoped.map((r) => r.id)
    );
    for (const g of grants) {
      byFolder.set(g.resourceId, [...(byFolder.get(g.resourceId) ?? []), g.teamId]);
    }
  }
  return rows.map((row) => mapFolderRow(row, byFolder.get(row.id) ?? []));
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

/**
 * Rename and/or re-scope a folder. The folder's scope is authoritative,
 * so a scope change propagates to every chat filed in it: sharing
 * columns are aligned and each chat's grant set is replaced with the
 * folder's. Team-grant permission mirrors the chat rule (non-admins
 * grant only teams they belong to, plus already-granted ones).
 */
export async function updateFolderForUser(
  ctx: ChatContext,
  folderId: string,
  patch: ChatFolderUpdateInput
): Promise<ChatFolder> {
  const folder = await repo.findFolderById(ctx.workspaceId, ctx.userId, folderId);
  if (!folder) throw new ChatFolderNotFoundError(folderId);

  let sharingPatch: { visibility?: string; access_mode?: string } = {};
  let grantTeamIds: string[] | null = null;
  if (patch.visibility !== undefined) {
    const wantsTeams = patch.visibility === "public" && patch.accessMode === "teams";
    sharingPatch = {
      visibility: patch.visibility,
      access_mode: wantsTeams ? "teams" : "workspace",
    };
    if (wantsTeams) {
      grantTeamIds = [...new Set(patch.teamIds ?? [])];
      const isAdmin = ctx.role !== null && meetsMinRole(ctx.role, "admin");
      if (!isAdmin && grantTeamIds.length > 0) {
        const [myTeams, existing] = await Promise.all([
          listTeamIdsForUser(ctx.workspaceId, ctx.userId),
          listGrantsForResources(ctx.workspaceId, "chat_folder", [folder.id]),
        ]);
        const allowed = new Set([...myTeams, ...existing.map((g) => g.teamId)]);
        if (grantTeamIds.some((id) => !allowed.has(id))) {
          throw new ChatForbiddenError("grant teams you don't belong to");
        }
      }
    }
  }

  let row: ChatFolderRow;
  try {
    row = await repo.updateFolder(folder.id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...sharingPatch,
    });
  } catch (err) {
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      throw new ChatFolderConflictError(patch.name ?? folder.name);
    }
    throw err;
  }

  if (patch.visibility !== undefined) {
    // Folder grants are replace-set, then the scope + grants propagate
    // to every filed chat so the invariant holds.
    await deleteGrantsForResource(ctx.workspaceId, "chat_folder", row.id);
    if (grantTeamIds && grantTeamIds.length > 0) {
      await insertReadGrantsIfMissing(
        ctx.workspaceId,
        "chat_folder",
        row.id,
        grantTeamIds
      );
    }
    await repo.updateChatsScopeInFolder(row.id, row.visibility, row.access_mode);
    const chatIds = await repo.listChatIdsInFolder(row.id);
    for (const chatId of chatIds) {
      await deleteGrantsForResource(ctx.workspaceId, "chat", chatId);
      if (grantTeamIds && grantTeamIds.length > 0) {
        await insertReadGrantsIfMissing(ctx.workspaceId, "chat", chatId, grantTeamIds);
      }
    }
  }

  return mapFolderRow(row, grantTeamIds ?? (await folderGrantIds(ctx, row)));
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
async function grantsForRows(
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
function canSeeChat(ctx: ChatContext, chat: ChatRow, grants: GrantCtx): boolean {
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
function grantedTeamIdsFor(
  ctx: ChatContext,
  row: ChatRow,
  byChat: Map<string, string[]>
): string[] {
  if (row.access_mode !== "teams") return [];
  const isAdmin = ctx.role !== null && meetsMinRole(ctx.role, "admin");
  if (row.owner_id !== ctx.userId && !isAdmin) return [];
  return byChat.get(row.id) ?? [];
}

async function requireOwnChat(
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
function withFolderPrivacy(ctx: ChatContext, row: ChatRow, chat: Chat): Chat {
  if (row.owner_id === ctx.userId) return chat;
  return { ...chat, folderId: null };
}

async function resolveOrCreateFolderRow(
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
async function folderGrantIds(
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
async function syncChatGrantsToFolder(
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
