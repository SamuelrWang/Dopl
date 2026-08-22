"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  patchCache,
  useApiMutationWith,
  type MutationGate,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { channelRequest } from "../client/api";
import { channelKeys, channelThreadPath } from "../client/query-keys";
import {
  dropThread,
  dropThreadMessages,
  upsertThread,
  type MessagesCache,
  type ThreadsCache,
} from "../lib/optimistic-cache";
import { failed, messagesKey, threadsKey } from "./use-thread-writes-shared";
import type { ChannelThread, ThreadMode } from "../types";

/**
 * THE THREAD'S OWN LIFECYCLE WRITES — set mode, and DELETE (Samuel, 2026-08-21).
 * The two writes behind the right panel's Settings tab while a thread is open
 * (`components/channels-v2/thread-settings-tab.tsx`).
 *
 * ⚠ SEPARATE FROM `use-thread-writes.ts`, which is the SEND family (send, open a
 * thread, fan out) — the flagship optimistic path, keyed on a `clientMsgId` and
 * built around a pending row that gets reconciled. Nothing here mints an
 * idempotency key or renders a pending anything: these address a thread that
 * already exists, by id. Two reasons to change, two files (INVARIANTS §1); the
 * shared plumbing (`ThreadWritesParams`, the two per-channel keys, `failed`)
 * comes from `use-thread-writes-shared.ts` so no key is written twice — a key
 * that differs by one element is a silent no-op (§8).
 *
 * ⚠ THIS IS NOT THREAD CLOSING COMING BACK. A thread still has no finished state
 * on any surface (INVARIANTS §5): there is no `close`, no outcome, no reopen and
 * no `status` write anywhere below. `remove` makes a thread STOP EXISTING, which
 * is a different verb.
 *
 * ⚠ BOTH CONFIGS CARRY `settleWith: gate` — the same `useRefetchGate` gate every
 * other write on the surface holds, or the realtime doorbell's refetch lands
 * mid-write and reverts the optimistic patch under the click that set it
 * (INVARIANTS §7/§8).
 */

export interface ThreadModeDraft {
  /** Captured at the click; never re-read from the selection. */
  channelId: string;
  threadId: string;
  mode: ThreadMode;
}

export interface ThreadDeleteDraft {
  channelId: string;
  threadId: string;
}

export interface ThreadLifecycleParams {
  workspaceId: string;
  /** Holds realtime refetches open for the life of each write. ⚠ REQUIRED, not
   *  optional — a config buildable without a gate re-opens the race where some
   *  writes are protected and some are not. */
  gate: MutationGate;
  /** The deleted thread must not stay selected — the caller clears it. */
  onDeleted: (threadId: string) => void;
}

/** What the failure path needs on top: the client it re-reads through. Same
 *  shape as `use-thread-writes-shared.ts › ThreadWriteDeps`, and for the same
 *  reason — the config is a pure function of its deps so a test can build one. */
export interface ThreadLifecycleDeps extends ThreadLifecycleParams {
  client: QueryClient;
}

/**
 * ⚠ Exported APART from the hook so the suite can drive them through TanStack's
 * own `MutationObserver` — the same reason `use-thread-writes.ts` exports its
 * configs. `npm test` has no DOM, and onMutate → mutationFn → onSuccess/onError →
 * onSettled IS the contract.
 */
export function setThreadModeConfig(
  deps: ThreadLifecycleDeps
): UseApiMutationConfig<ThreadModeDraft, { task: ChannelThread }> {
  return {
    request: (draft) => ({
      path: channelThreadPath(draft.channelId, draft.threadId),
      method: "PATCH",
      workspaceId: deps.workspaceId,
      // BOUNDARY: the wire op keeps the storage spelling (`set_mode`), the
      // surface says "mode". `schema.ts › TaskUpdateSchema` is a discriminated
      // union with exactly this one arm.
      body: { op: "set_mode", mode: draft.mode },
    }),
    // The radio lights on the click rather than after the round trip. ⚠ The row
    // is patched, never appended — `upsertThread` maps over a row that EXISTS, so
    // a thread missing from a cold list cache is not invented here.
    optimistic: (draft) =>
      patchCache<ThreadsCache>(threadsKey(draft.channelId), (cache) => {
        const current = cache?.tasks.find((t) => t.id === draft.threadId);
        if (!cache || !current) return cache;
        return upsertThread(cache, { ...current, mode: draft.mode });
      }),
    // PATCH answers with the stored thread, so the true `mode` / `updatedAt` land
    // without a read.
    reconcile: (data, draft) =>
      patchCache<ThreadsCache>(threadsKey(draft.channelId), (cache) =>
        upsertThread(cache, data.task)
      ),
    // ⚠ NOTHING IS INVALIDATED. `channel_tasks.updated_at` is not an activity
    // clock and the list is ordered off `channel_tasks_activity.last_activity_at`
    // (INVARIANTS §5, C-1), so a mode change moves no ordering and touches no
    // other read. Naming the thread list here would re-download it on every
    // click for a value the reconcile already has.
    settleWith: deps.gate,
    onError: (err) => failed(err, "Couldn't change the mode"),
  };
}

