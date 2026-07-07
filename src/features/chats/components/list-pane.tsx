"use client";

import { ChevronRight, Folder, FolderPlus, ListFilter, Search, Star } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { Conversation } from "../types";
import { SOURCE_LABELS, UNFILED_LABEL } from "../constants";
import { formatShortDate } from "../format";
import type { FolderGroup } from "./chats-view";

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

interface Props {
  groups: FolderGroup[];
  total: number;
  query: string;
  onQueryChange: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: ReadonlySet<string>;
  onToggleFolder: (key: string) => void;
}

/**
 * Left list pane: header with counts, concave search well, and the
 * folder-grouped conversation list (folders collapse; groups are
 * delimited by hairlines, matching the knowledge-v2 list).
 */
export function ListPane({
  groups,
  total,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  collapsed,
  onToggleFolder,
}: Props) {
  return (
    <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
      <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
        <h1 className="text-title font-semibold tracking-tight text-text-primary">
          Chats
        </h1>
        <span className="text-caption text-text-muted">{total}</span>
        <span className="flex-1" />
        <button type="button" className={ICON_BTN} aria-label="New folder">
          <FolderPlus size={16} />
        </button>
        <button type="button" className={ICON_BTN} aria-label="Filter">
          <ListFilter size={17} />
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

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-default pb-4">
        {groups.length === 0 ? (
          <p className="px-4 py-2.5 text-caption text-text-muted">
            No conversations match.
          </p>
        ) : (
          groups.map((group) => {
            const key = group.folder?.id ?? "unfiled";
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
                    {group.conversations.length}
                  </span>
                </button>
                {isOpen &&
                  group.conversations.map((c) => (
                    <ConversationRow
                      key={c.id}
                      conversation={c}
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

function ConversationRow({
  conversation,
  selected,
  onSelect,
}: {
  conversation: Conversation;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      className={cn(
        "relative flex w-full flex-col gap-0.5 py-2 pl-8 pr-4 text-left transition-colors",
        selected ? "bg-surface-raised-3" : "hover:bg-surface-raised-1"
      )}
    >
      {selected && (
        <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-[3px] bg-text-primary" />
      )}
      <span className="flex w-full items-center gap-1.5">
        {conversation.pinned && (
          <Star size={10} className="shrink-0 fill-current text-text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
          {conversation.title}
        </span>
        <span className="shrink-0 text-micro text-text-muted">
          {formatShortDate(conversation.sessionDate)}
        </span>
      </span>
      <span className="flex w-full items-center gap-1.5 text-caption text-text-secondary">
        <span>{SOURCE_LABELS[conversation.source]}</span>
        <span className="text-text-muted">·</span>
        <span>{conversation.messages.length} messages</span>
      </span>
    </button>
  );
}
