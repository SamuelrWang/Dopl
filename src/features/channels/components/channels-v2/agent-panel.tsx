"use client";

/**
 * Channels v2 — THE AGENT VIEW: a fourth surface that slides in over the info
 * panel and shows ONE of my agents from the inside.
 *
 * ⚠ WIRED (wiring plan Phase 5, 2026-08-18). `fixtures-agents.ts` is DELETED and
 * nothing here is invented. The header identity, the liveness, the context meter
 * and the token/timing line are this machine's own measurements
 * (`agents-model.ts`); the feed is the messages this agent REALLY POSTED, read
 * out of the same transcript the thread renders.
 *
 * Why it is a panel and not a tab: the thread transcript is party-to-party
 * traffic, and much of what an agent does is addressed to its OPERATOR rather
 * than to the thread. That lane needs somewhere to live, and it is not the
 * transcript (MAPPING.md § Agents tab & the agent view).
 *
 * ⚠ THE MOCK DREW THREE LANES. ONE OF THEM HAS A BACKING TODAY, AND THIS PANEL
 * SHOWS ONLY THAT ONE:
 *
 *  1. **Sent** — ✅ WIRED. What this agent posted into its thread, captioned with
 *     where it went. The SAME strings the thread transcript carries, matched on
 *     `metadata.taskId` + an agent-authored row under the viewer's own account.
 *  2. **Work narration** ("scanning 14 components…") — ❌ NOT BUILT, and NOT
 *     FAKED. Tool use is emitted on the SESSION WINDOW's own IPC event stream
 *     (`session:event`), which this renderer is not on; the summaries feed
 *     carries a coarse state and no history. Fabricating a line here would be a
 *     claim about work a real machine did or did not do — worse than an absent
 *     lane, and exactly what MAPPING.md's "dropped rather than faked" rules out.
 *  3. **The direct 1:1 lane** (me ↔ this agent, out of band) — ❌ NOT BUILT.
 *     There is no transport for it: a channel post is not out-of-band, and the
 *     desktop's own steer is bound to the session window's sender. Filed as
 *     **F-212**. The composer is NOT rendered rather than rendered inert — an
 *     input that looks like every input that does send is the worse failure.
 *
 * ⚠ PAUSE / END ARE OWN-AGENTS-ONLY. See `agents-model.ts › useAgentControls`.
 * `end` ends the AGENT and touches no thread — a thread has no finished state
 * (INVARIANTS §5, wiring plan Phase 4).
 *
 * ⚠ COPY RULE (INVARIANTS §5): inside one member's window there is exactly ONE
 * session, so it never needs a qualifier. This is the surface where the
 * temptation lives, and the noun here is the AGENT — never "agent session",
 * never "channel session".
 *
 * The surface is the kit's `.bento` with its radius and three of its four
 * borders dropped: a full-height edge panel keeps the card's fill and its
 * elevation but cannot keep a 14px radius against the page edge.
 */

import { useState } from "react";
import { Bot, CornerDownRight, PanelTop, Pause, Square, X } from "lucide-react";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { formatChannelTimestamp, formatRelativeTime } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelMessage } from "../../types";
import { AgentLiveness, IconButton } from "./bits";
import {
  agentKey,
  canControlAgents,
  formatTokens,
  metric,
  openAgentWindow,
  useAgentControls,
  type AgentControl,
} from "./agents-model";

/**
 * WHAT THIS AGENT POSTED. Pure and exported for the test.
 *
 * ⚠ THE MATCH IS `taskId` + AGENT-AUTHORED + THE VIEWER'S OWN ACCOUNT, all
 * three. The desktop posts its agent's words over the OPERATOR'S credential with
 * `authorKind: "agent"` (INVARIANTS §5), so the account is what separates my
 * agent from a peer's — and `authorKind` alone would put a teammate's agent in
 * my panel. `authorKind` stays a DISPLAY claim here as everywhere: this panel
 * tags and filters, it does not authenticate.
 */
