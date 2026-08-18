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
import { pendingRow } from "@/shared/ui/pending";
import { isPendingId } from "../lib/optimistic-cache";
import { splitSessionEntries, type SessionGroup } from "../lib/group-thread";
import type { ChannelThread } from "../types";
import {
  CALM_TERMINAL_NOTE,
  ModeBadge,
  StatusChip,
} from "./session-card-status";
// ⚠ `session-card-close.tsx` (the close PROMPT and the close FORM) was DELETED
// with thread closing — wiring plan Phase 4, 2026-08-18. Threads do not close;
// the operator pauses or ends an AGENT.
import { isThreadParty, ReadOnlyThreadBadge } from "./thread-party";

/**
 * One THREAD as a single bordered card. Header: overlay title (falling back to
 * the derived summary), opener identity + absolute time, and a mode badge for a
 * first-class thread. Body nests EVERY message attributed (author + avatar +
 * time per entry); `task_progress` stays a subtle progress row. ⚠ The
 * `task_started/finished/failed` markers never appear in the body — they BECOME
 * the footer status chip.
 *
 * ⚠ A channel runs MANY threads between different pairs, so the card never
 * assumes the thread is the viewer's: when the thread row says they are neither
 * creator nor addressee, the footer drops "Open thread" for a read-only marker.
 * That button opens a window BOUND to this thread and the desktop forces the tag
 * onto whatever it posts (`session-outbound-tag.js`), so a non-party reaches
 * only a server refusal. A legacy session has no thread row, so nothing is
 * claimed either way.
 *
 * Geometry follows the message-bubble family (`rounded-[10px]`, `px-3.5`);
 * header/footer strips reuse `bg-card-surface-subtle`. ⚠ The container is ALWAYS
 * neutral — status is the chip's job alone.
 */
