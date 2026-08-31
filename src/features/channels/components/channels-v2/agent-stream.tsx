"use client";

/**
 * THE AGENT'S WORK STREAM — the one lane both agent surfaces render (Samuel,
 * 2026-08-22).
 *
 * ⚠ IT IS SHARED, NOT FORKED. The slide-out panel showed a Sent-lane only and the
 * window showed a work log; they are now the same component, on the same rule as
 * `agent-composer.tsx`. Two renderers for one stream is two vocabularies for one
 * set of facts, and the panel's job — a GLANCE at what this agent is up to — is
 * the window's content at another width, not a different question.
 *
 * ⚠ FIVE FACES NOW, AND THE DISTINCTION IS THE POINT.
 *   - **`sent` wears the BOX** (`SentToChannelBox`) — it is the only thing here
 *     the counterparty can see.
 *   - **`operator` IS THE VIEWER'S OWN TURN**: right-aligned, with their avatar
 *     and no name (Samuel, 2026-08-27). Side is the signal; the label column went.
 *   - **`private` is the AGENT's answer**: left, plain, and carrying NOTHING but
 *     the text (2026-08-27 — the quote bar and the "Agent" marker went with the
 *     "You" label; the sides are told apart by ALIGNMENT now). Private traffic
 *     that looked like a channel post would let an operator believe their steer
 *     was read by the other party.
 *   - **`directed` / `directed-reply` wear their OWN BOX** (2026-08-31,
 *     `agent-stream-directed.tsx`) — the private direct lane, where ANOTHER of
 *     this operator's agents is the speaker. Same box family as the sent one,
 *     deliberately NOT its dark banner: the geometry says "an exchange", the
 *     weight says whether anyone off this machine can see it.
 *   - **`thinking` / `tool` / `note` are quiet log lines** — `agent-stream-log.tsx`,
 *     where a RUN of consecutive tool activity collapses into one muted "Used N
 *     tools" row. They are the bulk and almost never the answer.
 *
 * ⚠ THE MESSAGE FACES RENDER MARKDOWN (Samuel, 2026-08-31). The agent's turns,
 * the operator's own, both directed boxes and the SENT box's body go through
 * `agent-stream-prose.tsx`
 * — a thin adapter over the TRANSCRIPT's renderer (R1: reuse, never a fork), so
 * the untrusted-body rules are stated once. **The log lane deliberately does
 * not**: it bounds its rows by slicing the string, which cuts markdown mid-token,
 * and `line-clamp` cannot clamp a container of sibling blocks. Bulk stays plain
 * and keeps its clip. ⚠ What actually reaches the operator today is INLINE
 * markdown only — main flattens every frame's whitespace before it ships (F-376).
 *
 * ⚠ THE LOG LANE IS ITS OWN FILE (§1, 2026-08-27), and the two boxes are theirs.
 * This one owns which lane a row is in and how a row is dispatched to its face;
 * `agent-stream-log.tsx` owns the bulk, `agent-stream-sent-box.tsx` the outbound
 * review card, `agent-stream-directed.tsx` the private direct lane.
 *
 * ⚠ EVERY FRAME RENDERS, INCLUDING ONE THIS BUILD HAS NEVER HEARD OF.
 * `agent-stream-model.ts › frameLane` falls back to `note` and keeps the text —
 * the desktop's `kind` vocabulary is still growing, and a stream that silently
 * drops the frames it does not recognise is worse than one that renders them
 * plainly. The operator is reading this to find out what happened.
 */

