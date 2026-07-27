"use client";

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { isUuid } from "@/shared/lib/id/uuid";
import type { ChannelMessage, ChannelTask } from "../types";
import { groupThread, type TaskOverlay } from "../lib/group-thread";
import { ActivityEventRow } from "./activity-event-row";
import { SessionCard } from "./session-card";

/**
 * Turn a first-class {@link ChannelTask} row into the authoritative render
 * overlay: an open task is `active`, a closed one is `done` (completed) or
 * `failed` — status the lifecycle-only heuristic can't derive on its own.
 */
function taskOverlayFrom(task: ChannelTask): TaskOverlay {
  const status =
    task.status === "open"
      ? "active"
      : task.outcome === "failed"
        ? "failed"
        : "done";
  return { status, title: task.title, mode: task.mode };
}

/**
 * The channel transcript. One TASK (the messages/events sharing a
 * `metadata.taskId`) collapses into a single {@link SessionCard}, its status +
 * title overlaid from the authoritative `channel_tasks` rows; standalone human
 * messages and plain agent chat render as bordered bubbles (agent = elevated
 * surface, human = subtle card surface), and `system` rows as flat centered
 * activity lines via `ActivityEventRow`. A message carrying addressing metadata
 * shows who it was directed at + why, so a human can tell why only one agent
 * answered.
 */
export function MessageThread({
  messages,
  memberNames,
  tasks,
  tasksLoading,
}: {
  messages: ChannelMessage[];
  /** userId -> display name, for rendering addressing targets. */
  memberNames: Map<string, string>;
  /** The channel's first-class tasks — the status / title / mode overlay. */
  tasks: ChannelTask[];
  /** True while the task overlay is still loading (see the flicker note below). */
  tasksLoading: boolean;
}) {
  const items = useMemo(() => {
    const overlays = new Map(tasks.map((t) => [t.id, taskOverlayFrom(t)]));
    const grouped = groupThread(messages, overlays);
    // Flicker suppression: an OPEN first-class task whose id is UUID-shaped has
    // an authoritative overlay, but before that overlay loads `groupThread`
    // falls back to the message-derived status — a delivered reply reads "done"
    // ("Task complete"), then snaps to its real status once tasks arrive. While
    // the overlay is loading, hold any UUID-id group with no overlay yet at the
    // neutral "active" state; legacy (non-UUID) ids never get an overlay, so
    // they keep their derived status as today. The overlay is authoritative the
    // moment it loads.
    if (tasksLoading) {
      for (const item of grouped) {
        if (
          item.type === "session" &&
          isUuid(item.session.taskId) &&
          !overlays.has(item.session.taskId)
        ) {
          item.session.status = "active";
        }
      }
    }
    return grouped;
  }, [messages, tasks, tasksLoading]);
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item) => {
        if (item.type === "session") {
          return <SessionCard key={item.key} session={item.session} />;
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
          {name} · {formatChannelTimestamp(message.createdAt)}
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
