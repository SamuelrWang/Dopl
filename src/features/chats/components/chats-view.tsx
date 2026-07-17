"use client";

import { useMemo, useState } from "react";
import { toast } from "@/shared/ui/toast";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import type { Chat, ChatFolder } from "../types";
import { chatScope, type ChatScope } from "../scope";
import {
  createChatFolder,
  deleteChat as apiDeleteChat,
  updateChat as apiUpdateChat,
  updateChatFolder as apiUpdateChatFolder,
  ChatApiError,
} from "../client/api";
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
  initialChats: Chat[];
  initialFolders: ChatFolder[];
  /** Chats hidden by the free-plan retention window (0 on Pro). Static
   *  from the server render — drives the list's upgrade strip. */
  hiddenCount: number;
}

/**
 * Chats page root — the agent-exported conversation archive. Two-pane
 * .page-float surface: the scope-filtered list on the left (All /
 * Private / Team / Shared, mirroring the knowledge-base scopes), the
 * selected chat's document on the right. Server-fetched headers live
 * here as the single source of truth; the transcript loads per
 * selection.
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
  const [chats, setChats] = useState(initialChats);
  const [folders, setFolders] = useState(initialFolders);
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initialChats[0]?.id ?? null
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

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

  const patchChat = async (
    id: string,
    patch: Parameters<typeof apiUpdateChat>[1]
  ): Promise<Chat | null> => {
    try {
      const updated = await apiUpdateChat(id, patch, workspaceId);
      setChats((prev) => prev.map((c) => (c.id === id ? updated : c)));
      return updated;
    } catch (err) {
      toast({
        title: err instanceof ChatApiError ? err.message : "Update failed",
      });
      return null;
    }
  };

  const handleShareChange = async (
    id: string,
    scope: ChatScope,
    teamIds: string[]
  ): Promise<void> => {
    const updated = await patchChat(
      id,
      scope === "private"
        ? { visibility: "private" }
        : scope === "team"
          ? { visibility: "public", accessMode: "teams", teamIds }
          : { visibility: "public", accessMode: "workspace" }
    );
    // Follow the chat onto its new filter so it never vanishes mid-action.
    if (updated && filter !== "all" && !chatOnFilter(updated, filter, currentUserId)) {
      setFilter(scope);
    }
  };

  const handleTogglePin = async (id: string): Promise<void> => {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return;
    await patchChat(id, { pinned: !chat.pinned });
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDeleteChat(id, workspaceId);
      const remaining = chats.filter((c) => c.id !== id);
      setChats(remaining);
      if (selectedId === id) {
        setSelectedId(
          remaining.find((c) => chatOnFilter(c, filter, currentUserId))?.id ??
            null
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

  // The folder's scope is authoritative — the server re-scopes every
  // chat in the folder, so mirror that propagation in local state.
  const handleFolderShareChange = async (
    folderId: string,
    scope: ChatScope,
    teamIds: string[]
  ): Promise<void> => {
    try {
      const folder = await apiUpdateChatFolder(
        folderId,
        scope === "private"
          ? { visibility: "private" }
          : scope === "team"
            ? { visibility: "public", accessMode: "teams", teamIds }
            : { visibility: "public", accessMode: "workspace" },
        workspaceId
      );
      setFolders((prev) => prev.map((f) => (f.id === folder.id ? folder : f)));
      setChats((prev) =>
        prev.map((c) =>
          c.folderId === folder.id
            ? {
                ...c,
                visibility: folder.visibility,
                accessMode: folder.accessMode,
                grantedTeamIds: folder.grantedTeamIds,
              }
            : c
        )
      );
    } catch (err) {
      toast({
        title:
          err instanceof ChatApiError ? err.message : "Couldn't update folder",
      });
    }
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
        hiddenCount={hiddenCount}
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
        onDelete={handleDelete}
      />
    </div>
  );
}