import { useEffect, useRef } from "react";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import type { ChannelConsentRequest, ChannelMessage } from "../../types";
import type { AgentNarrationEntry } from "./use-agent-narration";
import { LogLine, ToolRunGroup } from "./agent-stream-log";
import { AgentStreamEscalation } from "./agent-stream-escalation";
// ⚠ THE PRIVATE DIRECT LANE'S FACES ARE THEIR OWN FILE, on the sent box's seam:
// they move when THAT lane moves (INVARIANTS §11), where this file moves when a
// stream row's dispatch moves.
import { DirectedBox } from "./agent-stream-directed";
import { StreamProse } from "./agent-stream-prose";
// ⚠ THE OUTBOUND REVIEW CARD IS ITS OWN FILE SINCE 2026-08-31 (§1, at the cap),
// and the seam is "one file, one reason to change": that card moves when the
// OUTBOUND CONSENT product moves (§6) — it has already gained a Pending face, a
// decision and an expiry rule — where this file moves when a STREAM ROW's shape
// moves. It is RE-EXPORTED here so no importer changed.
import { SentToChannelBox } from "./agent-stream-sent-box";
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

/** What "this build cannot show the work" says, as opposed to "it has done
 *  nothing yet". ⚠ Exported for the tests: the two absences are the pair this
 *  surface most easily collapses, and collapsing them claims something about the
 *  operator's machine that it cannot know (INVARIANTS §11). */
export const NARRATION_UNSUPPORTED =
  "This build cannot show what your agent is doing.";
