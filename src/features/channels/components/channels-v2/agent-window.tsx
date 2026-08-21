"use client";

/**
 * THE AGENT WINDOW — one of my agents, from the inside (2026-08-20, F-212's closure).
 *
 * ⚠ WHAT IT REPLACES, AND WHAT IT IS NOT. The session window is retired (INVARIANTS §11,
 * F-228) and none of it comes back: no transcript of its own, no permission cards, no
 * folder chip, no modes header — those moved to the channels surfaces or died with the
 * retirement. What was genuinely LOST when it went is the ability to watch one agent work
 * and to say something to it, and that is exactly what this window restores, on the
 * channels tree, over the ops the Agents tab already uses.
 *
 * ⚠ THE THREE LANES `agent-panel.tsx` DREW ARE ALL WIRED HERE NOW. It shipped rendering
 * only the SENT lane and STATING the other two absences rather than faking them; F-212 was
 * that statement. All three have a backing:
 *
 *   1. **Work narration** — the ring `main/session-narration.js` keeps, over a second
 *      bridge channel. Tool calls carry their NAMES, which was the specific half F-212's
 *      entry called out.
 *   2. **Sent** — what this agent posted, the same derivation the panel uses
 *      (`agent-panel.tsx › agentSentMessages`), imported rather than re-written.
 *   3. **The direct 1:1 lane** — the composer at the foot. It reaches
 *      `sessions.message`, the one bridge op that starts a turn.
 *
 * ⚠ THE PANEL SURVIVES AND IS NOT THIS. `agent-panel.tsx` is the GLANCE — it slides in
 * over the info panel, beside the thread you are reading, and answers "what is this agent
 * up to". This is the INSIDE, in its own window, beside your editor. Two surfaces, one
 * feed, one derivation each; nothing here re-reads anything the panel already reads.
 *
 * ⚠ IT IS ROUTER-FREE like every file in this tree — the SPA page owns the params.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, CornerDownRight, SendHorizonal } from "lucide-react";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { EmptyState } from "@/shared/ui/empty-state";
import { formatChannelTimestamp, formatRelativeTime } from "@/shared/lib/format-time";
import { FIELD_WELL } from "@/shared/ui/wells";
import { cn } from "@/shared/lib/utils";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { useChannelMessages } from "../../hooks/use-channel-messages";
import { agentSentMessages } from "./agent-panel";
import { AgentLiveness } from "./bits";
import {
  agentDetailLabel,
  agentKey,
  formatTokens,
  metric,
  useDesktopSessions,
} from "./agents-model";
import { canMessageAgent, messageAgent } from "./agents-controls";
import { PostureControls } from "./agent-posture";
import { useAgentNarration, type AgentNarrationEntry } from "./use-agent-narration";

/** The window's name. ⚠ `main/agent-window.js` carries the bare "Dopl" as the PRE-PAINT
 *  title, so a window that never finishes loading is still named. */
export function agentWindowTitle(name: string | null): string {
  return name ? `Dopl — ${name}` : "Dopl";
}

/**
 * Name the WINDOW from the renderer. ⚠ MAIN CANNOT DO THIS: it creates the window from
 * (segment, channel, thread) and has no handle to name — handles live in the local session
 * projection the renderer subscribes to. Electron's default `page-title-updated` handling
 * copies `document.title` onto the window; `agent-window.js` does not disable it and must
 * not start to. Same mechanism as `thread-window.tsx › threadWindowTitle`.
 */
function useWindowTitle(name: string | null): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = agentWindowTitle(name);
    return () => {
      document.title = previous;
    };
  }, [name]);
}

export function ChannelsV2AgentWindow({
  workspaceId,
  channelId,
  taskId,
  currentUserId,
}: {
  workspaceId: string;
  channelId: string;
  /** The agent's own half of its key — `?thread=`. `""` is a real value (a responder with
   *  no first-class thread), and is why this is not gated on truthiness. */
  taskId: string;
  currentUserId: string;
}) {
  // ⚠ THE SAME FEED THE AGENTS TAB TAKES, filtered to one agent. A window makes its own
  // subscription because it is a different React tree in a different BrowserWindow — main
  // fans every push out over the app-window registry precisely so this works.
  const { sessions } = useDesktopSessions();
  const key = `${channelId}:${taskId}`;
  const agent = useMemo(
    () => sessions?.find((s) => agentKey(s) === key) ?? null,
    [sessions, key]
  );
  const { entries, supported } = useAgentNarration(channelId, taskId);
  // The Sent lane reads the channel transcript, exactly as the panel's does.
  const { messages } = useChannelMessages(channelId, workspaceId);
  const sent = useMemo(
    () => agentSentMessages(messages, taskId, currentUserId),
    [messages, taskId, currentUserId]
  );

  useWindowTitle(agent?.name ?? null);

  // ⚠ `sessions === null` is "could not ask" and is NOT the same as "this agent is gone".
  // Rendering the gone-state over a browser (or a main without the feed) would be a claim
  // about the operator's machine that this surface cannot make.
  if (sessions !== null && !agent) {
    return (
      <div className="page-float flex flex-col antialiased">
        <EmptyState
          icon={Bot}
          title="That agent isn't running"
          description="It may have ended, or it belongs to a different machine. The channel transcript keeps what it sent."
        />
      </div>
    );
  }

  return (
    <div className="page-float flex min-h-0 flex-1 flex-col antialiased">
      <AgentWindowHeader agent={agent} />
      <AgentWindowStats agent={agent} />
      {agent && (
        <PostureControls agent={agent} channelId={channelId} taskId={taskId} />
      )}
      <WorkStream entries={entries} supported={supported} sent={sent} />
      <AgentComposer channelId={channelId} taskId={taskId} name={agent?.name ?? null} />
    </div>
  );
}

