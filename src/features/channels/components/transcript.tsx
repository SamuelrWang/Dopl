"use client";

/**
 * Channels — the rows of one channel or one thread. The side comes from the server-stamped
 * `author_user_id`, never the caller-assertable `authorKind`; an agent hangs on its operator's
 * side (INVARIANTS §5).
 */

import { cn } from "@/shared/lib/utils";
import { ArtifactCard } from "./artifact-card";
import { AuthoredRow } from "./authored-row";
import { agentBoxOf, agentPostAccent } from "./agent-box-rule";
import { ThreadCardMessage } from "./thread-card-row";
import { EscalationCardMessage } from "./escalation-card-row";
import { MessageMarkdown } from "./message-markdown";
import { recipientTags } from "../lib/recipient-tags";
import type { AuthorIndex } from "./view-model";
import type { MessageRow, ReceiptRow, TranscriptRow } from "./view-model-rows";

export function Transcript({
  rows,
  index,
  flashId,
  canLaunchAgent = false,
  launchBusy = false,
  onLaunchAgent,
  onOpenAgent,
  onAnswerEscalation,
  answerBusy = false,
  onOpenThread,
  newestSeq = null,
  onJumpToSeq,
}: {
  rows: TranscriptRow[];
  index: AuthorIndex;
  /** Briefly set right after a Tags-inbox click lands on a row. */
  flashId: string | null;
  /** The direct-launch bridge op exists; false renders no button, not a disabled one. */
  canLaunchAgent?: boolean;
  /** A launch is in flight — the double-submit guard, not a capability. */
  launchBusy?: boolean;
  /** Start my own agent on this card's thread — a direct launch, not a consent decision. */
  onLaunchAgent?: (threadId: string) => void;
  /** Open an agent's pane from its pill (`agents-model.ts › agentKey`); absent = inert pill. */
  onOpenAgent?: (agentId: string) => void;
  /**
   * Answer an escalation by its message id — the server derives who is woken, never the client.
   * Absent renders no buttons, not disabled ones.
   */
  onAnswerEscalation?: (escalationMessageId: string, optionIndex: number) => void;
  /** An answer is in flight — the double-submit guard, not a capability. */
  answerBusy?: boolean;
  onOpenThread: (id: string) => void;
  /** The newest loaded seq — the citation ceiling (`lib/message-refs.ts › isCitableSeq`); null
   *  draws no citation pills. */
  newestSeq?: number | null;
  /** Jump to a cited seq (the host resolves it to a message id); absent makes citations plain. */
  onJumpToSeq?: (seq: number) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-caption text-text-muted">
        Nothing posted here yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {rows.map((row) => {
        if (row.kind === "system") {
          return (
            <p
              key={row.id}
              data-message-id={row.id}
              className="text-center text-caption text-text-muted"
            >
              {row.body}
            </p>
          );
        }
        if (row.kind === "receipt") {
          return <Receipt key={row.id} row={row} />;
        }
        if (row.kind === "thread-card") {
          return (
            <ThreadCardMessage
              key={row.id}
              row={row}
              index={index}
              flash={row.id === flashId}
              canLaunchAgent={canLaunchAgent}
              launchBusy={launchBusy}
              onLaunch={() => onLaunchAgent?.(row.openThreadId)}
              onOpen={() => onOpenThread(row.openThreadId)}
            />
          );
        }
        if (row.kind === "artifact") {
          return (
            <ArtifactCard
              key={row.id}
              id={row.id}
              name={row.name}
              summary={row.summary}
              count={row.count}
              firstSeq={row.firstSeq}
              lastSeq={row.lastSeq}
              members={row.members}
              flash={row.id === flashId}
            />
          );
        }
        if (row.kind === "escalation") {
          return (
            <EscalationCardMessage
              key={row.id}
              row={row}
              index={index}
              flash={row.id === flashId}
              onOpenAgent={onOpenAgent}
              busy={answerBusy}
              onAnswer={
                onAnswerEscalation
                  ? (optionIndex) => onAnswerEscalation(row.id, optionIndex)
                  : undefined
              }
            />
          );
        }
        return (
          <Message
            key={row.id}
            row={row}
            index={index}
            flash={row.id === flashId}
            onOpenAgent={onOpenAgent}
            newestSeq={newestSeq}
            onJumpToSeq={onJumpToSeq}
          />
        );
      })}
    </div>
  );
}

/** How the exchange ended — one centred muted line; only a real `failed` gets alarm ink. */
function Receipt({ row }: { row: ReceiptRow }) {
  return (
    <p
      data-message-id={row.id}
      data-receipt-status={row.status}
      className="flex items-center justify-center gap-1.5 text-caption text-text-muted"
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          row.calm ? "bg-text-disabled" : "bg-danger"
        )}
      />
      <span className={cn(!row.calm && "text-danger")}>{row.label}</span>
      <span className="text-micro text-text-muted">{row.time}</span>
    </p>
  );
}

/**
 * The body's layout and type halves, kept separate: `tailwind-merge` mistakes the `text-*` size
 * scale for a colour, so a heading or code fence must never out-race the body's classes.
 * `wrap-anywhere`, not `break-words`: only `anywhere` shrinks min-content, which the `items-end`
 * own-message column sizes from; the sub-100% cap is what lets `items-end` anchor a long body.
 */
const MESSAGE_BLOCK = "wrap-anywhere max-w-[92%]";
const MESSAGE_TEXT = "text-lead text-text-primary";

/** A message row; its pill opens the agent's pane only when `index.agents` knows the agent. */
function Message({
  row,
  index,
  flash,
  onOpenAgent,
  newestSeq = null,
  onJumpToSeq,
}: {
  row: MessageRow;
  index: AuthorIndex;
  flash: boolean;
  onOpenAgent?: (agentId: string) => void;
  /** Passed straight through to the body — see `Transcript`'s props. */
  newestSeq?: number | null;
  onJumpToSeq?: (seq: number) => void;
}) {
  const agentId = row.agentId;
  const openAgent =
    onOpenAgent && agentId && index.agents.has(agentId)
      ? () => onOpenAgent(agentId)
      : undefined;
  // Resolved at render off the live index, never stored on the row, so a rename re-faces history.
  const agentName = row.agentId
    ? (index.agents.get(row.agentId)?.displayName ?? null)
    : null;
  // Recipient ids named at render for the same reason; the agent-row gate is `toMessageRow`'s.
  const recipients = recipientTags(
    { agentIds: row.recipientAgentIds, userIds: row.recipientUserIds },
    index.agents,
    index.byId
  );
  const body = (
    <MessageMarkdown
      text={row.body}
      index={index}
      mentionsMe={row.mentionsMe}
      blockClassName={MESSAGE_BLOCK}
      textClassName={MESSAGE_TEXT}
      // Passed through, never decided here: `isCitableSeq` checks against the pane's ceiling.
      newestSeq={newestSeq}
      onJumpToSeq={onJumpToSeq}
    />
  );
  // The same predicate `transcript-filter.tsx` uses for "People", so filter and paint agree.
  const box = agentBoxOf(row, index);
  return (
    <AuthoredRow
      id={row.id}
      side={row.side}
      author={row.author}
      authorLabel={row.authorLabel}
      time={row.time}
      agent={row.agent}
      external={row.external}
      agentId={row.agentId}
      agentName={agentName}
      recipients={recipients}
      continuation={row.continuation}
      flash={flash}
      accent={box && agentPostAccent(box)}
      onOpenAgent={openAgent}
    >
      {/* The whole body at once: markdown blocks (fences, lists) span lines. */}
      {body}
    </AuthoredRow>
  );
}

