"use client";

/**
 * The agent's work stream — one component for both agent surfaces; this file routes each row to its face.
 * Only the `sent` box reaches the counterparty, so no private face may look like it. Message faces render
 * markdown (`agent-stream-prose.tsx`); log lines stay plain because they clip by slicing (`agent-stream-log.tsx`).
 */

import { useEffect, useRef } from "react";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import type { ChannelConsentRequest, ChannelMessage } from "../types";
import type { AgentNarrationEntry } from "./use-agent-narration";
import { LogLine, ToolRunGroup } from "./agent-stream-log";
import { AgentStreamEscalation } from "./agent-stream-escalation";
import { DirectedBox } from "./agent-stream-directed";
import { StreamProse, TruncatedNote } from "./agent-stream-prose";
import { StreamWorkingRow } from "./agent-stream-working";
import { SentToChannelBox } from "./agent-stream-sent-box";
import type { AgentColorKey } from "../types";
import type { AgentLivenessState, PostDestination } from "./agents-model";
export {
  SentToChannelBox,
  POST_PENDING_LABEL,
  POST_NOT_SENT_LABEL,
  POST_ACTION_LABEL,
} from "./agent-stream-sent-box";
import {
  buildAgentStream,
  groupStreamItems,
  type StreamGroup,
} from "./agent-stream-model";

/** "This build cannot show the work" — distinct from "nothing yet" (INVARIANTS §11). Asserted by tests. */
export const NARRATION_UNSUPPORTED =
  "This build cannot show what your agent is doing.";
/** Empty-state copy: one string, no agent name or id substituted. Asserted by tests. */
export const NARRATION_EMPTY =
  "Chat with your agent privately. Send a message to wake it up.";

export function AgentStream({
  entries,
  supported,
  sent,
  delivered,
  pending,
  onPost,
  postBusy = false,
  onAnswerEscalation,
  answerBusy = false,
  answeredEscalations,
  escalationAnswerable = true,
  destination,
  viewer,
  agentNameFor,
  liveness = null,
  color = null, className,
}: {
  /** `null` = could not ask; `[]` = asked, nothing yet. */
  entries: AgentNarrationEntry[] | null;
  /** One of the operator's agent ids → display name; `null`/absent ⇒ the anonymous sentence, never the id
   *  (`agent-id-visibility.test.ts`). */
  agentNameFor?: (agentId: string) => string | null;
  /** The sent banner's fill — the same key the transcript uses (`view-model.ts › AgentRosterEntry.color`). */
  color?: AgentColorKey | null;
  /** `agents-model.ts › agentLiveness`; absent = this host has no session to read. */
  liveness?: AgentLivenessState | null;
  /** Whether this build can show the lane at all. */
  supported: boolean;
  /** What this agent posted, off the channel transcript; agent-scoped (F-251). */
  sent: readonly ChannelMessage[];
  /** The whole channel transcript, unfiltered — what a held draft is checked against to learn if it went out. */
  delivered?: readonly ChannelMessage[];
  /** The viewer's pending outbound consent rows; omitted ⇒ every held draft renders as `POST_NOT_SENT_LABEL`. */
  pending?: readonly ChannelConsentRequest[];
  /** Approve one held draft (`PATCH /consent/[id]`, INVARIANTS §6); absent ⇒ no button, not a disabled one. */
  onPost?: (requestId: string) => void;
  /** A decision is in flight — the double-submit guard. */
  postBusy?: boolean;
  /** Answer an escalation by its own message id (the server picks which agent to wake); absent ⇒ no buttons. */
  onAnswerEscalation?: (escalationMessageId: string, optionIndex: number) => void;
  /** An answer is in flight — the double-submit guard. */
  answerBusy?: boolean;
  /** Message id → chosen option index; absent = not looked up, not "unanswered". */
  answeredEscalations?: ReadonlyMap<string, number>;
  /** Defaults true: every card here was posted by one of the viewer's own agents; the server refuses
   *  regardless. */
  escalationAnswerable?: boolean;
  destination?: PostDestination | null; // → `agent-stream-model.ts › StreamItem.to`
  /** The viewer's face for their own turns (`view-model.ts › viewerPerson`); absent ⇒ no avatar, never a
   *  placeholder. */
  viewer?: AvatarPerson | null;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const items = buildAgentStream({
    entries,
    sent,
    // The landing check is channel-wide: `sent` is filtered on `metadata.taskId`, which a threadless post lacks.
    delivered,
    pending,
    destination,
  });
  // Always pin to the bottom (a log has no reading position to protect). The live tail is a dep because it
  // toggles without changing `items.length`.
  const working = liveness?.tone === "working";
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, working]);

  // The sent lane survives both absences: a build with no narration op still has the transcript.
  const empty = items.length === 0;

  return (
    <div
      ref={scrollerRef}
      className={cn("min-h-0 flex-1 overflow-y-auto py-3.5", className)}
    >
      {empty ? (
        <p className="py-6 text-center text-caption text-text-muted">
          {supported ? NARRATION_EMPTY : NARRATION_UNSUPPORTED}
        </p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {/* Grouped, not filtered: a tool run is one summary row; every other lane is a group of one. */}
          {groupStreamItems(items).map((group) => (
            <StreamRow
              color={color}
              key={group.key}
              group={group}
              viewer={viewer}
              onPost={onPost}
              postBusy={postBusy}
              onAnswerEscalation={onAnswerEscalation}
              answerBusy={answerBusy}
              answeredEscalations={answeredEscalations}
              escalationAnswerable={escalationAnswerable}
              agentNameFor={agentNameFor}
            />
          ))}
        </ol>
      )}
      {/* Live tail: inside this scroller under the most recent item; outside the `<ol>` so an empty
          lane shows it too. */}
      <StreamWorkingRow liveness={liveness} />
      {!supported && !empty && (
        // Sent rows came from the transcript, but the work lane is unavailable — say so.
        <p className="mt-4 text-center text-micro text-text-muted">
          {NARRATION_UNSUPPORTED}
        </p>
      )}
    </div>
  );
}

