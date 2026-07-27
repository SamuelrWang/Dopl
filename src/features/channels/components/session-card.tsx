"use client";

import { cn } from "@/shared/lib/utils";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { AvatarWithPresence } from "@/shared/ui/avatar-with-presence";
import type { SessionGroup, SessionStatus } from "../lib/group-thread";

/**
 * One spawned-agent session as a single bordered card. The header carries the
 * status chip (Active / Done / Failed), the responding agent's identity +
 * relative time, and a one-line summary; the body holds the agent reply
 * message(s) and any `task_progress` lines in seq order. The flat
 * task_started/finished rows are replaced by the chip, not shown separately.
 *
 * Card geometry follows the message-bubble family (`rounded-[10px]` border,
 * `px-3.5` padding); the header strip reuses the `bg-card-surface-subtle`
 * section-header recipe.
 */
export function SessionCard({
  session,
  online,
}: {
  session: SessionGroup;
  /** True when the responding agent's operator is currently listening. */
  online: boolean;
}) {
  const name = session.head.authorName || "Agent";
  const replies = session.entries.filter((e) => e.kind === "message");
  const showWorking = session.status === "active" && replies.length === 0;

  return (
    <article className="overflow-hidden rounded-[10px] border border-border-default bg-bg-elevated">
      <header className="flex items-start gap-2 border-b border-border-subtle bg-card-surface-subtle px-3.5 py-2">
        <AvatarWithPresence
          person={{
            userId: session.head.authorUserId ?? name,
            email: null,
            displayName: session.head.authorName,
            avatarUrl: session.head.authorAvatarUrl,
          }}
          online={online}
          size="xs"
          title={online ? "Agent listening" : "Agent offline"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-micro font-medium uppercase tracking-wide text-text-muted">
              {name} · {formatRelativeTime(session.createdAt)}
            </span>
            <StatusChip status={session.status} />
          </div>
          {session.summary && (
            <p className="mt-0.5 truncate text-caption text-text-secondary">
              {session.summary}
            </p>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-2 px-3.5 py-2.5">
        {session.entries.map((entry) =>
          entry.kind === "message" ? (
            <p
              key={entry.id}
              className="whitespace-pre-wrap break-words text-body leading-relaxed text-text-primary"
            >
              {entry.body}
            </p>
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
      </div>
    </article>
  );
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  active: "Active",
  done: "Done",
  failed: "Failed",
};

/**
 * The session status chip. `Active` carries a pulsing success ring (the live
 * affordance); `Done` a solid success dot; `Failed` a danger dot + danger ink.
 */
function StatusChip({ status }: { status: SessionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium",
        status === "failed" ? "text-danger" : status === "active" ? "text-success" : "text-text-secondary"
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
            status === "failed" ? "bg-danger" : "bg-success"
          )}
        />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}
