"use client";

import { cn } from "@/shared/lib/utils";
import { isCalmTerminalStatus, type SessionStatus } from "../lib/group-thread";
import type { ThreadMode } from "../types";

/**
 * The footer chip's label per status.
 *
 * VOCABULARY: the visible noun is THREAD everywhere it can be, because the card
 * and the window it opens depict a thread. `ended` is the one label that cannot
 * simply become "Thread ended" without lying — the desktop run stopped, the
 * THREAD stays open — so it names where it happened instead.
 */
export const STATUS_LABEL: Record<SessionStatus, string> = {
  active: "Thread active",
  done: "Thread complete",
  failed: "Thread failed",
  declined: "Declined",
  dropped: "Reply not sent",
  interrupted: "Interrupted",
  capped: "Limit reached",
  ended: "Ended on desktop",
};

/** Calm one-line body note for a terminal that delivered no reply. */
export const CALM_TERMINAL_NOTE: Partial<Record<SessionStatus, string>> = {
  declined: "This request was declined.",
  dropped: "The reply was not sent.",
  interrupted: "Work on this thread was interrupted.",
  capped: "This thread hit its turn limit. Open the thread to continue.",
  ended: "Ended on the desktop. The thread stays open.",
};

/** The thread's mode, shown as a quiet pill on a first-class thread. */
export function ModeBadge({ mode }: { mode: ThreadMode }) {
  return (
    <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
      {mode === "interactive" ? "Interactive" : "Autonomous"}
    </span>
  );
}

/**
 * The thread status chip. `Thread active` carries a pulsing success ring (the
 * live affordance); `Thread complete` a solid success dot; `Thread failed` a
 * danger dot + danger ink. The calm terminal states (`Declined` / `Reply not sent` /
 * `Interrupted` / `Limit reached` / `Ended on desktop`) are operator-chosen or
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
