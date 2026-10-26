"use client";

/**
 * Channels — the posted request card: what a "New thread" send leaves in the channel. One card per
 * fan-out (one `channel_threads` row per addressee sharing a `fanoutGroup`, INVARIANTS §5), so each
 * pill is one real addressee. The pills carry no approval state: the requester cannot read their
 * addressees' consent (INVARIANTS §6, F-206).
 *
 * Neither action answers anybody: "Open thread" navigates, "Launch agent" is the direct launch
 * (`use-launch-controls.ts`) on the same thread "Open thread" opens, which is the viewer's own one
 * of a fan-out (`view-model-rows.ts › ownThreadOf`). It is absent without the bridge.
 */

import { ChevronRight, MessagesSquare, Users } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { PILL_BUTTON } from "@/shared/ui/small-action-button";
import { cn } from "@/shared/lib/utils";
import { AgentStatusPill } from "./agent-bits";
import { AgentFace } from "./agent-face";
import { AddresseePill } from "./bits";
import { AuthoredRow } from "./authored-row";
import { TextOnlyLinks } from "./message-markdown";
import { MessageMarkdownInline } from "./message-markdown-inline";
import type { BodyContext } from "./message-markdown-context";
import { openedByLabel, type ThreadCardAgent } from "./thread-card-agents";
import { shortName, type AuthorIndex } from "./view-model";
import type { ThreadCardRow } from "./view-model-rows";

const QUIET_BUTTON = cn(
  PILL_BUTTON,
  "h-[26px] border-border-subtle bg-transparent px-[11px] text-text-secondary",
  "hover:bg-transparent hover:text-text-primary disabled:opacity-60"
);
const INK_BUTTON =
  "raise-ink inline-flex h-[26px] flex-none items-center rounded-full bg-surface-cta px-[11px] " +
  "text-caption font-medium text-text-on-cta";
const AGENT_ROW =
  "white-card flex h-[42px] w-full flex-none items-center gap-2 rounded-[10px] border-border-subtle pl-[7px] pr-2 text-left";

function AgentRow({
  agent,
  onOpen,
}: {
  agent: ThreadCardAgent;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <AgentFace
        size={26}
        photo={agent.photo}
        name={agent.name}
        color={agent.color}
        runtime={agent.runtime}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-small font-medium text-text-primary">{agent.name}</span>
        <span className="truncate text-micro text-text-muted">{agent.owner}</span>
      </span>
      <AgentStatusPill {...agent.liveness} />
      {onOpen && (
        <ChevronRight size={13} strokeWidth={2.2} aria-hidden className="flex-none text-text-disabled" />
      )}
    </>
  );
  if (!onOpen) return <div className={AGENT_ROW}>{body}</div>;
  return (
    <button
      type="button"
      aria-label={`Open ${agent.name}`}
      onClick={onOpen}
      className={cn(AGENT_ROW, "raise")}
    >
      {body}
    </button>
  );
}

/** The agents working the card's thread; at most three rows show before the list scrolls. */
function ThreadAgents({
  agents,
  onOpenAgent,
}: {
  agents: readonly ThreadCardAgent[];
  onOpenAgent?: (key: string) => void;
}) {
  if (agents.length === 0) return <EmptyState variant="well" icon={Users} title="No agents yet" />;
  const running = agents.filter((a) => a.liveness.tone === "working").length;
  return (
    <div className="card-well flex min-h-0 flex-col gap-[5px] p-2">
      <p className="flex items-baseline justify-between gap-2 text-label font-semibold uppercase tracking-wide text-text-muted">
        <span>
          {agents.length} agent{agents.length === 1 ? "" : "s"} in this thread
        </span>
        {running > 0 && <span className="flex-none text-success">{running} running</span>}
      </p>
      {/* The padding gives a lifted row room inside the scroll box; the margin puts it back. */}
      <div className="-m-1.5 flex max-h-[146px] min-h-0 flex-col gap-1 overflow-y-auto p-1.5">
        {agents.map((agent) => (
          <AgentRow
            key={agent.key}
            agent={agent}
            onOpen={agent.own && onOpenAgent ? () => onOpenAgent(agent.key) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export function ThreadCardMessage({
  row,
  index,
  previewCtx,
  flash,
  agents,
  canLaunchAgent,
  launchBusy,
  onLaunch,
  onOpen,
  onOpenAgent,
}: {
  row: ThreadCardRow;
  index: AuthorIndex;
  /** Built once per page by `transcript.tsx`: it walks the roster. */
  previewCtx: BodyContext;
  flash: boolean;
  /** The agents on `row.openThreadId`; `null` when no feed can say, which draws no compartment. */
  agents: readonly ThreadCardAgent[] | null;
  canLaunchAgent: boolean;
  launchBusy: boolean;
  onLaunch: () => void;
  onOpen: () => void;
  /** Opens one of the viewer's own agents (`agents-model.ts › agentKey`). */
  onOpenAgent?: (key: string) => void;
}) {
  const first = row.threads[0];
  return (
    <AuthoredRow
      id={row.id}
      side={row.side}
      author={row.author}
      authorLabel={row.authorLabel}
      time={row.time}
      agent={false}
      continuation={false}
      flash={flash}
    >
      <div className="white-card mt-1 flex w-full max-w-[460px] flex-col gap-2 rounded-[14px] py-3 pl-3.5 pr-3 text-left">
        <span className="flex min-w-0 items-center gap-2 text-heading font-medium text-text-primary">
          <span className="mark-tile size-5 flex-none">
            <MessagesSquare size={11} strokeWidth={2.2} aria-hidden />
          </span>
          <span className="min-w-0 truncate">{first.title}</span>
        </span>
        {/* Inline markdown (block tokens do not clamp), `wrap-anywhere` (an unbroken word would size
            the card past its edge), and no anchors: following a link is the thread's own body. */}
        <p className="line-clamp-2 wrap-anywhere text-body text-text-tertiary">
          <TextOnlyLinks>
            <MessageMarkdownInline text={row.preview} ctx={previewCtx} />
          </TextOnlyLinks>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {row.threads.map((thread) => {
            const person = thread.targetUserId ? index.byId.get(thread.targetUserId) : undefined;
            // An addressee the roster cannot resolve still gets a pill: dropping it would
            // under-report who the request was raised against.
            return (
              <AddresseePill
                key={thread.id}
                label={person ? shortName(person, index.currentUserId) : "Unknown member"}
              />
            );
          })}
        </div>
        {agents && <ThreadAgents agents={agents} onOpenAgent={onOpenAgent} />}
        <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
          <span className="min-w-0 truncate text-caption text-text-muted">
            {openedByLabel(row.authorLabel, row.agent)}
          </span>
          <span className="flex flex-none gap-1.5">
            {canLaunchAgent && (
              <button type="button" disabled={launchBusy} onClick={onLaunch} className={QUIET_BUTTON}>
                Launch agent
              </button>
            )}
            <button type="button" onClick={onOpen} className={INK_BUTTON}>
              Open thread
            </button>
          </span>
        </div>
      </div>
    </AuthoredRow>
  );
}