export function SessionCard({
  session,
  highlighted = false,
  thread,
  currentUserId,
}: {
  session: SessionGroup;
  /** Transient ring while the thread panel has navigated to this card. */
  highlighted?: boolean;
  /** Authoritative thread row (`channel_tasks`) carrying `createdBy` /
   *  `targetUserId`. Absent for a legacy session, in which case the card
   *  claims nothing about who the parties are. */
  thread?: ChannelThread;
  /** Viewer's user id — decides the read-only badge for a non-party. */
  currentUserId?: string;
}) {
  // Per-entry collapse. Every entry present AT MOUNT starts collapsed; entries
  // that ARRIVE while mounted are deliberately NOT added — live activity the
  // viewer is watching renders expanded.
  // ⚠ Component-local on purpose: expansion is a transient reading gesture, not
  // a preference. Do not persist it.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const entry of session.entries) {
      if (entry.kind === "message") {
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

  // ⚠ THE WHOLE CLOSE AFFORDANCE ENDED HERE (wiring plan Phase 4, 2026-08-18):
  // the "Close thread" button, the propose-then-confirm PROMPT an agent's
  // marked note raised, and the local "Keep open" dismissal that went with it.
  // Threads do not close, so the card has no decision to offer — the operator
  // pauses or ends an AGENT instead. `isThreadParty` survives for the read-only
  // badge below, which is about who may POST, not about who may settle.
  const canManageThread = !!thread && isThreadParty(thread, currentUserId);
  // Provably someone else's thread. Without the row (legacy session) or a viewer
  // id the parties are unknown, so keep the normal footer rather than guess.
  const viewerIsOutsider = !!thread && !!currentUserId && !canManageThread;

  const openerName = session.head.authorName || "Agent";
  const title = session.title ?? session.summary ?? "Thread";
  // Body lanes split at render time: chat replies keep nested attributed
  // rendering; `task_progress` milestones get the ✓ list; NOTICES (the reopen
  // echo) get the calm one-liner. ⚠ Never the ✓ for a notice — on a just-reopened
  // thread it reads as "done". Purely presentational; `groupThread` is unchanged.
  const { milestones, replies, notices } = splitSessionEntries(session.entries);
  const agentReplies = replies.filter((e) => e.authorKind === "agent");
  const showWorking = session.status === "active" && agentReplies.length === 0;
  // ⚠ A calm session-end (interrupted/capped/ended) with no restart means the
  // session stopped even when an open-thread overlay pins status "active" — show
  // its note in place of "Working…" rather than lie.
  const calmEndNote = session.calmEndStatus
    ? CALM_TERMINAL_NOTE[session.calmEndStatus]
    : undefined;
  // A calm terminal never delivered a reply — show a one-line note, not an empty
  // body. When an overlay pins "active", `status` is not terminal, so
  // `calmEndNote` above carries it instead.
  const terminalNote =
    replies.length === 0 ? CALM_TERMINAL_NOTE[session.status] : undefined;

  // PROVISIONAL: an optimistically-opened request renders from a message the
  // server has not acknowledged (head carries a `pending:` id), so the card is
  // dimmed and inert until the POST answers. `pending.ts` owns the recipe.
  const provisional = isPendingId(session.head.id);

  return (
    <article
      id={`session:${session.taskId}`}
      {...pendingRow(
        provisional,
        cn(
          "overflow-hidden rounded-[10px] border border-border-default bg-bg-elevated",
          highlighted && "ring-2 ring-border-highlight"
        )
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
        {/* F-176 — status lines, not accomplishments; see `splitSessionEntries`. */}
        {notices.map((notice) => (
          <div key={notice.id} className="flex items-start gap-1.5">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-disabled" />
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-caption text-text-secondary">
              {notice.body}
            </span>
            <span className="shrink-0 text-micro text-text-muted">
              {formatChannelTimestamp(notice.createdAt)}
            </span>
          </div>
        ))}
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
        {viewerIsOutsider ? (
          <ReadOnlyThreadBadge />
        ) : (
          <ReopenWindowButton
            channelId={session.head.channelId}
            threadId={session.taskId}
          />
        )}
        <StatusChip status={session.status} />
      </footer>
    </article>
  );
}

/** ⚠ The one actionable refusal: the desktop cannot reach this CHANNEL (not a
 *  member, deleted, signed out). A thread with no local record is NOT this case
 *  — the desktop opens a read-only shell. Copy is about the CHANNEL. */
export const NO_LOCAL_SESSION_NOTE =
  "This channel isn't available on this machine.";

/** Window budget spent. ⚠ Visible noun is THREAD; the constant name is not. */
export const SESSION_BUDGET_NOTE =
  "Too many thread windows are open. Close one and try again.";

/**
 * Open this thread's session via the main-window bridge and turn the desktop's
 * verdict into the note (if any) to show.
 *
 * ⚠ A window opens for ANY reachable thread — live, parked, settled, or never
 * seen on this machine — so the absence of a local record is NOT a failure and
 * must stay SILENT. Only genuine refusals speak:
 *   `no-thread` — the channel is unreachable (not a member, deleted, signed out)
 *   `busy`      — the window budget is spent
 * Anything else (older desktop with no reason, a transport throw) stays quiet.
 */
export async function reopenSessionWindow(
  bridge: DoplSessionsBridge,
  channelId: string,
  threadId: string
): Promise<string | null> {
  const result = await bridge.reopen(channelId, threadId);
  if (result?.ok) return null;
  if (result?.reason === "no-thread") return NO_LOCAL_SESSION_NOTE;
  if (result?.reason === "busy") return SESSION_BUDGET_NOTE;
  return null;
}

/**
 * Desktop-only footer control opening this thread's session. ⚠ ALWAYS clickable
 * — status never gates it, and it takes no session/thread status at all.
 *
 * ⚠ Renders NOTHING in a plain browser or older desktop build; the bridge is
 * feature-detected AFTER MOUNT so SSR and first client render agree
 * (hydration-safe). Opening is in-process — never starts a query, and gated
 * tools still gate on reshow.
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
  const [note, setNote] = useState<string | null>(null);

  // ⚠ Feature-detect after mount so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopSessions());
  }, []);

  // Plain browser or older desktop build without the sessions API.
  if (!bridge) return null;

  return (
    <OpenWindowControls
      busy={busy}
      note={note}
      onOpen={async () => {
        if (busy) return;
        setBusy(true);
        setNote(null);
        try {
          setNote(await reopenSessionWindow(bridge, channelId, threadId));
        } catch {
          // A thrown invoke is a transport failure, not a verdict — stay quiet.
          setNote(null);
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

/**
 * The session control's markup. ⚠ NO status gate on the button — the only thing
 * that disables it is an open call already in flight, so a double-click cannot
 * fire two invokes.
 */
export function OpenWindowControls({
  busy,
  note,
  onOpen,
}: {
  /** True only while an open call is in flight. */
  busy: boolean;
  /** The refusal note to show, or null when the open succeeded (or stayed quiet). */
  note: string | null;
  onOpen: () => void;
}) {
  return (
    <>
      {note && (
        <span className="shrink-0 truncate text-caption text-text-muted">
          {note}
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onOpen}
        className="btn-light shrink-0 rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
      >
        Open thread
      </button>
    </>
  );
}

/** A non-empty string `metadata.summary`, promoted to the entry's headline. */
function readSummary(metadata: Record<string, unknown>): string | null {
  const value = metadata.summary;
  return typeof value === "string" && value.length > 0 ? value : null;
}
