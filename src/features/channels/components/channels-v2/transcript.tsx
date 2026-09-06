"use client";

/**
 * Channels v2 — THE TRANSCRIPT: the rows of one channel or one thread.
 *
 * Authorship is a SIDE, not a style: peers left, the viewer right, and an agent
 * hangs on its OPERATOR's side — never in a third column (INVARIANTS §5).
 *
 * ⚠ ATTRIBUTION IS ONE PILL SINCE 2026-08-22 (Samuel, from two reference
 * screenshots). Every message group is headed by `attribution-pill.tsx ›
 * AttributionPill` — a capsule holding the author's avatar, their name and the
 * message timestamp stacked beside it — and the message blocks render BELOW it
 * at full width. **The grey `Agent · <id>` chip is DELETED**; an agent row says
 * so in its NAME LINE instead, reading `Agent #<agentId>` for a stamped post and
 * plain `Agent` for an unstamped one (`agents-model.ts › parseAgentPostStamp`).
 * The per-agent accent survives on the pill's BORDER.
 *
 * ⚠ THE RUN-GROUPING IS UNCHANGED AND STILL LOAD-BEARING (F-251). A continuation
 * has no pill to put an id in, so `view-model-rows.ts › isContinuation` breaks on
 * a different agent id — two of one operator's agents collapsing into a single
 * run under one name is the defect that bought all of this
 * (*"it looks like one agent sending"*).
 *
 * ⚠ THE SIDE COMES FROM `author_user_id`, NEVER FROM `authorKind`.
 * `authorKind` is CALLER-ASSERTABLE — an explicit body value wins over
 * `ctx.source`, which is load-bearing because the desktop posts agent results
 * over the operator's own cookie session (INVARIANTS §5). It is a DISPLAY
 * CLAIM scoped to one user, so it earns a chip and nothing more.
 * `author_user_id` is always `ctx.userId`, server-stamped and not assertable,
 * which is why the layout hangs off it. Reversing that would let a caller
 * choose which side of somebody else's screen their words land on.
 *
 * Split out of `message-pane.tsx` at design time (INVARIANTS §1): the pane owns
 * the breadcrumb, the scroller and the composer slot; this owns what a row
 * looks like.
 *
 * ⚠ TWO OF ITS ROW SHAPES LEFT ON 2026-08-28, at the 500-line cap: the shared shell is
 * `authored-row.tsx › AuthoredRow` and the posted-request card is
 * `thread-card-row.tsx › ThreadCardMessage`. Both moved VERBATIM, and each file carries why
 * it is the seam. What stayed is the LIST, the receipt line and the message row.
 */

import { cn } from "@/shared/lib/utils";
import { ArtifactCard } from "./artifact-card";
import { AuthoredRow } from "./authored-row";
import { ThreadCardMessage } from "./thread-card-row";
import { EscalationCardMessage } from "./escalation-card-row";
import { MessageMarkdown } from "./message-markdown";
import { routedTagLabel } from "../../lib/agent-mentions";
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
}: {
  rows: TranscriptRow[];
  index: AuthorIndex;
  /** Briefly set right after a Tags-inbox click lands on a row. */
  flashId: string | null;
  /**
   * The direct-launch bridge op exists on this build (`use-agents-panel.ts ›
   * AgentLaunchControls.canLaunch`). ⚠ FALSE RENDERS NO BUTTON AT ALL, never a
   * disabled one — the feature-detection rule the whole bridge family follows,
   * and a plain browser has no agent to start.
   */
  canLaunchAgent?: boolean;
  /** A launch is in flight — the double-submit guard, not a capability. */
  launchBusy?: boolean;
  /**
   * Start MY OWN agent on this card's thread (Samuel, 2026-08-22). ⚠ NOT A
   * CONSENT DECISION — it raises no row, answers no request and asks nobody. It
   * is the same direct launch the composer's Bot icon and the Agents tab's New
   * Agent button fire.
   */
  onLaunchAgent?: (threadId: string) => void;
  /**
   * Open ONE of my agents' panes from its sender pill (Samuel, 2026-08-28).
   *
   * ⚠ IT IS THE HOST'S OWN OPEN MECHANISM, NOT A SECOND PIPE. The key it takes is
   * `agents-model.ts › agentKey`'s — the same string the Agents tab's card hands
   * `onOpenAgent` (`agents-tab.tsx`) and the same one `agent-panel.tsx` resolves back to a
   * session, which for any stamped row IS the agent id. `channel-surface.tsx` wires both to
   * `use-channels-v2-selection.ts › setOpenAgent`.
   *
   * ⚠ ABSENT RENDERS AN INERT PILL, never a dead button — the pop-out thread window and any
   * other host with no agent pane beside it hand none. Same absent-not-disabled rule
   * `canLaunchAgent` above follows.
   */
  onOpenAgent?: (agentId: string) => void;
  /**
   * ANSWER an escalation card — post the pressed option back into this channel,
   * which is what routes it to the asking agent.
   *
   * ⚠ ABSENT RENDERS NO BUTTONS AT ALL, never disabled ones (the rule
   * `canLaunchAgent` above follows). The pop-out thread window and any other
   * host with no write path hand none, and a card there reads as the record of a
   * question rather than as a broken control.
   *
   * ⚠ IT TAKES THE ESCALATION'S OWN MESSAGE ID, not a thread or an agent. Who
   * gets woken is the SERVER's derivation off that message's stamp — the client
   * never names an agent, or this key would be a wake aimed anywhere.
   */
  onAnswerEscalation?: (escalationMessageId: string, optionIndex: number) => void;
  /** An answer is in flight — the double-submit guard, not a capability. */
  answerBusy?: boolean;
  onOpenThread: (id: string) => void;
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
        // ⚠ ONE CARD PER ARTIFACT PER PAGE, and it arrives already built
        // (`view-model-artifacts.ts`) — this branch renders it and decides
        // nothing. A row of this kind exists only where the server folded, so a
        // page with `entries === null` never reaches here and renders exactly as
        // it did before artifacts existed (the envelope is still additive).
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
              flash={row.id === flashId}
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
          />
        );
      })}
    </div>
  );
}

