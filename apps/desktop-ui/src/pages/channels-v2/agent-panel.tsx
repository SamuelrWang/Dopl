/**
 * Channels v2 — THE AGENT VIEW: a fourth surface that slides in over the info
 * panel and shows ONE of my agents from the inside.
 *
 * Why it is a panel and not a tab: the thread transcript is party-to-party
 * traffic, and almost everything an agent does — what it read, what it is
 * scanning, why it made a call — is addressed to its OPERATOR, not to the
 * thread. That lane needs somewhere to live, and it is not the transcript
 * (MAPPING.md § Agents tab & the agent view).
 *
 * Three lanes, three faces, one scroller:
 *
 * 1. **Work** — the agent narrating itself. Muted, italic, glyphed. Not a
 *    message; nobody received it.
 * 2. **Sent** — what it actually posted into a thread, the same string the
 *    transcript carries, captioned with where it went.
 * 3. **Direct** — the 1:1 lane between me and it. Sided like a transcript but
 *    one scale down, because it is a side conversation, not the record.
 *
 * The surface is the kit's `.bento` with its radius and three of its four
 * borders dropped: a full-height edge panel keeps the card's fill and its
 * elevation (which is what lifts it above the info panel) but cannot keep a
 * 14px radius against the page edge. Geometry is the consumer's, the face is
 * the kit's.
 *
 * Static fixture, like every other control on this page: the direct composer
 * does not send.
 */