function AgentWindowHeader({ agent }: { agent: DesktopSessionSummary | null }) {
  return (
    <header className="flex h-[56px] shrink-0 items-center gap-2 border-b border-border-default px-4">
      <Bot size={15} aria-hidden className="shrink-0 text-text-secondary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-text-primary">
          {agent?.name ?? "Agent"}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-caption text-text-secondary">
          <CornerDownRight size={11} aria-hidden className="shrink-0 text-text-muted" />
          <span className="truncate">in {agent?.threadTitle ?? "no thread title"}</span>
        </span>
      </span>
      {agent && (
        <AgentLiveness
          running={agent.state === "working"}
          detail={agentDetailLabel(agent)}
        />
      )}
    </header>
  );
}

/** ⚠ Absences render AS absences — no denominator, no meter; no stamp, no clause. Never a
 *  zero standing in for "not measured" (INVARIANTS §11). Same rule as the panel's strip. */
function AgentWindowStats({ agent }: { agent: DesktopSessionSummary | null }) {
  if (!agent) return null;
  const used = metric(agent.contextUsed);
  const window = metric(agent.contextWindow);
  const spent = metric(agent.tokensSpent);
  const lastAt = metric(agent.lastActivityAt);
  const line = [
    spent !== null && `${formatTokens(spent)} tokens spent`,
    lastAt !== null &&
      `Last activity ${formatRelativeTime(new Date(lastAt).toISOString())}`,
  ].filter(Boolean);

  return (
    <div className="shrink-0 border-b border-border-subtle bg-card-surface-subtle px-4 py-2.5">
      {used !== null && window !== null && (
        <UsageMeter
          label="Context tokens"
          used={used}
          limit={window}
          tone="ramp"
          formatValue={formatTokens}
        />
      )}
      {line.length > 0 && (
        <p className="mt-1.5 text-caption text-text-muted">{line.join(" · ")}</p>
      )}
    </div>
  );
}

/** What "this build cannot show the work" says, as opposed to "it has done nothing yet".
 *  ⚠ Exported for the test: the two absences are the pair this surface most easily
 *  collapses, and collapsing them claims something about the operator's machine. */
export const NARRATION_UNSUPPORTED =
  "This build cannot show what your agent is doing.";
export const NARRATION_EMPTY = "Nothing yet. What it does will appear here.";

