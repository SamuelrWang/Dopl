"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { Avatar } from "@/shared/ui/avatar";
import {
  isCalmTerminalStatus,
  type SessionGroup,
  type SessionStatus,
} from "../lib/group-thread";
import type { TaskMode } from "../types";

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
}: {
  session: SessionGroup;
  /** Transient ring while the task panel has navigated to this card. */
  highlighted?: boolean;
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

  const openerName = session.head.authorName || "Agent";
  const title = session.title ?? session.summary ?? "Task";
  const messageEntries = session.entries.filter((e) => e.kind === "message");
  const agentReplies = messageEntries.filter((e) => e.authorKind === "agent");
  const showWorking = session.status === "active" && agentReplies.length === 0;
  // An operator-chosen calm terminal (declined/dropped/interrupted) never
  // delivered a reply, so show a calm one-line note rather than an empty body.
  const terminalNote =
    messageEntries.length === 0 ? CALM_TERMINAL_NOTE[session.status] : undefined;

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
        {session.entries.map((entry) =>
          entry.kind === "message" ? (
            (() => {
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
            })()
          ) : (
            <div key={entry.id} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
              <span className="min-w-0 truncate text-caption text-text-secondary">
                {entry.body}
              </span>
            </div>
          )
        )}
        {showWorking && (
          <p className="text-caption italic text-text-muted">Working…</p>
        )}
        {terminalNote && (
          <p className="text-caption text-text-secondary">{terminalNote}</p>
        )}
      </div>

      <footer className="flex items-center justify-end border-t border-border-subtle bg-card-surface-subtle px-3.5 py-1.5">
        <StatusChip status={session.status} />
      </footer>
    </article>
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
