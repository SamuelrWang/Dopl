"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  coldKeys,
  patchCache,
  useApiMutationWith,
  type MutationGate,
} from "@/shared/hooks/use-api-mutation";
import { toast } from "@/shared/ui/toast";
import { ChatApiError, chatRequest } from "../client/api";
import {
  CHAT_FOLDERS_PATH,
  chatFolderPath,
  chatKeys,
  chatPath,
} from "../client/query-keys";
import {
  addFolderRow,
  applyFolderScopeToChats,
  buildPendingFolder,
  mergeChatDetail,
  patchChatRow,
  removeChatRow,
  replaceChatRow,
  scopeBody,
  scopeFields,
  upsertFolderRow,
  type ChatDetailCache,
  type ChatFoldersCache,
  type ChatListCache,
} from "../lib/optimistic-cache";
import type { Chat, ChatFolder } from "../types";
import type { ChatScope } from "../scope";

/**
 * THE FIVE CHAT WRITES, moved off `setBusy(true); await api(); setState(…)`.
 *
 * Every one of them used to patch AFTER the await — the star filled a network
 * hop after the click, the folder appeared after a round trip, and the deleted
 * row lingered until the DELETE answered. Worse, each wrote its result into
 * `ChatsView`'s `useState` copy of the list, which the query cache underneath
 * never learned about: two sources of truth, the second one authoritative for
 * exactly as long as the component stayed mounted.
 *
 * Now each write is one config, and the cache IS the state.
 *
 * WHAT EACH ONE MAY AND MAY NOT INVALIDATE (rule 1 — invalidation is
 * explicit, and re-downloading what you just reconciled undoes the point):
 *
 *  - `share` / `pin` — nothing on a warm cache. The PATCH answers with the
 *    whole updated `Chat`; the list row IS that answer, and ordering does not
 *    change. The COLD CACHE is the only exception: `optimistic` and `reconcile`
 *    both DECLINE on an entry with no data — there is no list to patch a row
 *    into, no folder array to insert one — so during a cold start or the
 *    IndexedDB restore window the write lands SERVER-SIDE and never reaches the
 *    screen, invisibly (`chats-view` falls back to `initialChats`, so the
 *    surface renders fully, showing the pre-write truth). Every write below
 *    therefore names its keys through `coldKeys` (`@/shared/hooks/
 *    use-api-mutation`, shared with the channels send since F-178), which drops
 *    the keys that are already warm.
 *  - `remove` — the LIST only, and only for `hiddenCount`: the free-plan
 *    retention window is a server computation over the rows that survive, so
 *    deleting one can reveal an older chat this client cannot name. The
 *    transcript is not invalidated but EVICTED (see below).
 *  - `createFolder` — nothing on a warm cache. The POST answers with the
 *    created folder.
 *  - `folderScope` — the LIST, because the propagation is a per-chat server
 *    fan-out (one grant rewrite per filed chat, unbounded N) that can partly
 *    apply or time out. The mirrored rows here are a good guess, not an
 *    answer, and only the server knows which chats actually moved.
 *
 * EVERY PATCH IS KEYED BY THE ID CAPTURED AT SUBMIT (rule 4). The ids ride in
 * the draft and the per-chat keys embed them in their path, so a write cannot
 * land in the cache of whatever the user selected while it was in flight.
 */

export interface ChatWritesParams {
  workspaceId: string;
  gate: MutationGate;
  /**
   * Put the selection back on a chat whose DELETE was refused. The caller
   * moves the selection AT SUBMIT — the row leaves the list on the click, so
   * a selection that waited for the response would spend the round trip
   * pointing at a chat the user can no longer see.
   */
  onDeleteFailed: (chatId: string) => void;
}

export interface ChatScopeDraft {
  chatId: string;
  scope: ChatScope;
  teamIds: string[];
}
export interface PinDraft {
  chatId: string;
  pinned: boolean;
}
export interface DeleteDraft {
  chatId: string;
}
export interface CreateFolderDraft {
  /** Minted at submit so the reconcile can find this exact pending row. */
  tempId: string;
  name: string;
}
export interface FolderScopeDraft {
  folderId: string;
  scope: ChatScope;
  teamIds: string[];
}

function failed(err: unknown, fallback: string) {
  toast({ title: err instanceof ChatApiError ? err.message : fallback });
}

