"use client";

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { ChannelMessage } from "../types";
import { groupThread } from "../lib/group-thread";
import { ActivityEventRow } from "./activity-event-row";
import { SessionCard } from "./session-card";

/**
 * The channel transcript. One spawned-agent SESSION (the messages/events
 * sharing a `metadata.taskId`) collapses into a single {@link SessionCard};
 * standalone human messages and plain agent chat render as bordered bubbles
 * (agent = elevated surface, human = subtle card surface), and `system` rows
 * as flat centered activity lines via `ActivityEventRow`. A message carrying
 * addressing metadata shows who it was directed at + why, so a human can tell
 * why only one agent answered.
 */
export function MessageThread({
  messages,
  memberNames,
  onlineUserIds,
}: {
  messages: ChannelMessage[];
  /** userId -> display name, for rendering addressing targets. */
  memberNames: Map<string, string>;
  /** Members whose agent is currently listening (for session presence rings). */
  onlineUserIds: ReadonlySet<string>;
}) {
  const items = useMemo(() => groupThread(messages), [messages]);
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item) => {
        if (item.type === "session") {
          return (
            <SessionCard
              key={item.key}
              session={item.session}
              online={
                item.session.head.authorUserId
                  ? onlineUserIds.has(item.session.head.authorUserId)
                  : false
              }
            />
          );
        }
        const { message } = item;
        return message.kind === "message" ? (
          <MessageBubble
            key={item.key}
            message={message}
            memberNames={memberNames}
          />
        ) : (
          <ActivityEventRow key={item.key} message={message} />
        );
      })}
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
