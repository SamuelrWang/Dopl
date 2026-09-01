import type { Chat, ChatDetail, ChatFolder } from "../types";
import type { ChatScope } from "../scope";

/**
 * Pure half of the chats optimistic layer: unsaved-folder shape, scope→cache
 * mapping, and how each of the three chat caches absorbs a write. No React,
 * no DOM, no net.
 *
 * ⚠ CACHE SHAPES ARE THE RAW RESPONSE BODIES. `useApiQuery` stores what the
 * endpoint returned and applies `select` on read, so patch
 * `{ chats, hiddenCount }` / `{ folders }` / `{ chat }`, never the selected
 * array or the selected `ChatDetail`.
 */

export interface ChatListCache {
  chats: Chat[];
  hiddenCount: number;
  /**
   * ⚠ OPTIONAL HERE AND REQUIRED ON THE WIRE (`types.ts › ChatList`), and the
   * difference is the point: this type describes a CACHE ENTRY, which may have
   * been written by a bundle that predates the key (INVARIANTS §8 — the query
   * cache is IndexedDB-persisted with a 24h `gcTime`). Every reader spells
   * `?? false`.
   */
  truncated?: boolean;
}
export interface ChatFoldersCache {
  folders: ChatFolder[];
}
/** Transcript read: one chat's full document under `chat`. */
export interface ChatDetailCache {
  chat: ChatDetail;
}

/** The sharing columns a scope resolves to — the CACHE spelling. */
export interface ScopeFields {
  visibility: Chat["visibility"];
  accessMode: Chat["accessMode"];
  grantedTeamIds: string[];
}

/** The sharing patch a scope resolves to — the WIRE spelling. */
export interface ScopeBody {
  visibility: Chat["visibility"];
  accessMode?: Chat["accessMode"];
  teamIds?: string[];
}

/** ⚠ ONE scope→columns mapping for both request body and optimistic patch,
 *  so screen and server row can't drift. Mirrors `updateChatForUser`:
 *  anything not public+teams lands on `access_mode: 'workspace'` with an
 *  empty grant set (grants are replace-set). */
export function scopeFields(scope: ChatScope, teamIds: string[]): ScopeFields {
  if (scope === "team") {
    return {
      visibility: "public",
      accessMode: "teams",
      grantedTeamIds: teamIds,
    };
  }
  return {
    visibility: scope === "private" ? "private" : "public",
    accessMode: "workspace",
    grantedTeamIds: [],
  };
}

export function scopeBody(scope: ChatScope, teamIds: string[]): ScopeBody {
  if (scope === "private") return { visibility: "private" };
  if (scope === "team") {
    return { visibility: "public", accessMode: "teams", teamIds };
  }
  return { visibility: "public", accessMode: "workspace" };
}

/** Marks a row that exists only in this client's cache. */
export const PENDING_ID_PREFIX = "pending:";

/** True for a row the server has not acknowledged yet. */
export function isPendingId(id: string): boolean {
  return id.startsWith(PENDING_ID_PREFIX);
}

/** Id an optimistic folder carries until the server names it. ⚠ Mint ONCE at
 *  submit and carry it in the draft — never re-derive inside a patch, or
 *  `reconcile` can't find the row `optimistic` added when a second name was
 *  typed while the first POST was in flight. */
export function pendingFolderId(): string {
  const cryptoRef = globalThis.crypto;
  const token = cryptoRef?.randomUUID
    ? cryptoRef.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${PENDING_ID_PREFIX}${token}`;
}

export function buildPendingFolder(id: string, name: string): ChatFolder {
  return {
    id,
    name,
    // New folders are born private with no grants (`insertFolder` takes only
    // a name); reconcile replaces the whole row from the server's answer.
    visibility: "private",
    accessMode: "workspace",
    grantedTeamIds: [],
  };
}

/** Folders render alphabetically; every insert re-sorts rather than appends. */
function sortFolders(folders: ChatFolder[]): ChatFolder[] {
  return [...folders].sort((a, b) => a.name.localeCompare(b.name));
}

export function addFolderRow(
  cache: ChatFoldersCache | undefined,
  folder: ChatFolder
): ChatFoldersCache | undefined {
  // ⚠ DECLINE TO SEED. No data = read still in flight; a one-row list here
  // renders an archive of one folder until the landing read replaces it.
  if (!cache) return cache;
  return { ...cache, folders: sortFolders([...cache.folders, folder]) };
}

/** Put `folder` in the list, replacing `replaceId` if given. Create swaps its
 *  pending twin (by the id minted at submit); re-scope replaces in place. */
export function upsertFolderRow(
  cache: ChatFoldersCache | undefined,
  folder: ChatFolder,
  replaceId?: string
): ChatFoldersCache | undefined {
  if (!cache) return cache;
  const dropId = replaceId ?? folder.id;
  const kept = cache.folders.filter(
    (f) => f.id !== dropId && f.id !== folder.id
  );
  return { ...cache, folders: sortFolders([...kept, folder]) };
}

/** Merge fields into one chat row; a miss is a no-op, never an append. */
export function patchChatRow(
  cache: ChatListCache | undefined,
  chatId: string,
  fields: Partial<Chat>
): ChatListCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    chats: cache.chats.map((c) => (c.id === chatId ? { ...c, ...fields } : c)),
  };
}

/** Reconcile from a PATCH's answer. */
export function replaceChatRow(
  cache: ChatListCache | undefined,
  chat: Chat
): ChatListCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    chats: cache.chats.map((c) => (c.id === chat.id ? { ...c, ...chat } : c)),
  };
}

export function removeChatRow(
  cache: ChatListCache | undefined,
  chatId: string
): ChatListCache | undefined {
  if (!cache) return cache;
  return { ...cache, chats: cache.chats.filter((c) => c.id !== chatId) };
}

/** Client half of the server's fan-out: mirror a folder's authoritative
 *  scope onto every chat filed in it. */
export function applyFolderScopeToChats(
  cache: ChatListCache | undefined,
  folderId: string,
  fields: ScopeFields
): ChatListCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    chats: cache.chats.map((c) =>
      c.folderId === folderId ? { ...c, ...fields } : c
    ),
  };
}

/** Merge header fields into the cached TRANSCRIPT. ⚠ MERGE, NEVER REPLACE: a
 *  chat PATCH answers with the LIST-level `Chat`, which has no `messages` —
 *  assigning it would evict the transcript on a pin toggle. */
export function mergeChatDetail(
  cache: ChatDetailCache | undefined,
  fields: Partial<Chat>
): ChatDetailCache | undefined {
  if (!cache) return cache;
  return { ...cache, chat: { ...cache.chat, ...fields } };
}
