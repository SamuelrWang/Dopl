"use client";

import { useMemo, useState } from "react";
import { toast } from "@/shared/ui/toast";
import type { Chat, ChatFolder, ChatVisibility } from "../types";
import {
  createChatFolder,
  deleteChat as apiDeleteChat,
  updateChat as apiUpdateChat,
  ChatApiError,
} from "../client/api";
import { ListPane } from "./list-pane";
import { DetailPane } from "./detail-pane";

export type FolderGroup = {
  folder: ChatFolder | null;
  chats: Chat[];
};

/** A chat belongs on the Private tab only when the viewer owns it; the
 *  Public tab shows every workspace-shared chat regardless of owner. */
function chatOnTab(c: Chat, tab: ChatVisibility, currentUserId: string): boolean {
  return (
    c.visibility === tab && (tab === "public" || c.owner.userId === currentUserId)
  );
}

interface Props {
  workspaceId: string;
  currentUserId: string;
  initialChats: Chat[];
  initialFolders: ChatFolder[];
}

/**
 * Chats page root — the agent-exported conversation archive. Two-pane
 * .page-float surface: folder-grouped list on the left (Private tab =
 * your chats in your folders; Public tab = a flat list of every chat
 * shared with the workspace), the selected chat's document on the
 * right. Server-fetched headers live here as the single source of
 * truth; the transcript loads per selection.
 */
export function ChatsView({
  workspaceId,
  currentUserId,
  initialChats,
  initialFolders,
}: Props) {
  // Seed tab + selection together so the first render never shows a
  // document whose row isn't on the visible tab.
  const firstPrivate = initialChats.find((c) =>
    chatOnTab(c, "private", currentUserId)
  );
  const firstPublic = initialChats.find((c) =>
    chatOnTab(c, "public", currentUserId)
  );
  const initialTab: ChatVisibility =
    firstPrivate || !firstPublic ? "private" : "public";

  const [chats, setChats] = useState(initialChats);
  const [folders, setFolders] = useState(initialFolders);
  const [tab, setTab] = useState<ChatVisibility>(initialTab);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    (initialTab === "private" ? firstPrivate : firstPublic)?.id ?? null
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const privateCount = chats.filter((c) =>
    chatOnTab(c, "private", currentUserId)
  ).length;
  const publicCount = chats.filter((c) =>
    chatOnTab(c, "public", currentUserId)
  ).length;

  const groups = useMemo<FolderGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (c: Chat) =>
      chatOnTab(c, tab, currentUserId) &&
      (q === "" ||
        c.title.toLowerCase().includes(q) ||
        c.overview.toLowerCase().includes(q));
    const pinnedFirst = (list: Chat[]) =>
      [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));

    if (tab === "public") {
      const shared = pinnedFirst(chats.filter(matches));
      return shared.length > 0 ? [{ folder: null, chats: shared }] : [];
    }

    const grouped: FolderGroup[] = folders.map((folder) => ({
      folder,
      chats: pinnedFirst(
        chats.filter((c) => c.folderId === folder.id && matches(c))
      ),
    }));
    grouped.push({
      folder: null,
      chats: pinnedFirst(
        chats.filter(
          (c) =>
            (c.folderId === null || !folders.some((f) => f.id === c.folderId)) &&
            matches(c)
        )
      ),
    });
    return grouped.filter((g) => g.chats.length > 0);
  }, [chats, folders, query, tab, currentUserId]);

  const selected = chats.find((c) => c.id === selectedId) ?? null;
  const selectedFolder = selected
    ? (folders.find((f) => f.id === selected.folderId) ?? null)
    : null;

  const handleTabChange = (next: ChatVisibility) => {
    setTab(next);
    if (!selected || !chatOnTab(selected, next, currentUserId)) {
      setSelectedId(
        chats.find((c) => chatOnTab(c, next, currentUserId))?.id ?? null
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

  const patchChat = async (
    id: string,
    patch: Parameters<typeof apiUpdateChat>[1],
    followVisibility = false
  ) => {
    try {
      const updated = await apiUpdateChat(id, patch, workspaceId);
      setChats((prev) => prev.map((c) => (c.id === id ? updated : c)));
      // Follow the chat onto its new tab so it never vanishes mid-action.
      if (followVisibility && patch.visibility) setTab(patch.visibility);
    } catch (err) {
      toast({
        title: err instanceof ChatApiError ? err.message : "Update failed",
      });
    }
  };

  const handleToggleVisibility = (id: string): Promise<void> => {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return Promise.resolve();
    return patchChat(
      id,
      { visibility: chat.visibility === "private" ? "public" : "private" },
      true
    );
  };

  const handleTogglePin = (id: string): Promise<void> => {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return Promise.resolve();
    return patchChat(id, { pinned: !chat.pinned });
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDeleteChat(id, workspaceId);
      const remaining = chats.filter((c) => c.id !== id);
      setChats(remaining);
      if (selectedId === id) {
        setSelectedId(
          remaining.find((c) => chatOnTab(c, tab, currentUserId))?.id ?? null
        );
      }
    } catch (err) {
      toast({
        title: err instanceof ChatApiError ? err.message : "Delete failed",
      });
    }
  };

  const handleCreateFolder = async (name: string): Promise<boolean> => {
    try {
      const folder = await createChatFolder(name, workspaceId);
      setFolders((prev) =>
        [...prev, folder].sort((a, b) => a.name.localeCompare(b.name))
      );
      return true;
    } catch (err) {
      toast({
        title:
          err instanceof ChatApiError ? err.message : "Couldn't create folder",
      });
      return false;
    }
  };

  return (
    <div className="page-float flex antialiased">
      <ListPane
        groups={groups}
        tab={tab}
        onTabChange={handleTabChange}
        privateCount={privateCount}
        publicCount={publicCount}
        query={query}
        onQueryChange={setQuery}
        selectedId={selectedId}
        onSelect={setSelectedId}
        collapsed={collapsed}
        onToggleFolder={toggleFolder}
        onCreateFolder={handleCreateFolder}
      />
      <DetailPane
        chat={selected}
        folder={selectedFolder}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        totalChats={chats.length}
        onToggleVisibility={handleToggleVisibility}
        onTogglePin={handleTogglePin}
        onDelete={handleDelete}
      />
    </div>
  );
}
