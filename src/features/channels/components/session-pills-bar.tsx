"use client";

import { useCallback, useEffect, useState } from "react";
import { PanelTop } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { getSpaBridge, type DesktopSessionSummary } from "@/shared/lib/spa-bridge";

/**
 * THE SESSION PILLS BAR — which of the operator's agent sessions are running in
 * this channel, and what each of them is doing.
 *
 * It sits where the AGENT CHIPS BAR sat, and it is not that component rebuilt.
 * A chip was a SUMMONED NAMED AGENT — a server row you tagged with `@handle`,
 * whose state came off a column that could not see the desktop (which is why the
 * chip said "Idle" while the machine worked; rollback plan §2). A pill is a LIVE
 * SESSION on THIS machine, projected by the desktop itself. They are still called
 * agents in the copy below, because a session IS an agent session.
 *
 * DESKTOP-ONLY, AND SILENT WITHOUT IT. Everything here is a fact about the
 * operator's own machine, so there is nothing a browser could show: no bridge, no
 * bar — not an empty row, not a placeholder. That covers three cases with one
 * rule: the plain-browser dev server, the retired website (whose preload has
 * `reopen` but not the feed), and a desktop build older than this feature. The
 * detection is CAPABILITY-KEYED (`typeof … === "function"`), never a shell name
 * or a truthy `window.dopl` — see `@/shared/lib/spa-bridge` for why that
 * distinction has already cost one fleet outage.
 *
 * AFTER MOUNT, NEVER DURING RENDER. The bridge is a window global, so reading it
 * while rendering makes the server and the first client render disagree. The
 * subscription effect is the only place it is read, exactly as
 * `useChannelPermissionPreset` does it.
 */

/** What a pill's state says, in words. Color is never the only carrier. */
export const SESSION_PILL_LABEL: Record<DesktopSessionSummary["state"], string> = {
  working: "Working",
  idle: "Idle",
  ended: "Ended",
};

/** The one-line explanation the dropdown leads with — what to expect next. */
export const SESSION_PILL_HINT: Record<DesktopSessionSummary["state"], string> = {
  working: "Running a turn on your machine.",
  idle: "Between turns — waiting on a reply, or parked.",
  ended: "Finished. Its window is still open to read.",
};

/**
 * The dot. Solid for work in flight, hollow for idle, and a flat muted fill for
 * ended — three shapes, so the state is legible without color.
 */
function pillDotClass(state: DesktopSessionSummary["state"]): string {
  if (state === "working") return "bg-success";
  if (state === "idle") return "border border-text-disabled bg-transparent";
  return "bg-text-disabled";
}

/**
 * The pills for one channel. Pure, exported, and the ONLY filter in the renderer:
 * main pushes every session on the machine (the list is bounded by the desktop's
 * window budget, so there is nothing to page and no per-channel watch handshake to
 * get out of step), and each consumer takes its own slice.
 */
export function sessionsForChannel(
  sessions: readonly DesktopSessionSummary[],
  channelId: string
): DesktopSessionSummary[] {
  return sessions.filter((s) => s.channelId === channelId);
}

/**
 * Subscribe to the desktop's session feed. `null` means "no bridge" and is what
 * makes the bar render nothing; `[]` means a bridge that currently has no
 * sessions, which is a different fact and renders nothing too — but for the
 * component's own reason rather than the boundary's.
 */
function useSessionSummaries(): DesktopSessionSummary[] | null {
  const [summaries, setSummaries] = useState<DesktopSessionSummary[] | null>(null);

  useEffect(() => {
    const sessions = getSpaBridge()?.sessions;
    if (!sessions) return;
    // Both members are optional on the interface: an older main has `reopen` and
    // neither of these, and must degrade to no bar rather than to a broken call.
    const canRead = typeof sessions.summaries === "function";
    const canListen = typeof sessions.onSummaries === "function";
    if (!canRead || !canListen) return;

    let live = true;
    // READ ONCE, THEN LISTEN. The feed is a push, and a push-only surface leaves a
    // freshly opened channel blank until the next state change — which on a quiet
    // machine never comes.
    void sessions
      .summaries?.()
      .then((r) => {
        // The subscription below may already have delivered a NEWER frame while this
        // read was in flight; it must not be overwritten by the older answer.
        if (live) setSummaries((prev) => prev ?? r.sessions);
      })
      .catch(() => {
        if (live) setSummaries((prev) => prev ?? []);
      });

    const off = sessions.onSummaries?.((e) => {
      if (live) setSummaries(e.sessions);
    });
    return () => {
      live = false;
      off?.();
    };
  }, []);

  return summaries;
}

export function SessionPillsBar({ channelId }: { channelId: string }) {
  const summaries = useSessionSummaries();
  const [openId, setOpenId] = useState<string | null>(null);

  const open = useCallback(async (session: DesktopSessionSummary) => {
    setOpenId(null);
    // The SAME op the session card's "Open thread" calls, on purpose: main has one
    // reopen path (live window → an ended session's kept window → recreate a parked
    // shell), and a pill must not grow a second one. It opens a window and starts
    // nothing — no query, no gated tool, no wake.
    await getSpaBridge()?.sessions?.reopen(session.channelId, session.taskId);
  }, []);

  if (summaries === null) return null;
  const shown = sessionsForChannel(summaries, channelId);
  if (shown.length === 0) return null;

  return (
    <div
      aria-label="Agent sessions"
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-subtle px-3.5 py-1.5"
    >
      <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
        Agents
      </span>
      {shown.map((session) => (
        <div key={session.sessionId} className="relative">
          <button
            type="button"
            onClick={() =>
              setOpenId((v) => (v === session.sessionId ? null : session.sessionId))
            }
            title={`${session.name} · ${SESSION_PILL_LABEL[session.state]}${
              session.threadTitle ? ` · ${session.threadTitle}` : ""
            }`}
            className={cn(
              "flex items-center gap-1.5 rounded-full border border-border-strong px-2 py-0.5 text-caption font-medium text-text-primary transition-colors",
              session.state === "ended" && "text-text-muted",
              /* Open = the raised white face. Its fill and the resting
                 fill/hover are mutually exclusive: a `bg-*` utility outranks
                 the kit layer and would flatten `.raised-tab`'s gradient. */
              openId === session.sessionId
                ? "raised-tab"
                : "bg-bg-elevated hover:bg-surface-raised-1"
            )}
          >
            <span
              aria-hidden
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", pillDotClass(session.state))}
            />
            <span className="max-w-[120px] truncate">{session.name}</span>
            {/* The word rides in the pill as well as the dot: the distinction
                between working and idle must never rest on color alone. */}
            <span className="text-micro font-normal uppercase tracking-wide text-text-muted">
              {SESSION_PILL_LABEL[session.state]}
            </span>
          </button>
          <Popover
            open={openId === session.sessionId}
            onClose={() => setOpenId(null)}
            className="w-64"
          >
            <div className="border-b border-border-subtle px-3 pb-2 pt-1.5">
              <p className="truncate text-body font-semibold text-text-primary">
                {session.name}
              </p>
              <p className="text-caption text-text-secondary">
                {SESSION_PILL_HINT[session.state]}
              </p>
              {/* A session with no first-class thread is a real session; it just has
                  no title to show, and saying so beats an empty line. */}
              <p className="mt-1 truncate text-caption text-text-muted">
                {session.threadTitle ?? "No thread title"}
              </p>
            </div>
            <MenuItem
              icon={<PanelTop size={12} />}
              onSelect={() => {
                void open(session);
              }}
            >
              Open
            </MenuItem>
          </Popover>
        </div>
      ))}
    </div>
  );
}
