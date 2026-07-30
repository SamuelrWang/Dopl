"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import {
  getDesktopSessions,
  type DoplSessionsBridge,
} from "@/shared/lib/desktop";
import { Avatar } from "@/shared/ui/avatar";
import { splitSessionEntries, type SessionGroup } from "../lib/group-thread";
import type { ChannelThread, ThreadOutcome } from "../types";
import {
  CALM_TERMINAL_NOTE,
  ModeBadge,
  StatusChip,
} from "./session-card-status";

/**
 * One THREAD as a single bordered card, rendering the session that worked it.
 * The header carries the thread title (the authoritative overlay title, falling
 * back to the derived summary), the opener's identity + absolute time, and — for
 * a first-class thread — a mode badge. The body nests EVERY message of the
 * exchange attributed (the requester's request and each agent reply, author +
 * avatar + time per entry); `task_progress` lines stay as subtle progress rows.
 * The `task_started/finished/failed` lifecycle markers never appear in the body
 * — they become the status chip in the footer (Thread active / Thread complete
 * / Thread failed, or a calm terminal label for an operator-chosen ending).
 *
 * Card geometry follows the message-bubble family (`rounded-[10px]` border,
 * `px-3.5` padding); the header + footer strips reuse the
 * `bg-card-surface-subtle` section-strip recipe. The container is
 * status-driven: an `active` thread carries the success-tinted surface (the
 * agent is working), every settled ending stays neutral. That pairs with the
 * warning-tinted consent card at the transcript bottom, so the channel reads on
 * one color rule: amber is waiting on a human, green is an agent at work.
 */
export function SessionCard({
  session,
  highlighted = false,
  thread,
  currentUserId,
  onCloseThread,
}: {
  session: SessionGroup;
  /** Transient ring while the thread panel has navigated to this card. */
  highlighted?: boolean;
  /**
   * The authoritative thread row for this session (from `channel_tasks` — the
   * storage name), carrying `createdBy` / `targetUserId` / `status`; it gates
   * the Close control. Absent for a legacy (non first-class) session, or until
   * the integration pass threads it through from the channel's `threads` by
   * `session.taskId`; in either case no thread controls render.
   */
  thread?: ChannelThread;
  /** The viewer's user id — the controls show only for a thread's creator or target. */
  currentUserId?: string;
  /** Close this thread with an outcome + optional summary. Absent hides Close. */
  onCloseThread?: (
    threadId: string,
    outcome: ThreadOutcome,
    summary: string
  ) => Promise<void>;
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

  // Close gating: only a thread's creator or target may close it, and only when
  // the close callback is wired. Reopening a closed thread lives in the thread
  // panel (the header's thread list), never on the card.
  const [closing, setClosing] = useState(false);
  const canManageThread =
    !!thread &&
    !!currentUserId &&
    (currentUserId === thread.createdBy ||
      currentUserId === thread.targetUserId);
  const showClose =
    canManageThread && thread?.status === "open" && !!onCloseThread;

  const openerName = session.head.authorName || "Agent";
  const title = session.title ?? session.summary ?? "Thread";
  // Separate the two body lanes at render time: chat replies keep the nested
  // attributed-message rendering; `task_progress` milestones render as a
  // distinct check-marked accomplishment list. `groupThread`'s output is
  // unchanged — the split is purely presentational.
  const { milestones, replies } = splitSessionEntries(session.entries);
  const agentReplies = replies.filter((e) => e.authorKind === "agent");
  const showWorking = session.status === "active" && agentReplies.length === 0;
  // The honest "Working…" line: a calm session-end (interrupted/capped/ended)
  // with no restart means the session stopped, even when an open-thread overlay
  // still pins the status to "active". Show that end's calm note in place of
  // "Working…" rather than lie. An agent reply already suppressed the line via
  // `showWorking`, so this only fires when the card would otherwise say Working.
  const calmEndNote = session.calmEndStatus
    ? CALM_TERMINAL_NOTE[session.calmEndStatus]
    : undefined;
  // An operator-chosen calm terminal (declined/dropped/interrupted/capped/ended)
  // never delivered a reply, so show a calm one-line note rather than an empty
  // body. (When an overlay pins "active", `status` is not a terminal, so this is
  // undefined and the `calmEndNote` path above carries the note instead.)
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
        {showWorking &&
          (calmEndNote ? (
            <p className="text-caption text-text-secondary">{calmEndNote}</p>
          ) : (
            <p className="text-caption italic text-text-muted">Working…</p>
          ))}
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
        {showClose && !closing && (
          <button
            type="button"
            onClick={() => setClosing(true)}
            className="btn-light shrink-0 rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary"
          >
            Close thread
          </button>
        )}
        <ReopenWindowButton
          channelId={session.head.channelId}
          threadId={session.taskId}
        />
        <StatusChip status={session.status} />
      </footer>
      {showClose && closing && thread && onCloseThread && (
        <ThreadCloseForm
          onSubmit={async (outcome, summary) => {
            await onCloseThread(thread.id, outcome, summary);
            setClosing(false);
          }}
          onCancel={() => setClosing(false)}
        />
      )}
    </article>
  );
}

