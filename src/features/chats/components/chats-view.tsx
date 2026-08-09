"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRefetchGate } from "@/shared/hooks/use-api-mutation";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import type { Chat, ChatFolder } from "../types";
import { chatScope, type ChatScope } from "../scope";
import { useChatFolders, useChats } from "../client/hooks";
import { chatKeys } from "../client/query-keys";
import { useChatsRealtime } from "../client/realtime";
import { useChatWrites } from "../hooks/use-chat-writes";
import { pendingFolderId, scopeFields } from "../lib/optimistic-cache";
import { ListPane } from "./list-pane";
import { DetailPane } from "./detail-pane";

export type FolderGroup = {
  /** 'folder'/'unfiled' hold the caller's own chats; 'shared' holds
   *  other members' chats surfaced on the All filter. */
  kind: "folder" | "unfiled" | "shared";
  folder: ChatFolder | null;
  chats: Chat[];
};

/** List filter — All, or one sharing scope (scope 'workspace' = Shared). */
export type ChatFilter = "all" | ChatScope;

function chatOnFilter(c: Chat, filter: ChatFilter, currentUserId: string): boolean {
  if (filter === "all") return true;
  const scope = chatScope(c);
  if (filter === "private") {
    return scope === "private" && c.owner.userId === currentUserId;
  }
  return scope === filter;
}

interface Props {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  /** First-paint seed only. The cache is the source of truth the moment the
   *  page's own `/api/chats` read lands — which, since the page renders this
   *  view only once it has, is the very first render. */
  initialChats: Chat[];
  initialFolders: ChatFolder[];
  /** Chats hidden by the free-plan retention window (0 on Pro) — drives the
   *  list's upgrade strip. Server-computed; the cache carries the live value. */
  hiddenCount: number;
}

/**
 * Chats page root — the agent-exported conversation archive. Two-pane
 * .page-float surface: the scope-filtered list on the left (All / Private /
 * Team / Shared, mirroring the knowledge-base scopes), the selected chat's
 * document on the right.
 *
 * ONE SOURCE OF TRUTH, and it is the query cache. This view used to copy the
 * page's already-cached list into `useState` and then keep the two apart by
 * hand: the realtime handler re-fetched through the raw client and `setState`
 * with the answer (leaving the cache the page reads from stale), and every
 * write patched the local copy only. A remount inside the cache window —
 * navigating away and back — rebuilt the whole view from the untouched cache
 * entry, so a pin, a share or a delete could simply come back. Now the reads
 * ARE `useApiQuery` on the same keys the page mounted (same entries, no extra
 * request), the writes patch those entries optimistically, and the props
 * survive only as the first-paint seed.
 */