function WorkStream({
  entries,
  supported,
  sent,
}: {
  entries: AgentNarrationEntry[] | null;
  supported: boolean;
  sent: ReturnType<typeof agentSentMessages>;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const count = (entries?.length ?? 0) + sent.length;
  // Follow the stream. Simpler than the transcript's stick-to-bottom rules on purpose:
  // this is a log, not a conversation with a reading position to protect, and it grows
  // from the bottom in a window sized for exactly that.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  return (
    <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
      {!supported ? (
        <p className="py-6 text-center text-caption text-text-muted">
          {NARRATION_UNSUPPORTED}
        </p>
      ) : entries === null || count === 0 ? (
        <p className="py-6 text-center text-caption text-text-muted">
          {NARRATION_EMPTY}
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((entry, i) => (
            <NarrationRow key={`${entry.at}:${i}`} entry={entry} />
          ))}
        </ol>
      )}
      {sent.length > 0 && (
        <div className="mt-4 border-t border-border-subtle pt-3">
          <p className="pb-2 text-micro font-medium uppercase tracking-wide text-text-muted">
            Sent to the thread
          </p>
          <div className="flex flex-col gap-2">
            {sent.map((message) => (
              <div
                key={message.id}
                className="rounded-[10px] border border-border-default bg-bg-inset px-2.5 py-2"
              >
                <p className="whitespace-pre-wrap break-words text-caption text-text-primary">
                  {message.body}
                </p>
                <span className="mt-1 block text-micro text-text-muted">
                  {formatChannelTimestamp(message.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ONE LINE OF WORK. The tool name is shortened HERE, at render, through the same helper
 * the pill's detail uses — main sends the raw name so one call is never named two
 * different ways on one screen.
 */
function NarrationRow({ entry }: { entry: AgentNarrationEntry }) {
  const tone =
    entry.kind === "status"
      ? "text-text-muted"
      : entry.kind === "result" && entry.ok === false
        ? "text-danger"
        : "text-text-secondary";
  const label =
    entry.kind === "tool"
      ? shortToolName(entry.tool)
      : entry.kind === "result"
        ? entry.ok === false
          ? "failed"
          : "ok"
        : entry.kind === "post"
          ? "sent"
          : entry.kind === "assistant"
            ? "says"
            : "";

  return (
    <li className="flex min-w-0 gap-2 text-caption">
      {label && (
        <span className="shrink-0 font-medium text-text-primary">{label}</span>
      )}
      <span className={cn("min-w-0 flex-1 break-words", tone)}>{entry.text}</span>
    </li>
  );
}

/** `mcp__dopl__dopl_channel` → `dopl_channel`. ⚠ The segment after the LAST `__`, which is
 *  the rule `main/mcp-tool-names.js › mcpShortName` states: the server segment is the
 *  CLIENT's to choose and has never been ours to assume (F-139). */
function shortToolName(name: string | undefined): string {
  if (!name) return "runs";
  return name.replace(/^mcp__.*__/i, "") || "runs";
}

/** What a refused 1:1 message says. ⚠ Exported for the test — a swallowed refusal and a
 *  sent message are indistinguishable on screen, which is the failure this whole surface
 *  was built to stop repeating. */
export const MESSAGE_REFUSED =
  "That didn't reach your agent. It may have just ended.";
export const MESSAGE_AUTH_HELD =
  "Your agent is waiting for you to sign in to Claude Code.";

/**
 * THE DIRECT 1:1 COMPOSER — F-212's third lane.
 *
 * ⚠ WHAT IT IS NOT: a channel post. Nothing typed here is written to the thread, and the
 * agent's answer is not posted either — `session-seed.js › frameOperatorTurn` tells the
 * agent so in as many words. That is the whole point of an OUT-OF-BAND lane: the operator
 * steering their own agent is not traffic the counterparty should see.
 *
 * ⚠ IT IS RENDERED ONLY WHEN IT CAN SEND (`messageAgent` feature-detects the op). The
 * panel's own rule, and the reason it shipped with NO composer rather than an inert one:
 * an input at the foot of a surface looks exactly like every input that does send, and an
 * inert one is a promise the surface cannot keep.
 */
function AgentComposer({
  channelId,
  taskId,
  name,
}: {
  channelId: string;
  taskId: string;
  name: string | null;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // ⚠ Read ONCE, after mount, via lazy state: the bridge is a window global, so a
  // render-time read makes the server and the first client render disagree. The detector
  // asks about the BRIDGE OP, never about `messageAgent` — that wrapper is an export of
  // this tree and is always a function, which would render a composer that can only refuse.
  const [canSend] = useState(() => canMessageAgent());
  if (!canSend) return null;

  const send = () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setNotice(null);
    void messageAgent({ channelId, taskId, text: body })
      .then((res) => {
        if (res.ok) {
          // Cleared only on a real send. A refused message stays in the box, because
          // retyping something main never took is the worst way to learn it was refused.
          setText("");
          return;
        }
        setNotice(res.reason === "auth-hold" ? MESSAGE_AUTH_HELD : MESSAGE_REFUSED);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="shrink-0 border-t border-border-default px-4 py-3">
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // ⚠ IME GUARD, the same one the channel composer keeps: `isComposing` means
            // the Enter is committing a candidate, not submitting.
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={name ? `Message ${name}` : "Message this agent"}
          aria-label={name ? `Message ${name}` : "Message this agent"}
          className={cn(
            FIELD_WELL,
            "min-h-[44px] flex-1 resize-none px-2.5 py-2 text-caption text-text-primary placeholder:text-text-muted"
          )}
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || text.trim() === ""}
          aria-label="Send"
          className="btn-light flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] text-text-primary disabled:cursor-not-allowed disabled:text-text-disabled"
        >
          <SendHorizonal size={14} aria-hidden />
        </button>
      </div>
      {notice && (
        <p role="status" className="mt-1.5 text-caption text-text-muted">
          {notice}
        </p>
      )}
      {/* ⚠ SAYS WHAT THIS LANE IS, once, because it is the surface's one genuinely
          surprising property: an input under a transcript normally posts to it. */}
      <p className="mt-1.5 text-micro text-text-muted">
        Only your agent sees this. It is not posted to the thread.
      </p>
    </div>
  );
}
