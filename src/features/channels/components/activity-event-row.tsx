"use client";

import { cn } from "@/shared/lib/utils";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { calmTerminalStatus } from "../lib/group-thread";
import type { ChannelMessage, ChannelMessageKind } from "../types";

/** Dot color by activity kind: finished = success, running = warning,
 *  failed = danger, system = neutral. */
const DOT: Record<Exclude<ChannelMessageKind, "message">, string> = {
  task_finished: "bg-success",
  task_started: "bg-warning",
  task_progress: "bg-warning",
  task_failed: "bg-danger",
  system: "bg-surface-raised-4 ring-1 ring-border-default",
};

function statusOf(metadata: Record<string, unknown>): string | null {
  const status = metadata.status;
  return typeof status === "string" && status.length > 0 ? status : null;
}

/**
 * A structured activity event (task_* / system) as a flat, centered,
 * borderless system line — no bubble. A colored dot signals state, the
 * human-readable render sits in `body`, and an optional status pill +
 * relative timestamp trail it.
 *
 * A `task_failed` carrying an operator-chosen calm-terminal flag
 * (`declined`/`dropped`/`interrupted`) is not a real failure — it gets a
 * neutral dot (not the danger red) so it reads calm even when it lands
 * ungrouped (no `taskId`, so it never folded into a session card).
 */
export function ActivityEventRow({ message }: { message: ChannelMessage }) {
  const kind = message.kind as Exclude<ChannelMessageKind, "message">;
  const status = statusOf(message.metadata);
  const calmTerminal = calmTerminalStatus(message) !== null;
  const dot = calmTerminal
    ? "bg-text-disabled"
    : DOT[kind] ?? "bg-surface-raised-4";
  return (
    <div className="flex items-center justify-center gap-2 py-1.5">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      <span className="min-w-0 truncate text-caption text-text-secondary">
        {message.body}
      </span>
      {status && (
        <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
          {status}
        </span>
      )}
      <span className="shrink-0 text-micro text-text-muted">
        {formatChannelTimestamp(message.createdAt)}
      </span>
    </div>
  );
}
