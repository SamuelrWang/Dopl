"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { Avatar } from "@/shared/ui/avatar";
import {
  isCalmTerminalStatus,
  splitSessionEntries,
  type SessionGroup,
  type SessionStatus,
} from "../lib/group-thread";
import type { ChannelTask, TaskMode, TaskOutcome } from "../types";

/**
 * One task as a single bordered card. The header carries the task title (the
 * first-class overlay title, falling back to the derived summary), the opener's
 * identity + absolute time, and — for a first-class task — a mode badge. The
 * body nests EVERY message of the exchange attributed (the requester's request
 * and each agent reply, author + avatar + time per entry); `task_progress`
 * lines stay as subtle progress rows. The `task_started/finished/failed`
 * lifecycle markers never appear in the body — they become the status chip in
 * the footer (Task active / Task complete / Task failed, or a calm terminal
 * label for an operator-chosen ending).
 *
 * Card geometry follows the message-bubble family (`rounded-[10px]` border,
 * `px-3.5` padding); the header + footer strips reuse the
 * `bg-card-surface-subtle` section-strip recipe.
 */
export function SessionCard({
  session,
  highlighted = false,
  task,
  currentUserId,
  onCloseTask,
  onReopenTask,
}: {
  session: SessionGroup;
  /** Transient ring while the task panel has navigated to this card. */
  highlighted?: boolean;
  /**
   * The authoritative first-class task row for this session (from
   * `channel_tasks`), carrying `createdBy` / `targetUserId` / `status` — it
   * gates the Close / Reopen controls. Absent for a legacy (non first-class)
   * session, or until the integration pass threads it through from the thread's
   * `tasks` by `session.taskId`; in either case no task controls render.
   */
  task?: ChannelTask;
  /** The viewer's user id — the controls show only for a task's creator or target. */
  currentUserId?: string;
  /** Close this task with an outcome + optional summary. Absent hides Close. */
  onCloseTask?: (
    taskId: string,
    outcome: TaskOutcome,
    summary: string
  ) => Promise<void>;
  /** Reopen this closed task. Absent hides Reopen. */
  onReopenTask?: (taskId: string) => Promise<void>;
}) {
  // Per-entry collapse. An entry that leads with a one-line summary starts
  // COLLAPSED (summary only, full body behind the chevron); an entry with no
  // summary keeps today's behavior (body shown, the chevron hides it). Clicking
  // the chevron toggles just that entry's body, keeping its avatar/author/time.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const entry of session.entries) {
      if (entry.kind === "message" && readSummary(entry.metadata)) {
        initial.add(entry.id);
      }
    }
    return initial;
  });
  const toggleEntry = (id: string) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Close / Reopen gating: only a first-class task's creator or target may
  // manage it, and only when the callback for the relevant direction is wired.
  const [closing, setClosing] = useState(false);
  const canManageTask =
    !!task &&
    !!currentUserId &&
    (currentUserId === task.createdBy || currentUserId === task.targetUserId);
  const showClose = canManageTask && task?.status === "open" && !!onCloseTask;
  const showReopen = canManageTask && task?.status === "closed" && !!onReopenTask;

  const openerName = session.head.authorName || "Agent";
  const title = session.title ?? session.summary ?? "Task";
  // Separate the two body lanes at render time: chat replies keep the nested
  // attributed-message rendering; `task_progress` milestones render as a
  // distinct check-marked accomplishment list. `groupThread`'s output is
  // unchanged — the split is purely presentational.
  const { milestones, replies } = splitSessionEntries(session.entries);
  const agentReplies = replies.filter((e) => e.authorKind === "agent");
  const showWorking = session.status === "active" && agentReplies.length === 0;
  // An operator-chosen calm terminal (declined/dropped/interrupted) never
  // delivered a reply, so show a calm one-line note rather than an empty body.
  const terminalNote =
    replies.length === 0 ? CALM_TERMINAL_NOTE[session.status] : undefined;

  return (
    <article
      id={`session:${session.taskId}`}
      className={cn(
        "overflow-hidden rounded-[10px] border border-border-default bg-bg-elevated",
        highlighted && "ring-2 ring-border-highlight"
      )}
    >
      <header className="flex items-start gap-2 border-b border-border-subtle bg-card-surface-subtle px-3.5 py-2">
        <Avatar
          person={{
            userId: session.head.authorUserId ?? openerName,
            email: null,
            displayName: session.head.authorName,
            avatarUrl: session.head.authorAvatarUrl,
          }}
          size="xs"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-body font-medium text-text-primary">
              {title}
            </span>
            {session.mode && <ModeBadge mode={session.mode} />}
          </div>
          <span className="mt-0.5 block truncate text-micro font-medium uppercase tracking-wide text-text-muted">
            {openerName} · {formatChannelTimestamp(session.createdAt)}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-2.5 px-3.5 py-2.5">
        {replies.map((entry) => {
          const collapsed = collapsedIds.has(entry.id);
          const summary = readSummary(entry.metadata);
          return (
            <div key={entry.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleEntry(entry.id)}
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
                <Avatar
                  person={{
                    userId: entry.authorUserId ?? entry.authorName ?? "member",
                    email: null,
                    displayName: entry.authorName,
                    avatarUrl: entry.authorAvatarUrl,
                  }}
                  size="xs"
                />
                <span className="min-w-0 truncate text-micro font-medium uppercase tracking-wide text-text-muted">
                  {entry.authorName ||
                    (entry.authorKind === "user" ? "Member" : "Agent")}{" "}
                  · {formatChannelTimestamp(entry.createdAt)}
                </span>
              </div>
              {summary && (
                <p className="whitespace-pre-wrap break-words text-body font-medium leading-relaxed text-text-primary">
                  {summary}
                </p>
              )}
              {!collapsed && (
                <p
                  className={cn(
                    "whitespace-pre-wrap break-words text-body leading-relaxed",
                    summary ? "text-text-secondary" : "text-text-primary"
                  )}
                >
                  {entry.body}
                </p>
              )}
            </div>
          );
        })}
        {showWorking && (
          <p className="text-caption italic text-text-muted">Working…</p>
        )}
        {terminalNote && (
          <p className="text-caption text-text-secondary">{terminalNote}</p>
        )}
        {milestones.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-[8px] bg-card-surface-subtle px-3 py-2">
            <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
              Milestones
            </span>
            {milestones.map((milestone) => (
              <div key={milestone.id} className="flex items-start gap-1.5">
                <Check size={12} className="mt-0.5 shrink-0 text-success" />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-caption text-text-secondary">
                  {milestone.body}
                </span>
                <span className="shrink-0 text-micro text-text-muted">
                  {formatChannelTimestamp(milestone.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-border-subtle bg-card-surface-subtle px-3.5 py-1.5">
        {session.outcomeSummary && (
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-caption",
              session.status === "failed" ? "text-danger" : "text-text-secondary"
            )}
          >
            {session.outcomeSummary}
          </span>
        )}
        {showReopen && task && onReopenTask && (
          <ReopenTaskButton onReopen={() => onReopenTask(task.id)} />
        )}
        {showClose && !closing && (
          <button
            type="button"
            onClick={() => setClosing(true)}
            className="btn-light shrink-0 rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary"
          >
            Close task
          </button>
        )}
        <StatusChip status={session.status} />
      </footer>
      {showClose && closing && task && onCloseTask && (
        <TaskCloseForm
          onSubmit={async (outcome, summary) => {
            await onCloseTask(task.id, outcome, summary);
            setClosing(false);
          }}
          onCancel={() => setClosing(false)}
        />
      )}
    </article>
  );
}

/** A compact raised button that reopens a closed task, disabled while in flight. */
function ReopenTaskButton({ onReopen }: { onReopen: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await onReopen();
        } finally {
          setBusy(false);
        }
      }}
      className="btn-light shrink-0 rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
    >
      Reopen task
    </button>
  );
}

