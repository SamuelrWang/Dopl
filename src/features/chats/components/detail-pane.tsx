"use client";

import { useState } from "react";
import {
  ChevronRight,
  Copy,
  MessagesSquare,
  MoreHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { EmptyState } from "@/shared/ui/empty-state";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { toast } from "@/shared/ui/toast";
import type { Chat, ChatDetail, ChatFolder } from "../types";
import type { ChatScope } from "../scope";
import { FORMAT_LABELS, SOURCE_LABELS, UNFILED_LABEL } from "../constants";
import { formatDate } from "@/shared/lib/format-time";
import { useChatDetail } from "../client/hooks";
import { HeaderCard } from "./header-card";
import { MessageList } from "./message-list";
import { ShareControl } from "./share-control";

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

interface Props {
  chat: Chat | null;
  folder: ChatFolder | null;
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  totalChats: number;
  onShareChange: (id: string, scope: ChatScope, teamIds: string[]) => Promise<void>;
  onTogglePin: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/**
 * Right detail pane — the archived chat as a static document: crumb top
 * bar (owner-gated sharing control, pin, copy, delete), the header box,
 * then the summarized transcript (loaded per selection).
 */
export function DetailPane({
  chat,
  folder,
  workspaceId,
  workspaceSlug,
  currentUserId,
  isAdmin,
  totalChats,
  onShareChange,
  onTogglePin,
  onDelete,
}: Props) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { detail, status, retry } = useChatDetail(chat?.id ?? null, workspaceId);
  const { copy } = useCopyToClipboard();

  if (!chat) {
    return totalChats === 0 ? (
      <EmptyState
        icon={MessagesSquare}
        title="No chats in the archive yet."
        description={
          <>
            Connect your agent over MCP and have it call dopl_chats
            (op=&quot;export&quot;) at the end of a session — summaries land
            here, organized into folders, ready to recall later.
          </>
        }
      />
    ) : (
      <EmptyState icon={MessagesSquare} title="Select a chat to read it." />
    );
  }

  const isMine = chat.owner.userId === currentUserId;

  const copyMarkdown = async () => {
    if (!detail) return;
    toast({
      title: (await copy(toMarkdown(detail)))
        ? "Copied as Markdown"
        : "Couldn't copy to clipboard",
    });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border-default px-3.5">
        <span className="shrink-0 text-small font-medium text-text-secondary">
          {!isMine ? "Shared" : (folder?.name ?? UNFILED_LABEL)}
        </span>
        <ChevronRight size={13} className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate text-lead font-semibold text-text-primary">
          {chat.title}
        </span>
        <span className="flex-1" />

        <ShareControl
          chat={chat}
          folderName={folder?.name ?? null}
          workspaceSlug={workspaceSlug}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onShareChange={(scope, teamIds) =>
            onShareChange(chat.id, scope, teamIds)
          }
        />

        {isMine && (
          <button
            type="button"
            onClick={() => void onTogglePin(chat.id)}
            className={cn(ICON_BTN, chat.pinned && "text-text-primary")}
            aria-label={chat.pinned ? "Unpin" : "Pin"}
          >
            <Star size={15} className={cn(chat.pinned && "fill-current")} />
          </button>
        )}
        <button
          type="button"
          onClick={copyMarkdown}
          disabled={!detail}
          className={cn(ICON_BTN, !detail && "opacity-40")}
          aria-label="Copy as Markdown"
        >
          <Copy size={15} />
        </button>
        {isMine && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className={ICON_BTN}
              aria-label="More"
            >
              <MoreHorizontal size={16} />
            </button>
            <Popover open={menuOpen} onClose={() => setMenuOpen(false)} align="right">
              <MenuItem
                onSelect={() => {
                  setMenuOpen(false);
                  setDeleteConfirmOpen(true);
                }}
              >
                <span className="flex items-center gap-2 text-danger">
                  <Trash2 size={13} />
                  Delete chat
                </span>
              </MenuItem>
            </Popover>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-14 pb-16 pt-8">
        <div className="mx-auto max-w-[760px]">
          <HeaderCard chat={chat} currentUserId={currentUserId} />

          <div className="mb-3 mt-7 flex items-baseline gap-2">
            <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
              Conversation
            </span>
            <span className="text-caption text-text-muted">
              {chat.messageCount} messages ·{" "}
              {FORMAT_LABELS[chat.format].toLowerCase()}
            </span>
          </div>
          {status === "error" ? (
            <p className="text-caption text-danger">
              Couldn&apos;t load the transcript.{" "}
              <button
                type="button"
                onClick={retry}
                className="font-medium underline underline-offset-2 hover:text-text-primary"
              >
                Retry
              </button>
            </p>
          ) : detail ? (
            <MessageList messages={detail.messages} />
          ) : (
            <p className="text-caption text-text-muted">Loading transcript…</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete this chat?"
        description="The chat and its transcript are deleted permanently — there is no trash for the archive."
        confirmLabel="Delete"
        destructive
        onConfirm={() => onDelete(chat.id)}
      />
    </div>
  );
}

function toMarkdown(chat: ChatDetail): string {
  const lines: string[] = [];
  lines.push(`# ${chat.title}`);
  lines.push("");
  if (chat.overview) {
    lines.push(chat.overview);
    lines.push("");
  }
  lines.push(
    `${formatDate(chat.sessionDate)} · ${SOURCE_LABELS[chat.source]}${
      chat.project ? ` · ${chat.project}` : ""
    } · ${chat.messageCount} messages · ${FORMAT_LABELS[chat.format]}`
  );
  if (chat.deliverables.length > 0) {
    lines.push("");
    lines.push("## What was done");
    for (const d of chat.deliverables) lines.push(`- [${d.done ? "x" : " "}] ${d.label}`);
  }
  if (chat.learnings.length > 0) {
    lines.push("");
    lines.push("## Memories & learnings");
    for (const l of chat.learnings) lines.push(`- ${l}`);
  }
  lines.push("");
  lines.push("## Conversation");
  for (const m of chat.messages) {
    lines.push("");
    lines.push(`**${m.role === "user" ? "You" : "Agent"} · #${m.index}** — ${m.summary}`);
    if (m.verbatim) {
      lines.push("");
      for (const line of m.verbatim.split("\n")) lines.push(`> ${line}`);
    }
  }
  return lines.join("\n");
}
