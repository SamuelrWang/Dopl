"use client";

import { cn } from "@/shared/lib/utils";
import { isCalmTerminalStatus, type SessionStatus } from "../lib/group-thread";
import type { TaskMode } from "../types";

/** The footer chip's label per session status. */
export const STATUS_LABEL: Record<SessionStatus, string> = {
  active: "Task active",
  done: "Task complete",
  failed: "Task failed",
  declined: "Declined",
  dropped: "Reply not sent",
  interrupted: "Interrupted",
  capped: "Limit reached",
  ended: "Session ended",
};

/** Calm one-line body note for a terminal that delivered no reply. */
export const CALM_TERMINAL_NOTE: Partial<Record<SessionStatus, string>> = {
  declined: "This request was declined.",
  dropped: "The reply was not sent.",
  interrupted: "The session was interrupted.",
  capped: "The session hit its turn limit. Reopen the window to continue.",
  ended: "The session was ended on the desktop. The task stays open.",
};

/** The task's execution mode, shown as a quiet pill on a first-class task. */
export function ModeBadge({ mode }: { mode: TaskMode }) {
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
 * `Interrupted` / `Limit reached` / `Session ended`) are operator-chosen or
 * benign endings — deliberately calm (muted ink + a neutral dot), NOT the
 * alarm-red of a real failure, since each is a normal outcome, not an error.
 */
export function StatusChip({ status }: { status: SessionStatus }) {
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