function StreamRow({
  group,
  viewer,
  onPost,
  postBusy,
  onAnswerEscalation,
  answerBusy,
  answeredEscalations,
  escalationAnswerable,
  agentNameFor,
  color,
}: {
  group: StreamGroup;
  viewer?: AvatarPerson | null;
  onPost?: (requestId: string) => void;
  postBusy?: boolean;
  onAnswerEscalation?: (escalationMessageId: string, optionIndex: number) => void;
  answerBusy?: boolean;
  answeredEscalations?: ReadonlyMap<string, number>;
  escalationAnswerable?: boolean;
  agentNameFor?: (agentId: string) => string | null;
  /** Sent/escalation lanes only — a `directed` box is private and keeps its own weight. */
  color?: AgentColorKey | null;
}) {
  if (group.tools !== null) return <ToolRunGroup group={group} />;
  const item = group.items[0];
  // An escalation is a sent post with a payload — checked before the plain sent box, not given its own lane,
  // so one set of dedupe rules keeps an echo from doubling a transcript row.
  if (item.lane === "sent" && item.escalation) {
    return (
      <li>
        <AgentStreamEscalation
          escalation={item.escalation.payload}
          color={color ?? null}
          answerable={escalationAnswerable !== false}
          answeredIndex={answeredEscalations?.get(item.escalation.messageId) ?? null}
          busy={answerBusy === true}
          onAnswer={
            onAnswerEscalation
              ? (optionIndex) =>
                  onAnswerEscalation(item.escalation!.messageId, optionIndex)
              : undefined
          }
        />
      </li>
    );
  }
  if (item.lane === "sent") {
    return (
      <li>
        <SentToChannelBox
          text={item.text}
          to={item.to}
          at={item.at}
          pending={item.pending}
          requestId={item.requestId}
          expired={item.expired}
          onPost={onPost}
          busy={postBusy}
          color={color}
        />
      </li>
    );
  }
  if (item.lane === "operator") {
    return (
      <li>
        <OperatorTurn text={item.text} viewer={viewer} />
        {item.truncated === true && <TruncatedNote alignEnd />}
      </li>
    );
  }
  if (item.lane === "private") {
    return (
      <li>
        <AgentTurn text={item.text} />
        {item.truncated === true && <TruncatedNote />}
      </li>
    );
  }
  // `frameLane` already split direction into two lanes. Only inbound `directed` has a sender (a reply is this
  // agent answering); it renders as a name or anonymously, never as the id.
  if (item.lane === "directed" || item.lane === "directed-reply") {
    const sender =
      item.lane === "directed" && item.senderAgentId && agentNameFor
        ? agentNameFor(item.senderAgentId)
        : null;
    return (
      <li>
        <DirectedBox
          text={item.text}
          agent={sender}
          outbound={item.lane === "directed-reply"}
          at={item.at}
        />
        {item.truncated === true && <TruncatedNote />}
      </li>
    );
  }
  return <LogLine item={item} />;
}

/** The operator's own turn: right-aligned with their avatar and no name. Must not resemble
 *  {@link SentToChannelBox} — it never reached the counterparty. */
function OperatorTurn({
  text,
  viewer,
}: {
  text: string;
  viewer?: AvatarPerson | null;
}) {
  return (
    <div className="flex min-w-0 items-start justify-end gap-2">
      <StreamProse
        text={text}
        className="max-w-[80%] rounded-[10px] bg-bg-inset px-2.5 py-1.5"
      />
      {viewer && <Avatar person={viewer} size="xs" />}
    </div>
  );
}

/** The agent's private answer: markdown, no chrome, so it cannot pass for {@link SentToChannelBox}. */
function AgentTurn({ text }: { text: string }) {
  return <StreamProse text={text} />;
}