/**
 * THE EMPTY STATE, AS ONE BLOCK (Samuel, 2026-08-27).
 *
 * ⚠ IT WAS TWO NODES IN TWO STYLES and that is what this replaces: a muted "Send a message to
 * wake agent." over a body-size black "Chat with <agent> directly. Only your agent sees this."
 * Two sentences about one situation, in two type sizes, reading as two unrelated announcements.
 * ONE string, ONE node, ONE style.
 *
 * ⚠ AND NO NAME SUBSTITUTION. It said "Chat with Agent #k3v7d2mq directly" — an id quoted at the
 * operator before anything exists to address, which is noise where the sentence's job is to say
 * what the lane IS. "your agent" is the whole subject.
 */
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
  threadTitle,
  viewer,
  agentNameFor,
  className,
}: {
  /** `null` = could not ask; `[]` = asked, nothing yet. ⚠ Never collapsed here. */
  entries: AgentNarrationEntry[] | null;
  /**
   * RESOLVE ONE OF THIS OPERATOR'S AGENT IDS TO ITS DISPLAY NAME, or `null` when
   * this mount cannot say (F-376a, 2026-08-31).
   *
   * ⚠ **IT EXISTS SO AN ID IS NEVER PRINTED AT A PERSON.** A `directed` entry now
   * carries `senderAgentId` — an 8-char instance id — and `agent-id-visibility
   * .test.ts` is the standing rule that such an id does not reach a human-facing
   * string. An unresolvable id therefore renders as the ANONYMOUS sentence, which
   * is the same thing the surface showed before senders existed at all.
   * ⚠ **OPTIONAL, AND ABSENT MEANS "THIS MOUNT CANNOT SAY"**, never "nobody sent
   * it": a mount with no roster in hand must degrade to anonymous rather than
   * inventing a name or leaking the id.
   */
  agentNameFor?: (agentId: string) => string | null;
  /** Whether this build can show the lane at all. */
  supported: boolean;
  /** What this agent POSTED, off the channel transcript — the authoritative
   *  record of the one lane that is public. Agent-scoped (F-251). */
  sent: readonly ChannelMessage[];
  /**
   * THE WHOLE CHANNEL TRANSCRIPT, unfiltered — what a held draft's words are
   * checked against to learn whether they went out (2026-08-25). ⚠ NOT a
   * substitute for {@link sent}: this one may not be attributed to any agent,
   * which is exactly why it can answer a question the agent-scoped lane cannot.
   */
  delivered?: readonly ChannelMessage[];
  /**
   * The viewer's PENDING outbound consent rows — what turns a held draft's card
   * into a decidable one (Samuel, 2026-08-25). ⚠ Omitted renders every held
   * draft as {@link POST_NOT_SENT_LABEL}, which is the honest answer for a host
   * that cannot read them.
   */
  pending?: readonly ChannelConsentRequest[];
  /** Approve one held draft — the CAS'd `PATCH /consent/[id]` (INVARIANTS §6).
   *  ⚠ Absent renders no button at all, never a disabled one. */
  onPost?: (requestId: string) => void;
  /** A decision is in flight — the double-submit guard, not a capability. */
  postBusy?: boolean;
  /**
   * ANSWER AN ESCALATION this agent posted (2026-08-31). ⚠ Absent renders no
   * option buttons at all, never disabled ones — the same rule {@link onPost}
   * follows. Takes the ESCALATION'S OWN MESSAGE ID; the client never names an
   * agent, because which one gets woken is the server's derivation.
   */
  onAnswerEscalation?: (escalationMessageId: string, optionIndex: number) => void;
  /** An answer is in flight — the double-submit guard, not a capability. */
  answerBusy?: boolean;
  /**
   * Which escalations already have an answer, by message id → option index.
   * ⚠ ABSENT IS "NOT LOOKED UP", not "unanswered" — a host with no transcript
   * page to scan hands none, and the card then shows its buttons rather than
   * claiming nothing was chosen.
   */
  answeredEscalations?: ReadonlyMap<string, number>;
  /**
   * Whether THIS VIEWER may answer the escalations on this stream.
   *
   * ⚠ DEFAULTS TRUE, and that is safe HERE and nowhere else: this surface is one
   * machine's own registry (`agents-model.ts`), so every card on it was posted
   * by an agent the viewer runs — which is exactly the untagged-fallback case
   * where they ARE the answerer. A host that knows better (a tagged escalation
   * naming somebody else) passes false, and the server refuses regardless.
   */
  escalationAnswerable?: boolean;
  threadTitle?: string | null;
  /**
   * THE VIEWER'S OWN FACE, for the turns they typed (Samuel, 2026-08-27).
   * `view-model.ts › viewerPerson` resolves it off the transcript the host is
   * already reading — no roster, no second fetch.
   *
   * ⚠ ABSENT IS A REAL ANSWER AND RENDERS AS NO AVATAR, never as a placeholder
   * face: a viewer who has not posted in this channel has no hydrated row, and
   * inventing an identity is the one thing worse than showing none. The row is
   * still right-aligned, which is what says whose turn it is.
   */
  viewer?: AvatarPerson | null;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  /**
   * ⚠ A `useState` SET OF PRESSED CARDS STOOD HERE AND IS DELETED (2026-08-25).
   * It existed to stop the card flashing "Not sent" in the gap between a Post
   * and the desktop's poll delivering it — and it could not do that job: local
   * state does not survive a remount, does not see a Post pressed on the OTHER
   * agent surface, and is not what made the claim wrong anyway. **The model
   * answers from server facts now** (`agent-stream-model.ts`): the words landing
   * in the channel is what retires a held card, and only a row past its own TTL
   * earns the failed face.
   */
  const items = buildAgentStream({
    entries,
    sent,
    // ⚠ THE LANDING CHECK IS CHANNEL-WIDE, THE RENDERING IS AGENT-SCOPED — see
    // the model's docblock. `sent` is filtered on `metadata.taskId`, which a
    // threadless post does not carry, so it cannot answer "did this land".
    delivered,
    pending,
    threadTitle,
  });
  // Follow the stream. Simpler than the transcript's stick-to-bottom rules on
  // purpose: this is a log, not a conversation with a reading position to
  // protect, and it grows from the bottom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  // ⚠ THE TWO ABSENCES ARE WORDED DIFFERENTLY, and the SENT lane survives both.
  // A build with no narration op still has the transcript, so an agent that
  // posted must not read as an agent that did nothing.
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
          {/* ⚠ GROUPED, NOT FILTERED (Samuel, 2026-08-27) — a run of consecutive
              tool activity is ONE muted summary row that opens onto exactly the
              rows that were here before (`agent-stream-log.tsx`). Every other
              lane passes through as a group of one, so nothing else moves. */}
          {groupStreamItems(items).map((group) => (
            <StreamRow
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
      {!supported && !empty && (
        // The transcript carried the sent lane, but the WORK lane could not be
        // asked for — say so rather than letting a short list imply a quiet agent.
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
}: {
  group: StreamGroup;
  viewer?: AvatarPerson | null;
  onPost?: (requestId: string) => void;
  postBusy?: boolean;
  onAnswerEscalation?: (escalationMessageId: string, optionIndex: number) => void;
  answerBusy?: boolean;
  answeredEscalations?: ReadonlyMap<string, number>;
  escalationAnswerable?: boolean;
  /** F-376a — resolve a directed entry's sender id to a name; see {@link AgentStream}. */
  agentNameFor?: (agentId: string) => string | null;
}) {
  // A tool RUN is the one group with more than one row in it, and it renders as
  // the collapsed summary. Every other lane is a group of one.
  if (group.tools !== null) return <ToolRunGroup group={group} />;
  const item = group.items[0];
  // ⚠ AN ESCALATION IS A SENT POST WITH A PAYLOAD, so it is checked BEFORE the
  // plain sent box rather than given a lane of its own — it really is a message
  // this agent sent, and giving it a second lane would fork the dedupe rules
  // that keep an echo from doubling a transcript row.
  if (item.lane === "sent" && item.escalation) {
    return (
      <li>
        <AgentStreamEscalation
          escalation={item.escalation.payload}
          answerable={escalationAnswerable !== false}
          answeredIndex={
            answeredEscalations?.get(item.escalation.messageId) ?? null
          }
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
  // ⚠ THE TWO SIDES OF ONE EXCHANGE, AND THEY ARE ROUTED SEPARATELY RATHER THAN
  // BY A FLAG. `frameLane` has already split main's single `lane: 'directed'` on
  // the `kind`, so the direction is a LANE here — which is what keeps this switch
  // exhaustive and stops a face defaulting to the wrong arrow.
  // ⚠ THE INBOUND SIDE NOW HAS A SENDER, AND THE OUTBOUND SIDE STILL DOES NOT
  // (F-376a, 2026-08-31). `senderAgentId` says which of the operator's agents
  // FILED a direction; a `directed-reply` is THIS agent answering, so there is no
  // counterparty to name on that half and it stays `null` deliberately.
  // ⚠ RESOLVED TO A NAME, NEVER RENDERED AS AN ID (`agent-id-visibility.test.ts`),
  // and an unresolvable one falls back to the anonymous sentence.
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

/**
 * THE OPERATOR'S OWN TURN — right-aligned, with their face and no name (Samuel,
 * live review 2026-08-27).
 *
 * ⚠ WHAT IT REPLACES: a left row with a blue "You" in the label column, mirroring
 * the agent's. It read as a log entry ABOUT the operator rather than as something
 * they had said. Side is the whole signal now — the side every chat surface in
 * this product already uses for "mine" — so the label column goes.
 *
 * ⚠ **NO NAME AND NO EMAIL, EVER.** The avatar is the identity; a name beside it
 * is the viewer's own name quoted back at them on every line they type.
 * `Avatar` at `xs` is the compact scale (24px) — the stream is 380px wide in the
 * panel, and a `sm` face would be a third of the column.
 *
 * ⚠ IT STILL MUST NOT LOOK LIKE {@link SentToChannelBox}. Nothing in this lane
 * reached the counterparty: the operator's steer is out of band by construction
 * (`main/session-seed.js › frameOperatorTurn` tells the agent as much). A soft
 * inset block on the right is as far from the dark-bannered delivery record as
 * this column gets, which is the point of the two faces being different at all.
 */
function OperatorTurn({
  text,
  viewer,
}: {
  text: string;
  viewer?: AvatarPerson | null;
}) {
  return (
    <div className="flex min-w-0 items-start justify-end gap-2">
      {/* ⚠ THE BUBBLE IS A BLOCK CONTAINER SINCE 2026-08-31, not a `<span>`. The
          markdown renderer emits a FRAGMENT OF BLOCKS (`message-markdown.tsx`'s
          rule 4) and blocks cannot live inside an inline element. **The geometry
          is unchanged** — same inset ground, same 80% cap, same radius, same
          `wrap-anywhere` (now on each block) — so the row reads as it did. */}
      <StreamProse
        text={text}
        className="max-w-[80%] rounded-[10px] bg-bg-inset px-2.5 py-1.5"
      />
      {/* ⚠ ABSENT RATHER THAN A PLACEHOLDER when the host could not resolve the
          viewer (`view-model.ts › viewerPerson`): the row is already right-aligned,
          which is what says whose turn it is. */}
      {viewer && <Avatar person={viewer} size="xs" />}
    </div>
  );
}

/**
 * THE AGENT'S PRIVATE ANSWER — **message text, and nothing else** (Samuel, live
 * review 2026-08-27, second pass).
 *
 * ⚠ THE QUOTE BAR AND THE "Agent" MARKER ARE BOTH GONE. They came from the old
 * two-sided line, where "You" / "Agent" in a label column was how a reader told
 * the sides apart. **The right-aligned operator row now carries that whole
 * job**: one side is aligned right with a face on it, the other is plain text on
 * the left, and a rule plus a noun on top of that is chrome restating what the
 * layout already says — the same thing the `says` label was doing on the log
 * lane. This is the agent's own words; they read as words.
 *
 * ⚠ IT STILL MUST NOT LOOK LIKE {@link SentToChannelBox}, and now it is as far
 * from it as this column gets. This reply reached nobody but the operator; a
 * private line wearing the sent box's dark banner would let them believe the
 * other party read something they never saw — the one thing on this surface that
 * is worse than showing nothing. **Plain text is the face that claims least.**
 *
 * ⚠ "PLAIN" MEANS NO CHROME, NOT UNRENDERED MARKDOWN (Samuel, 2026-08-31). The
 * rule above is about what this face CLAIMS — no banner, no rule, no label, no
 * box — and formatting the agent's own words claims nothing at all: a `**bold**`
 * that prints its asterisks is not a humbler face, it is a worse one. The body
 * goes through the transcript's renderer like every other message face; the row
 * still carries nothing but the text.
 */
function AgentTurn({ text }: { text: string }) {
  return <StreamProse text={text} />;
}

/**
 * THE CUT, CONFESSED, UNDER THE FACE THAT SHOWS IT (2026-08-31, Samuel's cutoff
 * report — INVARIANTS §9: a clipped read says so).
 *
 * ⚠ WHY THE FACES NEED THIS WHEN THE LOG LANE HAS ITS OWN CLIP ROW. The message
 * faces (`OperatorTurn` / `AgentTurn` / `DirectedBox`) render their text whole
 * with no clamp — main already bounded it at `PROSE_CAP` — so a line main CUT at
 * that cap reaches the operator as prose that simply stops mid-sentence, with the
 * arithmetic on every layer agreeing it fits. `StreamItem.truncated` is main's
 * own confession that it shortened the line, and for prose the tail exists
 * nowhere: this note is the only honest thing a face can add.
 *
 * ⚠ MUTED AND BELOW THE FACE, not inside it — it is a fact ABOUT the message,
 * not part of what the agent said, and the same `text-micro text-text-muted`
 * the log lane's clip row wears keeps one voice for "you are not seeing all
 * of it" across the column.
 */
function TruncatedNote({ alignEnd }: { alignEnd?: boolean }) {
  return (
    <div className={cn("flex", alignEnd && "justify-end")}>
      <span className="text-micro text-text-muted">
        Clipped — the message was longer than the panel keeps.
      </span>
    </div>
  );
}