/**
 * The one note the session control can show: the desktop found NO durable record
 * of this thread on this machine, so there is nothing to open. Every other case
 * opens a session (a thread whose session is parked, settled, or gone still gets
 * a shell seeded with the channel's history), so this copy is deliberately about
 * the machine, not about a session being live.
 */
export const NO_LOCAL_SESSION_NOTE =
  "This thread has no session on this machine.";

/**
 * Open this thread's session from the web card, via the main-window bridge.
 * Resolves the bridge's verdict: `false` means no record of the thread exists on
 * this machine (the {@link NO_LOCAL_SESSION_NOTE} case) — NOT merely that no
 * session is live, since the desktop recreates a shell for a parked or settled
 * thread. Exported for unit testing the click action.
 */
export async function reopenSessionWindow(
  bridge: DoplSessionsBridge,
  channelId: string,
  threadId: string
): Promise<boolean> {
  const result = await bridge.reopen(channelId, threadId);
  return !!result?.ok;
}

/**
 * Desktop-only footer control that opens this thread's session. It renders
 * whenever the bridge exists and is ALWAYS clickable: status never gates it, and
 * it takes no session/thread status at all, because the desktop can open a
 * session for any thread it has a record of — live, parked, or long settled (a
 * recreated shell shows the channel's history and typing starts a fresh
 * session).
 *
 * Renders NOTHING in a plain browser or an older desktop build — the bridge is
 * feature-detected after mount so SSR and first client render agree
 * (hydration-safe). Opening happens in-process (no server/realtime state,
 * F-072); it never starts a query, and gated tools still gate on reshow. Only a
 * genuine `{ ok: false }` (no record on this machine) shows the note.
 */
export function ReopenWindowButton({
  channelId,
  threadId,
}: {
  channelId: string;
  threadId: string;
}) {
  const [bridge, setBridge] = useState<DoplSessionsBridge | null>(null);
  const [busy, setBusy] = useState(false);
  const [noLocalSession, setNoLocalSession] = useState(false);

  // Feature-detect after mount (window-only) so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopSessions());
  }, []);

  // Plain browser (or an older desktop build without the sessions API): nothing.
  if (!bridge) return null;

  return (
    <OpenWindowControls
      busy={busy}
      noLocalSession={noLocalSession}
      onOpen={async () => {
        if (busy) return;
        setBusy(true);
        setNoLocalSession(false);
        try {
          const ok = await reopenSessionWindow(bridge, channelId, threadId);
          // Only the bridge's definitive "no record here" answer notes anything.
          setNoLocalSession(!ok);
        } catch {
          // A thrown invoke is a transport failure, not a verdict about the
          // thread, so it stays quiet: the operator can click again.
          setNoLocalSession(false);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

/**
 * The session control's markup: the optional one-line note plus the button. The
 * button carries NO status gate — the only thing that ever disables it is an
 * open call already in flight, so a double-click can't fire two invokes.
 * Exported so its always-enabled shape can be asserted without the post-mount
 * bridge detection.
 */
export function OpenWindowControls({
  busy,
  noLocalSession,
  onOpen,
}: {
  /** True only while an open call is in flight. */
  busy: boolean;
  /** True after a genuine `{ ok: false }` — shows the note. */
  noLocalSession: boolean;
  onOpen: () => void;
}) {
  return (
    <>
      {noLocalSession && (
        <span className="shrink-0 truncate text-caption text-text-muted">
          {NO_LOCAL_SESSION_NOTE}
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onOpen}
        className="btn-light shrink-0 rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
      >
        Open session
      </button>
    </>
  );
}

/**
 * The inline close form: an optional one-line summary well plus the two outcome
 * actions. "Mark complete" / "Mark failed" each close the thread with that
 * outcome and the typed summary; Cancel collapses without a write. Buttons
 * disable while a close is in flight so a double-click can't fire two writes.
 */
function ThreadCloseForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (outcome: ThreadOutcome, summary: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(outcome: ThreadOutcome) {
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
