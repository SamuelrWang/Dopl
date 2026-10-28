"use client";

/**
 * The agent's work stream — one component for both agent surfaces; this file routes each row to its face.
 * Only the `sent` box reaches the counterparty, so no private face may look like it. Message faces render
 * markdown (`agent-stream-prose.tsx`); log lines stay plain because they clip by slicing (`agent-stream-log.tsx`).
 */

import { useEffect, useMemo, useRef } from "react";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import type { IdentityFacts } from "@/shared/ui/identity-face";
import { cn } from "@/shared/lib/utils";
import type { ChannelConsentRequest, ChannelMessage } from "../types";
import type { AgentNarrationEntry } from "./use-agent-narration";
import { LogLine, ToolRunGroup } from "./agent-stream-log";
import { DisplayCard } from "./display-card";
import { decisionCardPaint } from "./escalation-card-face";
import { displayViewFrom, type PageAnswer } from "./view-model-display";
import type { AuthorIndex } from "./view-model";
import type { AnswerDisplay } from "../hooks/use-display-writes";
import { DirectedBox } from "./agent-stream-directed";
import { InboundBox, inboundFace } from "./agent-stream-inbound-box";
import { messageTags, type RecipientTag } from "../lib/recipient-tags";
import { StreamProse, StreamRoster, TruncatedNote } from "./agent-stream-prose";
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
  type StreamItem,
} from "./agent-stream-model";

/** "This build cannot show the work" — distinct from "nothing yet" (INVARIANTS §11). Asserted by tests. */
export const NARRATION_UNSUPPORTED =
  "This build cannot show what your agent is doing.";
/** Empty-state copy: one string, no agent name or id substituted. Asserted by tests. */
export const NARRATION_EMPTY =
  "Chat with your agent privately. Send a message to wake it up.";

/** No viewer handed: nobody here may answer, so every card is read-only. */
const NO_VIEWER: AuthorIndex = { currentUserId: "", byId: new Map(), agents: new Map() };
const NO_ANSWERS: ReadonlyMap<string, PageAnswer> = new Map();