import { useState } from "react";
import {
  Bot,
  CornerDownRight,
  FileText,
  Search,
  SendHorizontal,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { FIELD_WELL } from "@/shared/ui/wells";
import { cn } from "@/shared/lib/utils";
import { AgentLiveness, IconButton } from "./bits";
import { threadTitle } from "./agents-tab";
import {
  formatTokens,
  MY_AGENTS,
  type AgentActivityEntry,
  type AgentWorkKind,
  type MockAgent,
} from "./mock-agents";

/** Which glyph fronts a work entry. Three verbs, three shapes — the feed says
 *  what KIND of work is happening, never which tool ran. */
const WORK_ICON: Record<AgentWorkKind, LucideIcon> = {
  scan: Search,
  read: FileText,
  edit: Wrench,
};

export function ChannelsV2AgentPanel({
  openAgent,
  onClose,
  onOpenThread,
}: {
  /** Agent id, or `null` for closed. */
  openAgent: string | null;
  onClose: () => void;
  /** The header's thread name is a way INTO the thread; the panel stays open
   *  over it, because watching the agent while its thread loads is the point. */
  onOpenThread: (id: string) => void;
}) {
  const live = MY_AGENTS.find((agent) => agent.id === openAgent) ?? null;
  // The panel plays an exit, so it needs content for one more frame than the
  // state has. Keeping the last agent renders that frame with what was there
  // instead of sliding an empty box off the edge. State, not a ref: a ref may
  // not be written during render, and this is the sanctioned
  // derive-state-from-props adjustment (render restarts before committing).
  const [lastShown, setLastShown] = useState<MockAgent | null>(null);
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
          <AgentPanelHeader
            agent={agent}
            onClose={onClose}
            onOpenThread={onOpenThread}
          />
          <AgentStats agent={agent} />
          <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3.5">
            <div className="flex flex-col gap-3.5">
              {agent.activity.map((entry) => (
                <ActivityEntry key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
          <DirectComposer thread={threadTitle(agent.threadId)} />
        </>
      )}
    </aside>
  );
}

function AgentPanelHeader({
  agent,
  onClose,
  onOpenThread,
}: {
  agent: MockAgent;
  onClose: () => void;
  onOpenThread: (id: string) => void;
}) {
  return (
    <header className="flex h-[56px] shrink-0 items-center gap-2 border-b border-border-default px-3.5">
      <Bot size={15} aria-hidden className="shrink-0 text-text-secondary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-text-primary">
          {agent.label}
        </span>
        <button
          type="button"
          onClick={() => onOpenThread(agent.threadId)}
          className="-mx-1 flex min-w-0 items-center gap-1 rounded-[6px] px-1 text-left text-caption text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
        >
          <CornerDownRight size={11} aria-hidden className="shrink-0 text-text-muted" />
          <span className="truncate">in {threadTitle(agent.threadId)}</span>
        </button>
      </span>
      <AgentLiveness running={agent.state === "running"} />
      <IconButton icon={X} label="Close agent view" size={15} onClick={onClose} />
    </header>
  );
}

/**
 * The compact restatement of the card's numbers, on the kit's header-strip face
 * (`bg-card-surface-subtle`, the same strip the requested-thread view wears).
 * The card had room for the long form; in here the feed is the content and
 * these are the frame.
 */
function AgentStats({ agent }: { agent: MockAgent }) {
  return (
    <div className="shrink-0 border-b border-border-subtle bg-card-surface-subtle px-3.5 py-2.5">
      <UsageMeter
        label="Context tokens"
        used={agent.contextUsed}
        limit={agent.contextWindow}
        tone="ramp"
        formatValue={formatTokens}
        className=""
      />
      <p className="mt-1.5 text-caption text-text-muted">
        Started {agent.startedAt} · {agent.tokensSpent} tokens spent · Last
        activity {agent.lastActivityAt}
      </p>
    </div>
  );
}

function ActivityEntry({ entry }: { entry: AgentActivityEntry }) {
  if (entry.kind === "work") {
    const Icon = WORK_ICON[entry.work];
    return (
      <div className="flex items-start gap-2">
        <Icon size={13} aria-hidden className="mt-px shrink-0 text-text-muted" />
        <p className="min-w-0 flex-1 text-caption italic text-text-secondary">
          {entry.text}
        </p>
        <span className="shrink-0 text-micro text-text-muted">{entry.time}</span>
      </div>
    );
  }

  if (entry.kind === "sent") {
    return (
      // Flat inset, not a `.bento`: this is a RECORD of something that lives in
      // the thread, not a card the panel owns. The caption is what makes it a
      // different object from the direct lane below.
      <div className="flex flex-col gap-1">
        <div className="rounded-[10px] border border-border-default bg-bg-inset px-2.5 py-2">
          <p className="text-caption text-text-primary">{entry.text}</p>
        </div>
        <span className="text-micro text-text-muted">
          → sent to {entry.to} · {entry.time}
        </span>
      </div>
    );
  }

  const mine = entry.from === "me";
  return (
    <div className={cn("flex", mine && "justify-end")}>
      <div
        className={cn(
          "max-w-[86%] rounded-[10px] px-2.5 py-1.5",
          mine
            ? "bg-surface-raised-3"
            : "border border-border-default bg-bg-elevated"
        )}
      >
        <p className="text-caption text-text-primary">{entry.text}</p>
        <span className="mt-0.5 block text-micro text-text-muted">
          {mine ? "You" : "Agent"} · {entry.time}
        </span>
      </div>
    </div>
  );
}

/**
 * The direct lane's input. It is HERE and not in the channel composer because
 * what you type into it reaches this agent and nothing else — the note under it
 * says so, since a text field at the bottom of a panel otherwise looks exactly
 * like every text field that does post to a thread.
 */
function DirectComposer({ thread }: { thread: string }) {
  return (
    <div className="shrink-0 border-t border-border-default px-3.5 py-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          spellCheck={false}
          placeholder="Message this agent directly…"
          className={cn(
            FIELD_WELL,
            "h-9 min-w-0 flex-1 px-2.5 text-body text-text-primary placeholder:text-text-muted"
          )}
        />
        <button
          type="button"
          aria-label="Send to this agent"
          title="Send to this agent"
          className="btn-light flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-text-primary"
        >
          <SendHorizontal size={15} />
        </button>
      </div>
      <p className="px-0.5 pt-1.5 text-micro text-text-muted">
        Reaches this agent only — never posts to {thread}.
      </p>
    </div>
  );
}
