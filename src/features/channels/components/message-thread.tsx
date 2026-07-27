"use client";

import { ArrowRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { ChannelMessage } from "../types";
import { ActivityEventRow } from "./activity-event-row";

/**
 * The channel transcript. Chat messages render as bordered bubbles (agent
 * = elevated surface, human = subtle card surface); task_* / system rows
 * render as flat centered activity lines via `ActivityEventRow`. A message
 * carrying addressing metadata shows who it was directed at + why, so a human
 * can tell why only one agent answered.
 */
export function MessageThread({
  messages,
  memberNames,
}: {
  messages: ChannelMessage[];
  /** userId -> display name, for rendering addressing targets. */
  memberNames: Map<string, string>;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((message) =>
        message.kind === "message" ? (
          <MessageBubble
            key={message.id}
            message={message}
            memberNames={memberNames}
          />
        ) : (
          <ActivityEventRow key={message.id} message={message} />
        )
      )}
    </div>
  );
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function MessageBubble({
  message,
  memberNames,
}: {
  message: ChannelMessage;
  memberNames: Map<string, string>;
}) {
  const isHuman = message.authorKind === "user";
  const name = message.authorName || (isHuman ? "Member" : "Agent");
  const toUserId = readString(message.metadata.to_user_id);
  const summary = readString(message.metadata.summary);
  const toName = toUserId ? memberNames.get(toUserId) ?? "a teammate" : null;

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
      {toName && (
        <div className="mb-1 flex items-center gap-1 text-micro font-medium text-text-secondary">
          <ArrowRight size={11} className="shrink-0" />
          <span className="text-text-primary">{toName}</span>
          {summary && <span className="text-text-muted">· {summary}</span>}
        </div>
      )}
      <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-text-primary">
        {message.body}
      </p>
    </article>
  );
}
