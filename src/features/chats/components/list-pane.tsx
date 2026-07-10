"use client";

import { useState } from "react";
import { ChevronRight, Folder, FolderPlus, Star, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Popover } from "@/shared/ui/popover-menu";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { Chat, ChatFolder } from "../types";
import { chatScope, type ChatScope } from "../scope";
import {
  SHARED_WITH_ME_LABEL,
  SOURCE_LABELS,
  UNFILED_LABEL,
} from "../constants";
import { formatShortDate } from "@/shared/lib/format-time";
import { SCOPE_ICONS, ShareMenu } from "./share-control";
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
  workspaceSlug: string;
  isAdmin: boolean;
  currentUserId: string;
  query: string;
  onQueryChange: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: ReadonlySet<string>;
  onToggleFolder: (key: string) => void;
  /** Resolves true on success — the draft input clears only then. */
  onCreateFolder: (name: string) => Promise<boolean>;
  /** Folder scope change — propagates to every chat in the folder. */
  onFolderShareChange: (
    folderId: string,
    scope: ChatScope,
    teamIds: string[]
  ) => Promise<void>;
}

/**
 * Left list pane: header with count, concave search well, the
 * All/Private/Team/Shared scope filter, and the chat list —
 * folder-grouped on the Private and All filters (All appends a
 * "Shared with me" group), flat (with owners) elsewhere. Folder
 * headers carry the folder's share control: the folder's scope is
 * authoritative for the chats inside it.
 */
export function ListPane({
  groups,
  filter,
  onFilterChange,
  counts,
  showFolders,
  workspaceSlug,
  isAdmin,
  currentUserId,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  collapsed,
  onToggleFolder,
  onCreateFolder,
  onFolderShareChange,
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

      <SearchField
        value={query}
        onChange={onQueryChange}
        placeholder="Search chats"
        className="mx-3.5 mb-3"
      />

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
            const key = group.folder?.id ?? group.kind;
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
            const label =
              group.kind === "shared"
                ? SHARED_WITH_ME_LABEL
                : (group.folder?.name ?? UNFILED_LABEL);
            return (
              <div key={key} className="border-b border-border-subtle">
                <div className="flex w-full items-center gap-2 pr-3.5 transition-colors hover:bg-surface-raised-1">
                  <button
                    type="button"
                    onClick={() => onToggleFolder(key)}
                    className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3.5 text-left"
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
                      {label}
                    </span>
                  </button>
                  {group.folder && !query.trim() && (
                    // Hidden during search: a filtered folder shows only
                    // matching chats, so the share popover's "applies to
                    // all N" would understate the real blast radius (the
                    // server re-scopes every chat in the folder).
                    <FolderShareControl
                      folder={group.folder}
                      chatCount={group.chats.length}
                      workspaceSlug={workspaceSlug}
                      currentUserId={currentUserId}
                      isAdmin={isAdmin}
                      onShareChange={(scope, teamIds) =>
                        onFolderShareChange(group.folder!.id, scope, teamIds)
                      }
                    />
                  )}
                  <span className="text-micro text-text-muted">
                    {group.chats.length}
                  </span>
                </div>
                {isOpen &&
                  group.chats.map((c) => (
                    <ChatRow
                      key={c.id}
                      chat={c}
                      selected={c.id === selectedId}
                      showOwner={group.kind === "shared"}
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

/**
 * The folder's share control — a scope icon on the folder header. A
 * folder's scope is authoritative: applying a change here re-scopes
 * every chat filed in the folder.
 */
function FolderShareControl({
  folder,
  chatCount,
  workspaceSlug,
  currentUserId,
  isAdmin,
  onShareChange,
}: {
  folder: ChatFolder;
  chatCount: number;
  workspaceSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  onShareChange: (scope: ChatScope, teamIds: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const scope = chatScope(folder);
  const Icon = SCOPE_ICONS[scope];

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Change who can read the chats in this folder"
        aria-label={`Folder sharing: ${scope}`}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-[6px] transition-colors hover:bg-surface-raised-3",
          scope === "private"
            ? "text-text-muted"
            : "text-text-secondary"
        )}
      >
        <Icon size={12} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="w-[264px] p-1.5"
      >
        {/* Mounted only while open so the teams fetch is lazy. */}
        <ShareMenu
          scope={scope}
          grantedTeamIds={folder.grantedTeamIds}
          workspaceSlug={workspaceSlug}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          warning={
            chatCount > 0
              ? `Applies to all ${chatCount} chat${chatCount === 1 ? "" : "s"} in "${folder.name}" — chats in a folder follow the folder's sharing.`
              : `Chats filed into "${folder.name}" will get this sharing.`
          }
          onApply={async (nextScope, teamIds) => {
            await onShareChange(nextScope, teamIds);
            setOpen(false);
          }}
        />
      </Popover>
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