export function agentSentMessages(
  messages: readonly ChannelMessage[],
  taskId: string,
  currentUserId: string
): ChannelMessage[] {
  if (!taskId) return [];
  return messages.filter(
    (m) =>
      m.kind === "message" &&
      m.authorKind === "agent" &&
      m.authorUserId === currentUserId &&
      m.metadata.taskId === taskId
  );
}

export function ChannelsV2AgentPanel({
  openAgent,
  sessions,
  messages,
  currentUserId,
  onClose,
}: {
  /** `agentKey(session)` of the open agent, or `null` for closed. */
  openAgent: string | null;
  sessions: readonly DesktopSessionSummary[] | null;
  /** The open channel's transcript — the source of the Sent lane. */
  messages: readonly ChannelMessage[];
  currentUserId: string;
  onClose: () => void;
}) {
  const live =
    (openAgent &&
      sessions?.find((s) => agentKey(s) === openAgent)) || null;
  // The panel plays an exit, so it needs content for one more frame than the
  // state has. Keeping the last agent renders that frame with what was there
  // instead of sliding an empty box off the edge. State, not a ref: a ref may
  // not be written during render, and this is the sanctioned
  // derive-state-from-props adjustment (render restarts before committing).
  const [lastShown, setLastShown] = useState<DesktopSessionSummary | null>(null);
  if (live && live !== lastShown) setLastShown(live);
  const agent = live ?? lastShown;
  const open = live !== null;

  return (
    <aside
      aria-label="Agent view"
      inert={!open}
      className={cn(
        "bento absolute inset-y-0 right-0 z-20 flex w-[380px] flex-col rounded-none border-y-0 border-r-0",
        "transition-transform duration-200 ease-out motion-reduce:transition-none",
        open ? "translate-x-0" : "pointer-events-none translate-x-full"
      )}
    >
      {agent && (
        <>
          <AgentPanelHeader agent={agent} onClose={onClose} />
          <AgentStats agent={agent} />
          <AgentControls agent={agent} />
          <SentFeed
            messages={agentSentMessages(messages, agent.taskId, currentUserId)}
            threadTitle={agent.threadTitle}
          />
        </>
      )}
    </aside>
  );
}

function AgentPanelHeader({
  agent,
  onClose,
}: {
  agent: DesktopSessionSummary;
  onClose: () => void;
}) {
  return (
    <header className="flex h-[56px] shrink-0 items-center gap-2 border-b border-border-default px-3.5">
      <Bot size={15} aria-hidden className="shrink-0 text-text-secondary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-text-primary">
          {agent.name}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-caption text-text-secondary">
          <CornerDownRight size={11} aria-hidden className="shrink-0 text-text-muted" />
          <span className="truncate">
            in {agent.threadTitle ?? "no thread title"}
          </span>
        </span>
      </span>
      <AgentLiveness running={agent.state === "working"} />
      <IconButton icon={X} label="Close agent view" size={15} onClick={onClose} />
    </header>
  );
}

/**
 * The compact restatement of the card's numbers, on the kit's header-strip face
 * (`bg-card-surface-subtle`). ⚠ Absences render AS absences: no denominator, no
 * meter; no stamp, no clause. Never a zero standing in for "not measured".
 */
function AgentStats({ agent }: { agent: DesktopSessionSummary }) {
  const used = metric(agent.contextUsed);
  const window = metric(agent.contextWindow);
  const spent = metric(agent.tokensSpent);
  const startedAt = metric(agent.startedAt);
  const lastAt = metric(agent.lastActivityAt);
  const line = [
    startedAt !== null &&
      `Started ${formatRelativeTime(new Date(startedAt).toISOString())}`,
    spent !== null && `${formatTokens(spent)} tokens spent`,
    lastAt !== null &&
      `Last activity ${formatRelativeTime(new Date(lastAt).toISOString())}`,
  ].filter(Boolean);

  return (
    <div className="shrink-0 border-b border-border-subtle bg-card-surface-subtle px-3.5 py-2.5">
      {used !== null && window !== null ? (
        <UsageMeter
          label="Context tokens"
          used={used}
          limit={window}
          tone="ramp"
          formatValue={formatTokens}
        />
      ) : (
        <p className="text-caption text-text-muted">
          Context use is not measured yet.
        </p>
      )}
      {line.length > 0 && (
        <p className="mt-1.5 text-caption text-text-muted">{line.join(" · ")}</p>
      )}
    </div>
  );
}