export function deleteThreadConfig(
  deps: ThreadLifecycleDeps
): UseApiMutationConfig<ThreadDeleteDraft, void> {
  return {
    request: (draft) => ({
      path: channelThreadPath(draft.channelId, draft.threadId),
      method: "DELETE",
      workspaceId: deps.workspaceId,
    }),
    // ⚠ BOTH CACHES, IN ONE PATCH LIST, because the server deletes both in one
    // call. Dropping the thread alone would leave its messages rendering in the
    // channel transcript under a card that no longer exists; dropping the
    // messages alone would leave an empty thread in the list. The two entries are
    // DISJOINT keys, so `onMutate` snapshots each once and a failure restores
    // both verbatim.
    optimistic: (draft) => [
      patchCache<ThreadsCache>(threadsKey(draft.channelId), (cache) =>
        dropThread(cache, draft.threadId)
      ),
      patchCache<MessagesCache>(messagesKey(draft.channelId), (cache) =>
        dropThreadMessages(cache, draft.threadId)
      ),
    ],
    // ⚠ DESELECT ON SUCCESS, NOT IN `optimistic`. The pane can survive a moment
    // showing a thread whose rows have gone; it cannot survive being navigated
    // away from a thread the server then refused to delete.
    //
    // ⚠ THERE IS NOTHING TO `removeQueries`. INVARIANTS §5's "deleting is a cache
    // eviction" rule bites when the deleted row has a query SUBTREE of its own
    // (the IndexedDB-persisted cache re-renders an invalidated entry across
    // relaunches). A thread has no per-thread query key — the transcript and the
    // thread list are per-CHANNEL entries that outlive it — so the two patches
    // above ARE the eviction.
    onSuccess: (_data, draft) => deps.onDeleted(draft.threadId),
    // The channel list carries `lastMessageAt` and the unread ordering, which
    // deleting a thread's transcript changes and this write cannot compute.
    //
    // ⚠ AND THE MENTIONS ENTRY, FOR THE SAME REASON THE TWO PATCHES ABOVE ARE A
    // PAIR (2026-08-22, F-253). The cascade hard-deletes the thread's messages,
    // and a mention row POINTS AT ONE — so the Tags inbox went on rendering rows
    // for messages that no longer exist, and clicking one scrolled to nothing.
    // It is INVALIDATED rather than patched because this write does not hold the
    // deleted message ids: the two optimistic patches drop them from the
    // transcript cache, which is precisely why nothing here can enumerate them
    // afterwards. A re-read is cheap on a surface the operator is not looking at.
    invalidate: (draft) => [
      channelKeys.list().all,
      channelKeys.mentions(draft.channelId).all,
    ],
    settleWith: deps.gate,
    // ⚠ The rollback restored a SNAPSHOT, which is a guess: a DELETE that timed
    // out after the cascade committed leaves the thread gone server-side while
    // the cache says it is back. Rare path, so re-reading both entries is cheap
    // insurance against a transcript that renders deleted rows until the next
    // doorbell.
    onError: (err, draft) => {
      failed(err, "Couldn't delete the thread");
      void deps.client.invalidateQueries({
        queryKey: threadsKey(draft.channelId),
      });
      void deps.client.invalidateQueries({
        queryKey: messagesKey(draft.channelId),
      });
      // ⚠ THE MENTIONS ENTRY IS DELIBERATELY NOT REPEATED HERE. `invalidate`
      // runs from `onSettled` (`use-api-mutation.ts › buildApiMutationOptions`),
      // which fires on the FAILURE path too — so naming it again would be a
      // second identical `invalidateQueries` on every failed delete. The two
      // above are needed because they are NOT in that list: they undo a rollback
      // that restored a snapshot, which is a different job.
    },
  };
}

export function useThreadLifecycleWrites(params: ThreadLifecycleParams) {
  const deps: ThreadLifecycleDeps = { ...params, client: useQueryClient() };
  // ⚠ Rebuilt every render on purpose — `useApiMutationWith` reads its config
  // through a ref, so these closures are always the current render's.
  const setMode = useApiMutationWith<ThreadModeDraft, { task: ChannelThread }>(
    channelRequest,
    setThreadModeConfig(deps)
  );
  const remove = useApiMutationWith<ThreadDeleteDraft, void>(
    channelRequest,
    deleteThreadConfig(deps)
  );
  return {
    setMode,
    remove,
    /** True while either write is in flight. */
    pending: setMode.pending || remove.pending,
  };
}
