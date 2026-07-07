"use client";

import { ChevronRight, Copy, MessagesSquare, MoreHorizontal, Star } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { Conversation, ConversationFolder } from "../types";
import { FORMAT_LABELS, SOURCE_LABELS, UNFILED_LABEL } from "../constants";
import { formatDate } from "../format";
import { SessionSections } from "./session-sections";
import { MessageList } from "./message-list";

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

const META_CHIP =
  "rounded-full border border-border-strong bg-bg-inset px-2.5 py-0.5 text-caption font-medium text-text-secondary";

interface Props {
  conversation: Conversation | null;
  folder: ConversationFolder | null;
}

/**
 * Right detail pane — the archived conversation as a static document:
 * crumb top bar, display title + agent-written overview, the session
 * header sections, then the summarized transcript.
 */
export function DetailPane({ conversation, folder }: Props) {
  if (!conversation) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2.5 text-text-muted">
        <MessagesSquare size={30} className="text-border-strong" />
        <p className="text-body">Select a conversation to read it.</p>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-14 pb-16 pt-9">
        <div className="mx-auto max-w-[760px]">
          <h2 className="text-display font-semibold tracking-tight text-text-primary">
            {conversation.title}
          </h2>
          <p className="mt-2 text-lead leading-relaxed text-text-secondary">
            {conversation.overview}
          </p>
          <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
            <span className={META_CHIP}>{formatDate(conversation.sessionDate)}</span>
            <span className={META_CHIP}>{SOURCE_LABELS[conversation.source]}</span>
            {conversation.project && (
              <span className={META_CHIP}>{conversation.project}</span>
            )}
            <span className={META_CHIP}>
              {conversation.messages.length} messages
            </span>
            <span className={META_CHIP}>{FORMAT_LABELS[conversation.format]}</span>
          </div>

          <div className="my-6 h-px bg-border-default" />

          <SessionSections conversation={conversation} />

          <div className="mb-3 mt-8 flex items-baseline gap-2">
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