export function useChatWrites({
  workspaceId,
  gate,
  onDeleteFailed,
}: ChatWritesParams) {
  const qc = useQueryClient();
  const listKey = chatKeys.list().all;
  const foldersKey = chatKeys.folders().all;

  const share = useApiMutationWith<ChatScopeDraft, { chat: Chat }>(
    chatRequest,
    {
      request: (draft) => ({
        path: chatPath(draft.chatId),
        method: "PATCH",
        workspaceId,
        body: scopeBody(draft.scope, draft.teamIds),
      }),
      optimistic: (draft) => {
        const fields = scopeFields(draft.scope, draft.teamIds);
        return [
          patchCache<ChatListCache>(listKey, (cache) =>
            patchChatRow(cache, draft.chatId, fields)
          ),
          patchCache<ChatDetailCache>(
            chatKeys.detail(draft.chatId).all,
            (cache) => mergeChatDetail(cache, fields)
          ),
        ];
      },
      reconcile: (data, draft) => [
        patchCache<ChatListCache>(listKey, (cache) =>
          replaceChatRow(cache, data.chat)
        ),
        patchCache<ChatDetailCache>(chatKeys.detail(draft.chatId).all, (cache) =>
          mergeChatDetail(cache, data.chat)
        ),
      ],
      invalidate: (draft) =>
        coldKeys(qc, [listKey, chatKeys.detail(draft.chatId).all]),
      settleWith: gate,
      onError: (err) => failed(err, "Update failed"),
    }
  );

  /**
   * Pin is a PURE TOGGLE, and the reason it needs an optimistic patch is not
   * latency alone: the button used to render the server's value, so two quick
   * clicks read the same stale `pinned` and sent the SAME PATCH twice. The
   * star now flips in the cache the button reads from, so the second click
   * computes from the first click's result — and `pending` makes the control
   * inert for the round trip, which is what actually stops two conflicting
   * PATCHes from racing to decide the row.
   */
  const pin = useApiMutationWith<PinDraft, { chat: Chat }>(chatRequest, {
    request: (draft) => ({
      path: chatPath(draft.chatId),
      method: "PATCH",
      workspaceId,
      body: { pinned: draft.pinned },
    }),
    optimistic: (draft) => [
      patchCache<ChatListCache>(listKey, (cache) =>
        patchChatRow(cache, draft.chatId, { pinned: draft.pinned })
      ),
      patchCache<ChatDetailCache>(chatKeys.detail(draft.chatId).all, (cache) =>
        mergeChatDetail(cache, { pinned: draft.pinned })
      ),
    ],
    reconcile: (data, draft) => [
      patchCache<ChatListCache>(listKey, (cache) =>
        replaceChatRow(cache, data.chat)
      ),
      patchCache<ChatDetailCache>(chatKeys.detail(draft.chatId).all, (cache) =>
        mergeChatDetail(cache, data.chat)
      ),
    ],
    invalidate: (draft) =>
      coldKeys(qc, [listKey, chatKeys.detail(draft.chatId).all]),
    settleWith: gate,
    onError: (err) => failed(err, "Update failed"),
  });

  /**
   * DELETE IS A CACHE EVICTION, not an invalidation. The chat is permanently
   * gone (no trash, no restore since 2026-08-07), so no refetch can ever make
   * the transcript entry valid again — an invalidated one would re-request a
   * 404, and `useChatDetail` prefers cached data over its own error, so the
   * dead chat would render in full if the row were ever re-selected.
   *
   * The eviction runs in `onSuccess`, never in `optimistic`: a rejected DELETE
   * restores the list row from the snapshot, and the transcript beside it has
   * to still be there when it does. `removeQueries` is outside the snapshot
   * mechanism entirely and cannot be rolled back.
   */
  const remove = useApiMutationWith<DeleteDraft, void>(chatRequest, {
    request: (draft) => ({
      path: chatPath(draft.chatId),
      method: "DELETE",
      workspaceId,
    }),
    optimistic: (draft) =>
      patchCache<ChatListCache>(listKey, (cache) =>
        removeChatRow(cache, draft.chatId)
      ),
    invalidate: () => [listKey],
    settleWith: gate,
    onSuccess: (_data, draft) => {
      qc.removeQueries({ queryKey: chatKeys.detail(draft.chatId).all });
    },
    onError: (err, draft) => {
      onDeleteFailed(draft.chatId);
      failed(err, "Delete failed");
    },
  });

  /**
   * The duplicate-POST fix has two halves and needs both. The input clears on
   * submit rather than after the await (`list-pane.tsx`), so a repeated Enter
   * has no draft left to re-fire; and the folder appears in the list AS a
   * pending row, so the user has the feedback that used to only arrive with
   * the response — which is what made the second Enter feel necessary.
   */
  const createFolder = useApiMutationWith<
    CreateFolderDraft,
    { folder: ChatFolder }
  >(chatRequest, {
    request: (draft) => ({
      path: CHAT_FOLDERS_PATH,
      method: "POST",
      workspaceId,
      body: { name: draft.name },
    }),
    optimistic: (draft) =>
      patchCache<ChatFoldersCache>(foldersKey, (cache) =>
        addFolderRow(cache, buildPendingFolder(draft.tempId, draft.name))
      ),
    reconcile: (data, draft) =>
      patchCache<ChatFoldersCache>(foldersKey, (cache) =>
        upsertFolderRow(cache, data.folder, draft.tempId)
      ),
    invalidate: () => coldKeys(qc, [foldersKey]),
    settleWith: gate,
    onError: (err) => failed(err, "Couldn't create folder"),
  });

  /** The folder's scope is authoritative — it re-scopes every chat inside. */
  const folderScope = useApiMutationWith<FolderScopeDraft, { folder: ChatFolder }>(
    chatRequest,
    {
      request: (draft) => ({
        path: chatFolderPath(draft.folderId),
        method: "PATCH",
        workspaceId,
        body: scopeBody(draft.scope, draft.teamIds),
      }),
      optimistic: (draft) => {
        const fields = scopeFields(draft.scope, draft.teamIds);
        return [
          patchCache<ChatFoldersCache>(foldersKey, (cache) => {
            const current = cache?.folders.find((f) => f.id === draft.folderId);
            if (!cache || !current) return cache;
            return upsertFolderRow(cache, { ...current, ...fields });
          }),
          patchCache<ChatListCache>(listKey, (cache) =>
            applyFolderScopeToChats(cache, draft.folderId, fields)
          ),
        ];
      },
      reconcile: (data) =>
        patchCache<ChatFoldersCache>(foldersKey, (cache) =>
          upsertFolderRow(cache, data.folder)
        ),
      // The list unconditionally (the fan-out above); the folders cache only
      // when its own reconcile had nowhere to land — same cold window.
      invalidate: () => [listKey, ...coldKeys(qc, [foldersKey])],
      settleWith: gate,
      onError: (err) => failed(err, "Couldn't update folder"),
    }
  );

  return { share, pin, remove, createFolder, folderScope };
}