/**
 * HOW THE EXCHANGE ENDED — one slim, centred, muted line.
 *
 * ⚠ **NOT A MESSAGE BUBBLE, and the restraint is the design.** A receipt is the
 * transcript narrating itself, so it wears the `SystemRow` treatment (centred,
 * `text-caption`, `text-text-muted`) rather than a side, an avatar or a name:
 * nobody said this. The dot is the whole ornament.
 *
 * ⚠ **ONLY A REAL `failed` GETS ALARM INK.** Every other terminal is an ending
 * somebody CHOSE — declined, cancelled, interrupted, capped, ended — and
 * painting those red would report an operator's decision as a fault. That
 * distinction is the entire reason the desktop stores a calm flag beside the
 * `task_failed` kind (INVARIANTS §5; `lib/calm-terminal.ts`).
 *
 * ⚠ **The LABEL is flag-derived** (`lib/message-receipt.ts › RECEIPT_LABEL`),
 * never the row's own body — body copy is caller-influenceable and an outcome
 * is not a thing a caller may assert.
 */
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
 * THE BODY PARAGRAPH's face — one recipe, both views and both chromes.
 *
 * ⚠ `wrap-anywhere` (`overflow-wrap: anywhere`) IS THE WHOLE FIX, and it is not
 * interchangeable with `break-words` (Samuel, 2026-08-19: a run of
 * "segwegwtestets…" escaped the pane and clipped at its edge). `anywhere`
 * shrinks the element's MIN-CONTENT width, which `break-word` does not — and
 * min-content is exactly what an `items-end` (fit-content) own-message column
 * sizes itself from, so `break-word` would leave the block as wide as the
 * unbroken run and only wrap inside it. `break-all` is the other wrong answer:
 * it breaks ordinary prose mid-word too.
 *
 * ⚠ NO `text-right` ON OWN MESSAGES (same ruling; re-affirmed on a fourth look
 * after briefly flipping the other way). The BLOCK stays anchored right — that
 * is `items-end` on the column in `AuthoredRow` and it is unchanged, so a short
 * message still sits on the viewer's side (INVARIANTS §5, side comes from
 * `author_user_id`). The TEXT inside it reads left-aligned like every other
 * paragraph in the app once it wraps.
 *
 * ⚠ THE CAP IS 92%, DOWN FROM 75% AND UP FROM SAMUEL'S THIRD LOOK (2026-08-19):
 * text runs (nearly) the pane's full width, symmetric margins, matching the
 * pane border gutters — the transcript column's old 720px cap left with the
 * same ruling. The residual 8% is not taste: `items-end` alone does NOT
 * right-anchor a long body (align-self sizes a child to
 * `fit-content(available)`; once max-content exceeds the column it collapses
 * to FULL width and a wrapped own message reads as a full-width peer row), so
 * SOME cap below the column is what leaves `items-end` something to pull. 92%
 * keeps the anchoring legible at one line-indent's cost.
 *
 * ⚠ A PERCENTAGE, not a px measure, and BOTH SIDES wear it — a fixed cap stops
 * capping wherever the column is narrower (the pop-out thread window). Peer
 * rows keep hugging left either way.
 *
 * ⚠ IT IS NOW SPLIT IN TWO, AND THE SPLIT IS NOT COSMETIC (2026-08-21).
 * `message-markdown.tsx` renders EVERY block into this same column, so each one
 * needs the LAYOUT half — a list, a quote and a code fence must be capped and
 * anchored exactly like a paragraph. The TYPE half is a different question: a
 * heading and a code fence set their own size and weight, and handing them the
 * body's would be two `text-*` classes racing on one element.
 *
 * ⚠ AND `cn` COULD NOT ARBITRATE THAT RACE — measured 2026-08-21, not assumed.
 * `tailwind-merge` groups `text-lead` (this tree's SIZE scale) with
 * `text-text-primary` (a colour) because a custom `text-*` scale is
 * indistinguishable from a colour by name, so `cn(MESSAGE_BODY, "text-body …")`
 * silently drops the COLOUR. Passing the two halves separately means no block
 * ever receives a class it has to win against.
 *
 * A paragraph still gets both, in this order, so it is byte-for-byte the `<p>`
 * `transcript-body.test.tsx`'s layout pins measure.
 */
const MESSAGE_BLOCK = "wrap-anywhere max-w-[92%]";
const MESSAGE_TEXT = "text-lead text-text-primary";

/**
 * ⚠ THE OPENABLE GATE LIVES HERE, AND IT IS `AuthorIndex.agents` (Samuel, 2026-08-28).
 *
 * A pill only becomes a button when THIS MACHINE knows the agent it names — which is exactly
 * the condition under which `agent-panel.tsx` can resolve `openAgent` back to a session and
 * slide open. The map is the desktop feed, indexed by instance id
 * (`view-model.ts › indexAgents`), so the gate falls out of context this transcript is
 * already handed rather than a new capability prop:
 *
 *  - **the guest web lane** (`app/c/[workspaceId]`) and any plain browser — no bridge, so no
 *    feed, so the map is empty and every agent pill stays a `<span>`;
 *  - **the pop-out thread window** (`thread-window.tsx`) — `indexMembers` with no agents AND
 *    no `onOpenAgent`, doubly inert, which is right: it has no pane to slide;
 *  - **a PEER's agent** — it runs on their machine and never reaches this map, so the
 *    "state only, never openable" rule the peer CARDS already keep
 *    (`agents-tab-cards.tsx`) holds here for free;
 *  - **an UNSTAMPED agent post** — `row.agentId` is null, "cannot say which agent", and
 *    there is no pane a click could honestly open.
 *
 * ⚠ IT IS THE SAME KEY, NOT A PARALLEL ONE. `agents-model.ts › agentKey` answers the instance
 * id whenever a session has one, so a row this map knows is a row whose `agentId` IS that
 * session's key — the string the Agents tab's Open button sends down the identical path.
 */
function Message({
  row,
  index,
  flash,
  onOpenAgent,
}: {
  row: MessageRow;
  index: AuthorIndex;
  flash: boolean;
  onOpenAgent?: (agentId: string) => void;
}) {
  const agentId = row.agentId;
  const openAgent =
    onOpenAgent && agentId && index.agents.has(agentId)
      ? () => onOpenAgent(agentId)
      : undefined;
  // ⚠ THE STORED VERDICT, FACED AT RENDER (Samuel, 2026-09-05). A post that named
  // nobody and was routed anyway read back as unaddressed, which is a lie the
  // transcript was telling about its own history. The ids come off the row's
  // SERVER stamps (`view-model-rows.ts › routedAgentIds`) and the name off the
  // live index, exactly like the sender pill's — so a rename re-faces old rows
  // and no body is ever rewritten.
  const routed = routedTagLabel(row.routedAgentIds, index.agents);
  return (
    <AuthoredRow
      id={row.id}
      side={row.side}
      author={row.author}
      authorLabel={row.authorLabel}
      time={row.time}
      agent={row.agent}
      agentId={row.agentId}
      // ⚠ RESOLVED AT RENDER from the live feed, never read off the row (2026-08-27). A rename
      // reaches every message an agent has ever posted the moment main pushes the next summary.
      agentName={row.agentId ? (index.agents.get(row.agentId)?.displayName ?? null) : null}
      routedTo={routed?.face ?? null}
      routedTitle={routed?.title}
      continuation={row.continuation}
      flash={flash}
      onOpenAgent={openAgent}
    >
      {/* ⚠ THE WHOLE BODY GOES IN AT ONCE, not line by line (2026-08-21). The
          old split-on-`\n` loop could not see a fenced block or a list: it
          handed the renderer one line at a time, which is exactly the shape
          markdown is not. Blank lines still separate blocks — that is the
          paragraph rule, now the lexer's rather than this loop's. */}
      <MessageMarkdown
        text={row.body}
        index={index}
        mentionsMe={row.mentionsMe}
        blockClassName={MESSAGE_BLOCK}
        textClassName={MESSAGE_TEXT}
      />
    </AuthoredRow>
  );
}