export function AgentStream({
  entries,
  supported,
  sent,
  delivered,
  pending,
  onPost,
  postBusy = false,
  onAnswerDisplay,
  displayIndex,
  displayAnswers,
  destination,
  viewer,
  agentNameFor,
  roster,
  liveness = null,
  color = null,
  self = null,
  className,
}: {
  /** This agent's own face, worn by what it posted; absent draws none. */
  self?: IdentityFacts | null;
  /**
   * **THE CHANNEL'S ROSTER, FOR THE ADDRESSEE PILLS ON A POSTED BOX** (#3081).
   *
   * ⚠ **IT IS NOT {@link displayIndex} AND MUST NOT BE FUSED WITH IT.** That one is
   * deliberately `indexMembers([], currentUserId)` — no members, no agents — because what it
   * answers is *may this viewer press a card's buttons*, and `agent-panel.tsx` states that
   * choice at its call site. This one answers *what are these people and agents CALLED*, and
   * a roster-less index would face every person as "Member" and fall every agent back to its
   * `agent-<id>` handle, which is the one thing this surface may never print at a person
   * (`agent-id-visibility.test.ts`).
   * ⚠ **ABSENT DRAWS NO PILLS, WHICH IS WHY IT IS OPTIONAL.** A host with no roster in hand
   * (the pop-out window) renders exactly what it rendered before, rather than showing faces
   * it would have to invent.
   */
  roster?: AuthorIndex | null;
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
  /** Answer a display's choice (every decision too; the server picks which agent to wake); absent ⇒ no
   *  buttons. */
  onAnswerDisplay?: AnswerDisplay;
  /** The viewer + roster the card's "who may answer / who chose" reads; absent ⇒ read-only cards. */
  displayIndex?: AuthorIndex;
  /** Answer messages already in the transcript (`view-model-display.ts › answersByEscalation`);
   *  absent = not looked up, not "unanswered". */
  displayAnswers?: ReadonlyMap<string, PageAnswer>;
  destination?: PostDestination | null; // → `agent-stream-model.ts › StreamItem.to`
  /** The viewer's face for their own turns (`view-model.ts › viewerPerson`); absent ⇒ no avatar, never a
   *  placeholder. */
  viewer?: AvatarPerson | null;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  /**
   * ⚠ MEMOISED (release review, 2026-10-11): both of these ran on EVERY render, and this
   * surface re-renders at TELEMETRY RATE — the liveness pill, the working row and the
   * narration push all move while an agent is mid-turn. `buildAgentStream` walks the ring,
   * the transcript and the pending rows and builds three `Set`/`Map`s; `groupStreamItems`
   * walks the result again. Neither reads anything but its arguments (both files are pure
   * by their own headers), so the deps ARE the inputs.
   */
  const items = useMemo(
    () =>
      buildAgentStream({
        entries,
        sent,
        // The landing check is channel-wide: `sent` is filtered on `metadata.threadId`, which a threadless post lacks.
        delivered,
        pending,
        destination,
      }),
    [entries, sent, delivered, pending, destination]
  );
  const groups = useMemo(() => groupStreamItems(items), [items]);
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
        /* ⚠ THE ROSTER IS SET ONCE, HERE, FOR EVERY FACE'S PROSE (Samuel, 2026-10-12 — @-handles
           tint in the agent view). It is the SAME `roster` the addressee pills resolve against, so
           the two cannot disagree about who is in the room; `agent-stream-prose.tsx › StreamRoster`
           carries why it is a context rather than a prop on five faces, and why a host with none
           renders exactly what it did before. */
        <StreamRoster index={roster}>
        <ol className="flex flex-col gap-2.5">
          {/* Grouped, not filtered: a tool run is one summary row; every other lane is a group of one. */}
          {groups.map((group) => (
            <StreamRow
              color={color}
              self={self}
              key={group.key}
              group={group}
              viewer={viewer}
              onPost={onPost}
              postBusy={postBusy}
              onAnswerDisplay={onAnswerDisplay}
              displayIndex={displayIndex}
              displayAnswers={displayAnswers}
              agentNameFor={agentNameFor}
              roster={roster}
            />
          ))}
        </ol>
        </StreamRoster>
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
  onAnswerDisplay,
  displayIndex,
  displayAnswers,
  agentNameFor,
  roster,
  color,
  self,
}: {
  self: IdentityFacts | null;
  group: StreamGroup;
  viewer?: AvatarPerson | null;
  onPost?: (requestId: string) => void;
  postBusy?: boolean;
  onAnswerDisplay?: AnswerDisplay;
  displayIndex?: AuthorIndex;
  displayAnswers?: ReadonlyMap<string, PageAnswer>;
  agentNameFor?: (agentId: string) => string | null;
  /** The addressee pills' faces come from here; absent draws none (see {@link AgentStream}). */
  roster?: AuthorIndex | null;
  /** Sent/display lanes only — a `directed` box is private and keeps its own weight. */
  color?: AgentColorKey | null;
}) {
  const item = group.items[0];
  /**
   * ⚠ MEMOISED, AND HOISTED ABOVE EVERY EARLY RETURN BECAUSE IT IS A HOOK (release review,
   * 2026-10-11). `addresseeTags` resolves faces off the LIVE roster on purpose — that is
   * `lib/recipient-tags.ts`'s rule and why a rename re-faces history — but it ran on every
   * render of every row, and this surface re-renders at telemetry rate. Only the ids on the
   * item and the roster can change the answer. ⚠ A tool group reaches here too and pays
   * nothing: it carries no tag ids, so the function returns {@link NO_TAGS} on its first line.
   */
  const tags = useMemo(() => addresseeTags(item, roster), [item, roster]);
  if (group.tools !== null) return <ToolRunGroup group={group} />;
  // A display (every decision too) is a sent post with a payload — checked before the plain sent box,
  // not given its own lane, so one set of dedupe rules keeps an echo from doubling a transcript row.
  if (item.lane === "sent" && item.display) {
    const payload = item.display;
    return (
      <li data-agent-display>
        <DisplayCard
          channelId={payload.channelId}
          messageId={payload.messageId}
          view={displayViewFrom(
            payload,
            displayIndex ?? NO_VIEWER,
            displayAnswers ?? NO_ANSWERS,
            false
          )}
          paint={decisionCardPaint(color)}
          size="stream"
          onAnswer={displayIndex ? onAnswerDisplay : undefined}
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
          tags={tags}
          pending={item.pending}
          requestId={item.requestId}
          expired={item.expired}
          onPost={onPost}
          busy={postBusy}
          color={color}
          face={self}
        />
      </li>
    );
  }
  // WHAT WOKE IT (#3081). ⚠ CHECKED BESIDE `sent` AND NEVER FOLDED INTO IT: both lanes are in the
  // channel, and only this one says the words ARRIVED (`agent-stream-lanes.ts › StreamLane`).
  // ⚠ The sender is main's already-resolved label, so no roster lookup happens here — and nothing
  // may fall back to an id if it is absent (`agent-stream-inbound-box.tsx › inboundLabel`).
  if (item.lane === "inbound") {
    return (
      <li>
        {/* `fromOperator` and `authorKind` decide the label, the edge and the face; all
            server-derived, never sniffed out of `senderName` (`agent-stream-inbound-box.tsx`). */}
        <InboundBox
          text={item.text}
          sender={item.senderName}
          fromOperator={item.fromOperator}
          authorKind={item.authorKind}
          senderAgentName={item.senderAgentName}
          senderColor={item.senderColor}
          face={inboundFace(item, viewer?.avatarUrl ?? null)}
          at={item.at}
        />
        {item.truncated === true && <TruncatedNote />}
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

/** Shared empty row: a `[]` literal would be a fresh array on every render of every box. */
const NO_TAGS: readonly RecipientTag[] = [];

/**
 * **THE ADDRESSEE FACES FOR ONE POSTED BOX** (#3081).
 *
 * ⚠ **IT RESOLVES AT RENDER, OFF THE LIVE ROSTER, BY RULE** — `lib/recipient-tags.ts`'s header:
 * faces are never stored on a row, so a rename re-faces history instead of leaving a stale name
 * baked into a stream item. The ids reach here on the item; the words are decided here.
 * ⚠ **IT IS `messageTags`, THE TRANSCRIPT'S OWN FUNCTION** — including its body-order rule, which
 * is why `item.text` is handed over: a reader scanning the two panes sees the same faces in the same
 * order for one message. A second ordering here would be the drift that file exists to prevent.
 * ⚠ **NO ROSTER, NO PILLS.** Returning the shared empty row (rather than resolving against an
 * empty index) is the difference between drawing nothing and drawing "Member" three times.
 */
function addresseeTags(
  item: StreamItem,
  roster: AuthorIndex | null | undefined
): readonly RecipientTag[] {
  if (!roster) return NO_TAGS;
  if (!item.tagUserIds?.length && !item.tagAgentIds?.length) return NO_TAGS;
  return messageTags(
    { body: item.text, tagUserIds: item.tagUserIds, tagAgentIds: item.tagAgentIds },
    roster.agents,
    roster.byId
  );
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
        className="max-w-[80%] rounded-lg bg-bg-inset px-2.5 py-1.5"
      />
      {viewer && <Avatar person={viewer} size="m" />}
    </div>
  );
}

/** The agent's private answer: markdown, no chrome, so it cannot pass for {@link SentToChannelBox}. */
function AgentTurn({ text }: { text: string }) {
  return <StreamProse text={text} />;
}