/**
 * PAUSE · END · OPEN WINDOW. All three feature-detected: an older main has the
 * feed and not the controls, and must show no buttons rather than buttons that
 * silently do nothing.
 *
 * ⚠ AN ENDED AGENT OFFERS NEITHER STOP VERB. Its registry entry is gone (the
 * pill outlives it by the retention rule), so main would answer `{ok:false}` —
 * disabled here is the honest face of that, not a guess.
 */
function AgentControls({ agent }: { agent: DesktopSessionSummary }) {
  const control = useAgentControls();
  const [pending, setPending] = useState<AgentControl | null>(null);
  if (!canControlAgents()) return null;
  const stopped = agent.state === "ended";

  const run = (which: AgentControl) => {
    setPending(which);
    // The feed is the source of truth for what happened: main dispatches, the
    // projection moves, the push re-renders this panel. Nothing is stamped
    // optimistically — an agent that did not stop must not look stopped.
    void control(which, agent).finally(() => setPending(null));
  };

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border-default px-3.5 py-2">
      <ControlButton
        icon={Pause}
        label="Pause"
        title="Stop the turn it is running. It stays yours and keeps its context."
        disabled={stopped || pending !== null}
        onClick={() => run("pause")}
      />
      <ControlButton
        icon={Square}
        label="End"
        title="End this agent. The thread is untouched."
        disabled={stopped || pending !== null}
        onClick={() => run("end")}
      />
      <ControlButton
        icon={PanelTop}
        label="Open window"
        title="Reveal this agent's own window. Starts nothing."
        onClick={() => void openAgentWindow(agent)}
      />
    </div>
  );
}

function ControlButton({
  icon: Icon,
  label,
  title,
  disabled,
  onClick,
}: {
  icon: typeof Pause;
  label: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="btn-light flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-caption font-medium text-text-primary disabled:cursor-not-allowed disabled:text-text-disabled"
    >
      <Icon size={13} aria-hidden />
      {label}
    </button>
  );
}

/**
 * THE ONE LANE WITH A BACKING. Each entry is a flat inset, not a `.bento`: this
 * is a RECORD of something that lives in the thread, not a card the panel owns.
 * The caption is what makes it a different object from a transcript bubble.
 */
function SentFeed({
  messages,
  threadTitle,
}: {
  messages: ChannelMessage[];
  threadTitle: string | null;
}) {
  const where = threadTitle ?? "its thread";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3.5">
      {messages.length === 0 ? (
        <p className="py-4 text-center text-caption text-text-muted">
          Nothing posted yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {messages.map((message) => (
            <div key={message.id} className="flex flex-col gap-1">
              <div className="rounded-[10px] border border-border-default bg-bg-inset px-2.5 py-2">
                <p className="whitespace-pre-wrap break-words text-caption text-text-primary">
                  {message.body}
                </p>
              </div>
              <span className="text-micro text-text-muted">
                → sent to {where} · {formatChannelTimestamp(message.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* ⚠ THE ABSENCE IS STATED, NOT DRAWN. Two of the mock's three lanes have
          no backing (file header): saying so is what stops the next reader
          concluding this agent did nothing but post. */}
      <p className="mt-5 border-t border-border-subtle pt-3 text-micro text-text-muted">
        What it read, ran and decided stays in its own window — this view shows
        only what it sent. Messaging it directly from here is not built yet
        (F-212).
      </p>
    </div>
  );
}
