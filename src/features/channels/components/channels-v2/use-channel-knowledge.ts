"use client";

/**
 * THE KNOWLEDGE TAB'S DATA — three reads and one write, all of them on the
 * guest-floored channel lane (`knowledge-lane.ts`), so the same hooks serve the
 * operator's /home surface and a link-claimed guest's /c page unchanged.
 *
 * ⚠ THEY ARE MOUNTED BY THE TAB BODY, NOT BY `channel-surface-data.ts`. That
 * hook mounts for EVERY host the moment the surface renders; these three fire
 * only while the Knowledge tab is the open one, which is the same reason the
 * Settings tab's write hooks live behind its slot (INVARIANTS §5). A channel
 * with no grants costs one request, once, and only if somebody opens the tab.
 *
 * ⚠ NO `settleWith: gate`, DELIBERATELY. The rule it would satisfy exists
 * because the realtime doorbell refetches this surface's reads mid-write
 * (`live.ts` → `refetchAll` = channels, messages, members, threads, mentions),
 * and the entry PUT below touches NONE of those caches — the lane's keys are
 * not in the coordinator's set at all. Handing it a gate would state a
 * coordination that does not exist, and the next reader would believe it.
 */

import { useApiQuery } from "@/shared/hooks/use-api-query";
import {
  patchCache,
  useApiMutationWith,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { channelRequest } from "../../client/api";
import { failed } from "../../hooks/use-thread-writes-shared";
import {
  channelKnowledgeEntryPath,
  channelKnowledgeKeys,
  channelKnowledgeTreePath,
  channelKnowledgeBasesPath,
  selectGrantedBases,
  selectTree,
  type ChannelKnowledgeBases,
  type ChannelKnowledgeBasesBody,
  type ChannelKnowledgeEntryBody,
  type ChannelKnowledgeTree,
  type ChannelKnowledgeTreeBody,
} from "./knowledge-lane";

/** Stable identity for the not-yet-loaded case. */
const NO_BASES: ChannelKnowledgeBases = selectGrantedBases({});

/** The bases granted into this channel. `null` channelId disables the read. */
export function useChannelKnowledgeBases(
  channelId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<
    Partial<ChannelKnowledgeBasesBody>,
    ChannelKnowledgeBases
  >(channelId ? channelKnowledgeBasesPath(channelId) : null, {
    workspaceId,
    select: selectGrantedBases,
  });
  return {
    data: query.data ?? NO_BASES,
    loading: query.isLoading,
    failedToLoad: query.isError,
    refetch: query.refetch,
  };
}

/** One granted base's folders + entry metadata. `null` baseId disables it. */
export function useChannelKnowledgeTree(
  channelId: string,
  baseId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<
    Partial<ChannelKnowledgeTreeBody>,
    ChannelKnowledgeTree
  >(baseId ? channelKnowledgeTreePath(channelId, baseId) : null, {
    workspaceId,
    select: selectTree,
  });
  return {
    tree: query.data ?? null,
    loading: query.isLoading,
    failedToLoad: query.isError,
  };
}

/** ONE entry with its body. `null` entryId disables it. */
export function useChannelKnowledgeEntry(
  channelId: string,
  entryId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<ChannelKnowledgeEntryBody>(
    entryId ? channelKnowledgeEntryPath(channelId, entryId) : null,
    { workspaceId }
  );
  return {
    entry: query.data?.entry ?? null,
    loading: query.isLoading,
    failedToLoad: query.isError,
  };
}

/**
 * The guest edit (§3.4): body and/or title of ONE existing entry. No create, no
 * folders, no delete, no move — the route's schema is `.strict()` and would 400
 * on anything else, and Samuel's ruling 3 is what that schema encodes.
 */
export interface ChannelEntryEditDraft {
  entryId: string;
  /** Carried so the tree that LISTS this entry can be invalidated — a saved
   *  title moves the row the reader came from. */
  baseId: string;
  title?: string;
  body?: string;
  /**
   * The entry's `updatedAt` as the editor loaded it. ⚠ In the BODY on this
   * lane, not `X-Updated-At` (the workspace PATCH's shape); the CAS semantics
   * are identical, down to the 412 the server answers with.
   */
  expectedVersion?: string;
}

function entryEditConfig(deps: {
  channelId: string;
  workspaceId: string;
}): UseApiMutationConfig<ChannelEntryEditDraft, ChannelKnowledgeEntryBody> {
  return {
    request: (draft) => ({
      path: channelKnowledgeEntryPath(deps.channelId, draft.entryId),
      method: "PUT",
      workspaceId: deps.workspaceId,
      body: {
        title: draft.title,
        body: draft.body,
        expectedVersion: draft.expectedVersion,
      },
    }),
    // ⚠ NOT OPTIMISTIC. A 412 is a REAL outcome here — two people may hold this
    // entry open, and the workspace surface writes it too — so the screen must
    // show what the server accepted, not what was typed at it. `reconcile` is
    // the whole cache story: the response IS the saved row.
    reconcile: (data, draft) =>
      patchCache<ChannelKnowledgeEntryBody>(
        channelKnowledgeKeys.entry(deps.channelId, draft.entryId).all,
        () => ({ entry: data.entry })
      ),
    // The tree carries this entry's TITLE and `updatedAt` and cannot be
    // reconciled from a single-entry response without re-deriving its order.
    invalidate: (draft) => [
      channelKnowledgeKeys.tree(deps.channelId, draft.baseId).all,
    ],
    onError: (err) => failed(err, "Couldn't save this entry"),
  };
}

export function useChannelEntryWrite(deps: {
  channelId: string;
  workspaceId: string;
}) {
  return useApiMutationWith<ChannelEntryEditDraft, ChannelKnowledgeEntryBody>(
    channelRequest,
    entryEditConfig(deps)
  );
}
