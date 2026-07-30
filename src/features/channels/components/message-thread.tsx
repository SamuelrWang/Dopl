"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { isUuid } from "@/shared/lib/id/uuid";
import type { ChannelMessage, ChannelTask } from "../types";
import { groupThread, type TaskOverlay } from "../lib/group-thread";
import {
  deriveMessageReceipt,
  RECEIPT_LABEL,
  type ReceiptStatus,
} from "../lib/message-receipt";
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
  return {
    status,
    title: task.title,
    mode: task.mode,
    outcomeSummary: task.outcomeSummary,
  };
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
 *
 * Plain chat bubbles are SIDED like a messaging app: the viewer's own human
 * message hugs the right, everyone else's (teammate or agent) hugs the left, both
 * capped at ~2/3 of the column so a bubble never spans the full width and the
 * side stays legible. Only those bubbles are sided — session cards, activity
 * lines, and the pending-request cards below the transcript stay full width,
 * because they are shared state rather than someone's turn in the conversation.
 */
export function MessageThread({
  messages,
  memberNames,
  tasks,
  tasksLoading,
  currentUserId,
  highlightedTaskId,
  onCloseTask,
}: {
  messages: ChannelMessage[];
  /** userId -> display name, for rendering addressing targets. */
  memberNames: Map<string, string>;
  /** The channel's first-class tasks — the status / title / mode overlay. */
  tasks: ChannelTask[];
  /** True while the task overlay is still loading (see the flicker note below). */
  tasksLoading: boolean;
  /**
   * The viewer's user id — gates the outgoing-message receipt line to the
   * current user's own standalone bubbles.
   */
  currentUserId: string;
  /**
   * The task the task panel navigated to; its {@link SessionCard} shows a
   * transient highlight ring. Null / undefined highlights nothing.
   */
  highlightedTaskId?: string | null;
  /**
   * Close mutation for the card's task control (see SessionCard). Reopening a
   * closed task is the task panel's job, so no reopen callback comes through
   * the transcript.
   */
  onCloseTask?: (
    taskId: string,
    outcome: "completed" | "failed",
    summary?: string
  ) => Promise<void>;
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
          return (
            <SessionCard
              key={item.key}
              session={item.session}
              highlighted={highlightedTaskId === item.session.taskId}
              task={tasks.find((t) => t.id === item.session.taskId)}
              currentUserId={currentUserId}
              onCloseTask={onCloseTask}
            />
          );
        }
        const { message } = item;
        return message.kind === "message" ? (
          <MessageBubble
            key={item.key}
            message={message}
            messages={messages}
            memberNames={memberNames}
            currentUserId={currentUserId}
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
  messages,
  memberNames,
  currentUserId,
}: {
  message: ChannelMessage;
  /** The full transcript, for deriving this message's outgoing receipt. */
  messages: ChannelMessage[];
  memberNames: Map<string, string>;
  currentUserId: string;
}) {
  const isHuman = message.authorKind === "user";
  // Chat-style side: only MY OWN human message goes right. Everything else goes
  // left, including an AGENT row carrying my user id (my agent speaks for itself,
  // not for me), which is why this is gated on `authorKind === "user"` too.
  const isOwn = isHuman && message.authorUserId === currentUserId;
  const name = message.authorName || (isHuman ? "Member" : "Agent");
  const toUserId = readString(message.metadata.to_user_id);
  const summary = readString(message.metadata.summary);
  const toName = toUserId ? memberNames.get(toUserId) ?? "a teammate" : null;
  const receipt = deriveMessageReceipt(message, messages, currentUserId);

  // A summary promotes to the prominent line; the full body collapses behind a
  // chevron (default collapsed), mirroring the SessionCard per-entry pattern. A
  // message with no summary keeps its body shown inline exactly as before.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() =>
    summary ? new Set([message.id]) : new Set()
  );
  const collapsed = summary !== null && collapsedIds.has(message.id);
  const toggle = () =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });

  return (
    <article
      className={cn(
        "max-w-[66%] rounded-[10px] border px-3.5 py-2.5",
        isOwn ? "self-end" : "self-start",
        isHuman
          ? "border-border-default bg-card-surface-subtle"
          : "border-border-subtle bg-bg-elevated"
      )}
    >
      <div
        className={cn(
          "mb-1 flex items-center gap-1.5",
          isOwn && "justify-end"
        )}
      >
        {/* My own bubble drops the avatar: the right-hand side already says who
            wrote it, and a second identity marker only crowds the line. */}
        {!isOwn && (
          <Avatar
            person={{
              userId: message.authorUserId ?? name,
              email: null,
              displayName: message.authorName,
              avatarUrl: message.authorAvatarUrl,
            }}
            size="xs"
          />
        )}
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
        <div
          className={cn(
            "mb-1 flex items-center gap-1 text-micro font-medium text-text-secondary",
            isOwn && "justify-end"
          )}
        >
          <ArrowRight size={11} className="shrink-0" />
          <span className="text-text-primary">{toName}</span>
        </div>
      )}
      {summary ? (
        <>
          <div className="flex items-start gap-1.5">
            <button
              type="button"
              onClick={toggle}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand message" : "Collapse message"}
              className="shrink-0 rounded-md p-0.5 text-text-muted transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
            >
              {collapsed ? (
                <ChevronRight size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
            </button>
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-body font-medium leading-relaxed text-text-primary">
              {summary}
            </p>
          </div>
          {!collapsed && (
            <p className="mt-1 whitespace-pre-wrap break-words text-body leading-relaxed text-text-secondary">
              {message.body}
            </p>
          )}
        </>
      ) : (
        <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-text-primary">
          {message.body}
        </p>
      )}
      {receipt && <ReceiptLine status={receipt} own={isOwn} />}
    </article>
  );
}

/**
 * The delivery receipt under MY own outgoing standalone message — a quiet
 * text-micro line with a tiny leading dot. A real `failed` is danger-inked;
 * every other outcome, including the calm operator-chosen terminals, stays
 * muted (mirrors the SessionCard StatusChip). There is deliberately no
 * "Received"/"Read": the desktop does not ack, so the transcript is the only
 * source of truth.
 *
 * The line follows its bubble's side, so a receipt under a right-hand own
 * message reads flush to the same edge as the message it belongs to.
 */
function ReceiptLine({
  status,
  own = false,
}: {
  status: ReceiptStatus;
  /** True when the receipt sits under a right-aligned own bubble. */
  own?: boolean;
}) {
  const danger = status === "failed";
  return (
    <div
      className={cn(
        "mt-1.5 flex items-center gap-1 text-micro font-medium",
        own && "justify-end",
        danger ? "text-danger" : "text-text-muted"
      )}
    >
      <span
        className={cn(
          "h-1 w-1 shrink-0 rounded-full",
          danger ? "bg-danger" : "bg-text-muted"
        )}
      />
      {RECEIPT_LABEL[status]}
    </div>
  );
}
