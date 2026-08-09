import type { Chat, ChatDetail, ChatFolder } from "../types";
import type { ChatScope } from "../scope";

/**
 * The pure half of the chats optimistic layer: what an unsaved folder looks
 * like, what a scope change means in cache terms, and how each of the three
 * chat caches absorbs a write.
 *
 * Split from the hooks so every rule here is testable with no React, no DOM
 * and no network — these are the rules that decide whether a delete leaves a
 * ghost row behind and whether a folder re-scope shows the right pill before
 * the server answers.
 *
 * THE CACHE SHAPES ARE THE RAW RESPONSE BODIES. `useApiQuery` stores what the
 * endpoint returned and applies `select` on read, so a patch operates on
 * `{ chats, hiddenCount }` / `{ folders }` / `{ chat }`, never on the selected
 * array or the selected `ChatDetail`.
 */

export interface ChatListCache {
  chats: Chat[];
  hiddenCount: number;
}
export interface ChatFoldersCache {
  folders: ChatFolder[];
}
/** The transcript read: one chat's full document under `chat`. */
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

/**
 * ONE scope→columns mapping, used by the request body and the optimistic
 * patch alike, so the guess on screen and the row the server writes cannot
 * drift. It mirrors `updateChatForUser` exactly: anything that is not
 * public+teams lands on `access_mode: 'workspace'` with an empty grant set
 * (grants are replace-set, and a private chat keeps none).
 */
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

/**
 * The id an optimistic folder carries until the server names it.
 *
 * Minted ONCE, at submit, and carried in the draft — never re-derived inside
 * a patch. That is what lets `reconcile` find the exact row `optimistic`
 * added, even after the user has typed a second folder name into the same
 * input while the first POST is still in flight.
 */
export function pendingFolderId(): string {
  const cryptoRef = globalThis.crypto;
  const token = cryptoRef?.randomUUID
    ? cryptoRef.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${PENDING_ID_PREFIX}${token}`;
}

/** The folder row the list renders one frame after Enter. */
export function buildPendingFolder(id: string, name: string): ChatFolder {
  return {
    id,
    name,
    // A new folder is born private with no grants (`insertFolder` takes only a
    // name); the reconcile replaces the whole row from the server's answer.
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
  // DECLINE TO SEED. A cache with no data is a read still in flight; writing
  // a one-row list here would render an archive with one folder in it and
  // then have the landing read replace it.
  if (!cache) return cache;
  return { ...cache, folders: sortFolders([...cache.folders, folder]) };
}

/**
 * Put `folder` in the list, replacing `replaceId` if given. Used by both
 * reconciles: a create swaps its pending twin for the saved row (by the id
 * minted at submit), a re-scope replaces the row in place.
 */
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

/** Replace one chat row wholesale — the reconcile from a PATCH's answer. */
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

/**
 * Mirror a folder's authoritative scope onto every chat filed in it — the
 * client half of the server's fan-out, so the pills in the list flip with the
 * folder's own rather than one round trip later.
 */
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

/**
 * Merge header fields into the cached TRANSCRIPT.
 *
 * MERGE, NEVER REPLACE: a chat PATCH answers with the LIST-level `Chat`, which
 * has no `messages`. Assigning that response into this cache would evict a
 * 200-message transcript on a pin toggle and make the next selection re-read
 * it — the exact re-download the mutation layer exists to stop.
 */
export function mergeChatDetail(
  cache: ChatDetailCache | undefined,
  fields: Partial<Chat>
): ChatDetailCache | undefined {
  if (!cache) return cache;
  return { ...cache, chat: { ...cache.chat, ...fields } };
}
