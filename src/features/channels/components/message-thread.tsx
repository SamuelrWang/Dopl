"use client";

import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { ChannelMessage } from "../types";
import { ActivityEventRow } from "./activity-event-row";

/**
 * The channel transcript. Chat messages render as bordered bubbles (agent
 * = elevated surface, human = subtle card surface); task_* / system rows
 * render as flat centered activity lines via `ActivityEventRow`.
 */
export function MessageThread({ messages }: { messages: ChannelMessage[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((message) =>
        message.kind === "message" ? (
          <MessageBubble key={message.id} message={message} />
        ) : (
          <ActivityEventRow key={message.id} message={message} />
        )
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChannelMessage }) {
  const isHuman = message.authorKind === "user";
  const name = message.authorName || (isHuman ? "Member" : "Agent");
  return (
    <article
      className={cn(
        "rounded-[10px] border px-3.5 py-2.5",
        isHuman
          ? "border-border-default bg-card-surface-subtle"
          : "border-border-subtle bg-bg-elevated"
      )}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <Avatar
          person={{
            userId: message.authorUserId ?? name,
            email: null,
            displayName: message.authorName,
            avatarUrl: message.authorAvatarUrl,
          }}
          size="xs"
        />
        <span className="text-micro font-medium uppercase tracking-wide text-text-muted">
          {name} · {formatRelativeTime(message.createdAt)}
        </span>
        {!isHuman && (
          <span className="rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
            {message.authorKind === "agent" ? "agent" : "system"}
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-text-primary">
        {message.body}
      </p>
    </article>
  );
}
