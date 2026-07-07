"use client";

import { ChevronRight, Copy, MessagesSquare, MoreHorizontal, Star } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { Conversation, ConversationFolder } from "../types";
import { FORMAT_LABELS, UNFILED_LABEL } from "../constants";
import { HeaderCard } from "./header-card";
import { MessageList } from "./message-list";

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

interface Props {
  conversation: Conversation | null;
  folder: ConversationFolder | null;
}

/**
 * Right detail pane — the archived chat as a static document: crumb top
 * bar, the header box (title + collapsed session detail), then the
 * summarized transcript.
 */
export function DetailPane({ conversation, folder }: Props) {
  if (!conversation) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2.5 text-text-muted">
        <MessagesSquare size={30} className="text-border-strong" />
        <p className="text-body">Select a chat to read it.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border-default px-3.5">
        <span className="shrink-0 text-small font-medium text-text-secondary">
          {folder?.name ?? UNFILED_LABEL}
        </span>
        <ChevronRight size={13} className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate text-lead font-semibold text-text-primary">
          {conversation.title}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className={cn(ICON_BTN, conversation.pinned && "text-text-primary")}
          aria-label={conversation.pinned ? "Unpin" : "Pin"}
        >
          <Star size={15} className={cn(conversation.pinned && "fill-current")} />
        </button>
        <button type="button" className={ICON_BTN} aria-label="Copy as Markdown">
          <Copy size={15} />
        </button>
        <button type="button" className={ICON_BTN} aria-label="More">
          <MoreHorizontal size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-14 pb-16 pt-8">
        <div className="mx-auto max-w-[760px]">
          <HeaderCard conversation={conversation} />

          <div className="mb-3 mt-7 flex items-baseline gap-2">
            <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
              Conversation
            </span>
            <span className="text-caption text-text-muted">
              {conversation.messages.length} messages ·{" "}
              {FORMAT_LABELS[conversation.format].toLowerCase()}
            </span>
          </div>
          <MessageList messages={conversation.messages} />
        </div>
      </div>
    </div>
  );
}
