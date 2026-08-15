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
 * The five chat writes. The query cache IS the state — no second copy.
 * Invalidation is explicit; re-downloading what you just reconciled undoes
 * the point. What each may invalidate:
 *  - `share` / `pin` / `createFolder` — nothing while warm; the response IS
 *    the row. ⚠ COLD CACHE exception: `optimistic` and `reconcile` both
 *    DECLINE on an entry with no data, so during cold start / IndexedDB
 *    restore the write lands server-side and never reaches the screen. Hence
 *    `coldKeys` (`@/shared/hooks/use-api-mutation`), which drops warm keys.
 *  - `remove` — LIST only, for `hiddenCount`: the retention window is computed
 *    server-side over surviving rows, so a delete can reveal an older chat
 *    this client cannot name. Transcript is EVICTED, not invalidated.
 *  - `folderScope` — the LIST: propagation is a per-chat server fan-out
 *    (unbounded N) that can partly apply or time out, and only the server
 *    knows which chats moved.
 * ⚠ Every patch is keyed by the id captured AT SUBMIT — ids ride in the draft
 * and per-chat keys embed them — so an in-flight write cannot land in the
 * cache of whatever the user selected meanwhile.
 */

export interface ChatWritesParams {
  workspaceId: string;
  gate: MutationGate;
  /** Restore selection when a DELETE is refused. Caller moves selection AT
   *  SUBMIT — the row leaves the list on click, so waiting for the response
   *  would point the selection at a chat the user can't see. */
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
   * ⚠ Pin is a pure toggle, so the optimistic patch is correctness, not
   * latency: the button reads `pinned` from the cache this patches, so a
   * second click computes from the first click's result instead of resending
   * the same PATCH. `pending` keeps the control inert for the round trip.
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
   * ⚠ DELETE is a cache EVICTION, not an invalidation. Chat is permanently
   * gone, so no refetch makes the transcript valid again — an invalidated
   * entry re-requests a 404, and `useChatDetail` prefers cached data over its
   * own error, so a re-selected dead chat would render in full.
   * ⚠ Eviction runs in `onSuccess`, never `optimistic`: a rejected DELETE
   * restores the list row from the snapshot and needs the transcript still
   * there. `removeQueries` is outside the snapshot and cannot be rolled back.
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
   * ⚠ Duplicate-POST guard needs both halves: `list-pane.tsx` clears the
   * input AT submit so a repeated Enter has no draft to re-fire, and the
   * pending row here gives the feedback that made the second Enter feel
   * necessary.
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
      // List unconditionally (fan-out); folders only when its reconcile had
      // nowhere to land — same cold window.
      invalidate: () => [listKey, ...coldKeys(qc, [foldersKey])],
      settleWith: gate,
      onError: (err) => failed(err, "Couldn't update folder"),
    }
  );

  return { share, pin, remove, createFolder, folderScope };
}