export function ChatsView({
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
  initialChats,
  initialFolders,
  hiddenCount,
}: Props) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialChats[0]?.id ?? null
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const listQuery = useChats(workspaceId);
  const foldersQuery = useChatFolders(workspaceId);
  const chats = listQuery.data?.chats ?? initialChats;
  const hidden = listQuery.data?.hiddenCount ?? hiddenCount;
  const folders = foldersQuery.data ?? initialFolders;

  // Live updates from MCP/CLI agents and other tabs: an exported chat, a new
  // message, a share/folder change, or a retention shift. Invalidation is
  // EXPLICIT and names three caches — the list and the folders (both
  // server-authoritative: retention and grant fan-out are computed there), and
  // the ONE transcript currently on screen. It used to name
  // `["chat-detail", workspaceId]`, a prefix over every transcript the user
  // had opened all session, so a single agent export re-downloaded all of
  // them. `useRefetchGate` holds the whole signal open while a local write is
  // in flight, so a realtime event mid-write cannot refetch over it.
  const { signal, gate } = useRefetchGate(() => {
    void qc.invalidateQueries({ queryKey: chatKeys.list().all });
    void qc.invalidateQueries({ queryKey: chatKeys.folders().all });
    if (selectedId !== null) {
      void qc.invalidateQueries({ queryKey: chatKeys.detail(selectedId).all });
    }
  });
  useChatsRealtime(workspaceId, signal);

  const writes = useChatWrites({
    workspaceId,
    gate,
    onDeleteFailed: (chatId) => setSelectedId(chatId),
  });

  const counts = useMemo<Record<ChatFilter, number>>(() => {
    const c: Record<ChatFilter, number> = { all: 0, private: 0, team: 0, workspace: 0 };
    for (const chat of chats) {
      c.all += 1;
      for (const f of ["private", "team", "workspace"] as const) {
        if (chatOnFilter(chat, f, currentUserId)) c[f] += 1;
      }
    }
    return c;
  }, [chats, currentUserId]);

  // Folder grouping covers the caller's own archive — the Private and
  // All filters. Team/Shared render a flat, owner-labeled list. On All,
  // other members' chats sit in a trailing "Shared with me" group.
  const showFolders = filter === "private" || filter === "all";

  const groups = useMemo<FolderGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (c: Chat) =>
      chatOnFilter(c, filter, currentUserId) &&
      (q === "" ||
        c.title.toLowerCase().includes(q) ||
        c.overview.toLowerCase().includes(q));
    const mine = (c: Chat) => c.owner.userId === currentUserId;
    const pinnedFirst = (list: Chat[]) =>
      [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));

    if (!showFolders) {
      const flat = pinnedFirst(chats.filter(matches));
      return flat.length > 0
        ? [{ kind: "shared" as const, folder: null, chats: flat }]
        : [];
    }

    const grouped: FolderGroup[] = folders.map((folder) => ({
      kind: "folder" as const,
      folder,
      chats: pinnedFirst(
        chats.filter((c) => mine(c) && c.folderId === folder.id && matches(c))
      ),
    }));
    grouped.push({
      kind: "unfiled",
      folder: null,
      chats: pinnedFirst(
        chats.filter(
          (c) =>
            mine(c) &&
            (c.folderId === null || !folders.some((f) => f.id === c.folderId)) &&
            matches(c)
        )
      ),
    });
    if (filter === "all") {
      grouped.push({
        kind: "shared",
        folder: null,
        chats: pinnedFirst(chats.filter((c) => !mine(c) && matches(c))),
      });
    }
    // Empty folders stay visible (outside a search) so their sharing
    // and future contents remain reachable; empty pseudo-groups don't.
    return grouped.filter(
      (g) => g.chats.length > 0 || (g.kind === "folder" && q === "")
    );
  }, [chats, folders, query, filter, currentUserId, showFolders]);

  const selected = chats.find((c) => c.id === selectedId) ?? null;
  const selectedFolder = selected
    ? (folders.find((f) => f.id === selected.folderId) ?? null)
    : null;

  const handleFilterChange = (next: ChatFilter) => {
    setFilter(next);
    if (!selected || !chatOnFilter(selected, next, currentUserId)) {
      setSelectedId(
        chats.find((c) => chatOnFilter(c, next, currentUserId))?.id ?? null
      );
    }
  };

  const toggleFolder = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // EVERY HANDLER BELOW COMMITS AT SUBMIT, not on the response. The cache
  // patch lands in `onMutate`, so any local follow-up that has to agree with
  // it — which filter the chat is now on, which row is selected — has to be
  // decided here too. Deferring one to `onSuccess` would leave the list and
  // the selection disagreeing for the length of a round trip, which is the
  // failure the optimistic patch exists to remove.

  const handleShareChange = async (
    id: string,
    scope: ChatScope,
    teamIds: string[]
  ): Promise<void> => {
    const chat = chats.find((c) => c.id === id);
    writes.share.mutate({ chatId: id, scope, teamIds });
    // Follow the chat onto its new filter so it never vanishes mid-action.
    const next = chat ? { ...chat, ...scopeFields(scope, teamIds) } : null;
    if (next && filter !== "all" && !chatOnFilter(next, filter, currentUserId)) {
      setFilter(scope);
    }
  };

  const handleTogglePin = async (id: string): Promise<void> => {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    writes.pin.mutate({ chatId: id, pinned: !chat.pinned });
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (selectedId === id) {
      setSelectedId(
        chats.find((c) => c.id !== id && chatOnFilter(c, filter, currentUserId))
          ?.id ?? null
      );
    }
    writes.remove.mutate({ chatId: id });
  };

  /** Resolves false on failure so the list pane can put the draft back. */
  const handleCreateFolder = async (name: string): Promise<boolean> => {
    try {
      await writes.createFolder.mutateAsync({ tempId: pendingFolderId(), name });
      return true;
    } catch {
      return false; // already toasted + rolled back by the mutation
    }
  };

  const handleFolderShareChange = async (
    folderId: string,
    scope: ChatScope,
    teamIds: string[]
  ): Promise<void> => {
    writes.folderScope.mutate({ folderId, scope, teamIds });
  };

  return (
    <div className="page-float flex antialiased">
      <ListPane
        groups={groups}
        filter={filter}
        onFilterChange={handleFilterChange}
        counts={counts}
        showFolders={showFolders}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        isAdmin={meetsMinRole(role, "admin")}
        currentUserId={currentUserId}
        query={query}
        onQueryChange={setQuery}
        selectedId={selectedId}
        onSelect={setSelectedId}
        collapsed={collapsed}
        onToggleFolder={toggleFolder}
        onCreateFolder={handleCreateFolder}
        onFolderShareChange={handleFolderShareChange}
        hiddenCount={hidden}
      />
      <DetailPane
        chat={selected}
        folder={selectedFolder}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        currentUserId={currentUserId}
        isAdmin={meetsMinRole(role, "admin")}
        totalChats={chats.length}
        onShareChange={handleShareChange}
        onTogglePin={handleTogglePin}
        pinPending={writes.pin.pending}
        onDelete={handleDelete}
      />
    </div>
  );
}
