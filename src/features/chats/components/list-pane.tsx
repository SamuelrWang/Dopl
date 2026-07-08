"use client";

import { useState } from "react";
import { ChevronRight, Folder, FolderPlus, Search, Star, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { Chat } from "../types";
import { SOURCE_LABELS, UNFILED_LABEL } from "../constants";
import { formatShortDate } from "../format";
import type { ChatFilter, FolderGroup } from "./chats-view";

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

const FILTERS: ReadonlyArray<{ key: ChatFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "private", label: "Private" },
  { key: "team", label: "Team" },
  { key: "workspace", label: "Shared" },
];

const EMPTY_COPY: Record<ChatFilter, string> = {
  all: "No chats yet — your agent exports conversations here via dopl_chats.",
  private:
    "No private chats yet — your agent exports conversations here via dopl_chats.",
  team: "No chats have been shared with your teams yet.",
  workspace: "No chats have been shared with the workspace yet.",
};

interface Props {
  groups: FolderGroup[];
  filter: ChatFilter;
  onFilterChange: (filter: ChatFilter) => void;
  counts: Record<ChatFilter, number>;
  showFolders: boolean;
  currentUserId: string;
  query: string;
  onQueryChange: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: ReadonlySet<string>;
  onToggleFolder: (key: string) => void;
  /** Resolves true on success — the draft input clears only then. */
  onCreateFolder: (name: string) => Promise<boolean>;
}

/**
 * Left list pane: header with count, concave search well, the
 * All/Private/Team/Shared scope filter, and the chat list —
 * folder-grouped on the Private filter, flat (with owners) elsewhere.
 */
export function ListPane({
  groups,
  filter,
  onFilterChange,
  counts,
  showFolders,
  currentUserId,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  collapsed,
  onToggleFolder,
  onCreateFolder,
}: Props) {
  const [folderDraft, setFolderDraft] = useState<string | null>(null);

  const submitFolder = async () => {
    const name = folderDraft?.trim();
    if (!name) {
      setFolderDraft(null);
      return;
    }
    // Keep the draft on failure (e.g. duplicate-name 409) so the typed
    // name isn't lost under the error toast.
    if (await onCreateFolder(name)) setFolderDraft(null);
  };

  return (
    <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
      <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
        <h1 className="text-title font-semibold tracking-tight text-text-primary">
          Chats
        </h1>
        <span className="text-caption text-text-muted">{counts.all}</span>
        <span className="flex-1" />
        <button
          type="button"
          className={ICON_BTN}
          aria-label="New folder"
          onClick={() => setFolderDraft((v) => (v === null ? "" : null))}
        >
          <FolderPlus size={16} />
        </button>
      </div>

      <div className="concave-field relative mx-3.5 mb-3 rounded-[9px]">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search chats"
          spellCheck={false}
          className="h-9 w-full bg-transparent pl-[33px] pr-3 text-body text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>

      <SegmentedControl
        options={FILTERS}
        value={filter}
        onChange={onFilterChange}
        className="mx-3.5 mb-3"
      />

      {folderDraft !== null && (
        <div className="concave-field relative mx-3.5 mb-3 flex items-center rounded-[9px]">
          <Folder
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            autoFocus
            value={folderDraft}
            onChange={(e) => setFolderDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") void submitFolder();
              if (e.key === "Escape") setFolderDraft(null);
            }}
            placeholder="New folder name — Enter to create"
            spellCheck={false}
            className="h-9 w-full bg-transparent pl-[33px] pr-9 text-body text-text-primary outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={() => setFolderDraft(null)}
            aria-label="Cancel new folder"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-default pb-4">
        {groups.length === 0 ? (
          <p className="px-4 py-2.5 text-caption leading-relaxed text-text-muted">
            {query.trim() ? "No chats match." : EMPTY_COPY[filter]}
          </p>
        ) : (
          groups.map((group) => {
            const key = group.folder?.id ?? "unfiled";
            if (!showFolders) {
              return group.chats.map((c) => (
                <ChatRow
                  key={c.id}
                  chat={c}
                  selected={c.id === selectedId}
                  showOwner={c.owner.userId !== currentUserId}
                  flat
                  onSelect={onSelect}
                />
              ));
            }
            const isOpen = !collapsed.has(key);
            return (
              <div key={key} className="border-b border-border-subtle">
                <button
                  type="button"
                  onClick={() => onToggleFolder(key)}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-surface-raised-1"
                >
                  <ChevronRight
                    size={12}
                    className={cn(
                      "shrink-0 text-text-muted transition-transform",
                      isOpen && "rotate-90"
                    )}
                  />
                  <Folder size={13} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate text-small font-semibold text-text-primary">
                    {group.folder?.name ?? UNFILED_LABEL}
                  </span>
                  <span className="text-micro text-text-muted">
                    {group.chats.length}
                  </span>
                </button>
                {isOpen &&
                  group.chats.map((c) => (
                    <ChatRow
                      key={c.id}
                      chat={c}
                      selected={c.id === selectedId}
                      onSelect={onSelect}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ChatRow({
  chat,
  selected,
  showOwner = false,
  flat = false,
  onSelect,
}: {
  chat: Chat;
  selected: boolean;
  showOwner?: boolean;
  flat?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(chat.id)}
      className={cn(
        "relative flex w-full flex-col gap-0.5 py-2 pr-4 text-left transition-colors",
        flat ? "border-b border-border-subtle px-4" : "pl-8",
        selected ? "bg-surface-raised-3" : "hover:bg-surface-raised-1"
      )}
    >
      {selected && (
        <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-[3px] bg-text-primary" />
      )}
      <span className="flex w-full items-center gap-1.5">
        {chat.pinned && (
          <Star size={10} className="shrink-0 fill-current text-text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
          {chat.title}
        </span>
        <span className="shrink-0 text-micro text-text-muted">
          {formatShortDate(chat.sessionDate)}
        </span>
      </span>
      <span className="flex w-full items-center gap-1.5 text-caption text-text-secondary">
        {showOwner && (
          <>
            <span className="font-medium">{chat.owner.name}</span>
            <span className="text-text-muted">·</span>
          </>
        )}
        <span>{SOURCE_LABELS[chat.source]}</span>
        <span className="text-text-muted">·</span>
        <span>{chat.messageCount} messages</span>
      </span>
    </button>
  );
}
