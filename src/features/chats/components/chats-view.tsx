"use client";

import { useMemo, useState } from "react";
import type { Conversation, ConversationFolder } from "../types";
import { MOCK_CONVERSATIONS, MOCK_FOLDERS } from "../mock-data";
import { ListPane } from "./list-pane";
import { DetailPane } from "./detail-pane";

export type FolderGroup = {
  folder: ConversationFolder | null;
  conversations: Conversation[];
};

/**
 * Chats page root — the agent-exported conversation archive. Two-pane
 * .page-float surface: folder-grouped list on the left, the selected
 * chat's static document on the right. Mock-backed until the archive
 * backend lands.
 */
export function ChatsView() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    MOCK_CONVERSATIONS[0]?.id ?? null
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const groups = useMemo<FolderGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (c: Conversation) =>
      q === "" ||
      c.title.toLowerCase().includes(q) ||
      c.overview.toLowerCase().includes(q);

    const grouped: FolderGroup[] = MOCK_FOLDERS.map((folder) => ({
      folder,
      conversations: MOCK_CONVERSATIONS.filter(
        (c) => c.folderId === folder.id && matches(c)
      ),
    }));
    grouped.push({
      folder: null,
      conversations: MOCK_CONVERSATIONS.filter(
        (c) => c.folderId === null && matches(c)
      ),
    });
    return grouped.filter((g) => g.conversations.length > 0);
  }, [query]);

  const selected = MOCK_CONVERSATIONS.find((c) => c.id === selectedId) ?? null;
  const selectedFolder = selected
    ? (MOCK_FOLDERS.find((f) => f.id === selected.folderId) ?? null)
    : null;

  const toggleFolder = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="page-float flex antialiased">
      <ListPane
        groups={groups}
        total={MOCK_CONVERSATIONS.length}
        query={query}
        onQueryChange={setQuery}
        selectedId={selectedId}
        onSelect={setSelectedId}
        collapsed={collapsed}
        onToggleFolder={toggleFolder}
      />
      <DetailPane conversation={selected} folder={selectedFolder} />
    </div>
  );
}