/**
 * The inline close form: an optional one-line summary well plus the two outcome
 * actions. "Mark complete" / "Mark failed" each close the task with that outcome
 * and the typed summary; Cancel collapses without a write. Buttons disable while
 * a close is in flight so a double-click can't fire two writes.
 */
function TaskCloseForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (outcome: TaskOutcome, summary: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(outcome: TaskOutcome) {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(outcome, summary.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle bg-card-surface-subtle px-3.5 py-2.5">
      <input
        type="text"
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        disabled={busy}
        maxLength={2000}
        placeholder="Add a closing summary (optional)"
        className="concave-field w-full rounded-[8px] px-2.5 py-1.5 text-caption text-text-primary placeholder:text-text-muted"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-secondary disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => submit("failed")}
          disabled={busy}
          className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-danger disabled:opacity-60"
        >
          Mark failed
        </button>
        <button
          type="button"
          onClick={() => submit("completed")}
          disabled={busy}
          className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
        >
          Mark complete
        </button>
      </div>
    </div>
  );
}

/** A non-empty string `metadata.summary`, promoted to the entry's headline. */
function readSummary(metadata: Record<string, unknown>): string | null {
  const value = metadata.summary;
  return typeof value === "string" && value.length > 0 ? value : null;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  active: "Task active",
  done: "Task complete",
  failed: "Task failed",
  declined: "Declined",
  dropped: "Reply not sent",
  interrupted: "Interrupted",
};

/** Calm one-line body note for a terminal that delivered no reply. */
const CALM_TERMINAL_NOTE: Partial<Record<SessionStatus, string>> = {
  declined: "This request was declined.",
  dropped: "The reply was not sent.",
  interrupted: "The session was interrupted.",
};

/** The task's execution mode, shown as a quiet pill on a first-class task. */
function ModeBadge({ mode }: { mode: TaskMode }) {
  return (
    <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
      {mode === "interactive" ? "Interactive" : "Autonomous"}
    </span>
  );
}

/**
 * The task status chip. `Task active` carries a pulsing success ring (the live
 * affordance); `Task complete` a solid success dot; `Task failed` a danger dot +
 * danger ink. The calm terminal states (`Declined` / `Reply not sent` /
 * `Interrupted`) are operator-chosen endings — deliberately calm (muted ink + a
 * neutral dot), NOT the alarm-red of a real failure, since each is a normal
 * outcome the requester chose, not an error.
 */
function StatusChip({ status }: { status: SessionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium",
        status === "failed"
          ? "text-danger"
          : status === "active"
            ? "text-success"
            : "text-text-secondary"
      )}
    >
      {status === "active" ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
        </span>
      ) : (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            status === "failed"
              ? "bg-danger"
              : isCalmTerminalStatus(status)
                ? "bg-text-disabled"
                : "bg-success"
          )}
        />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}
