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
 */

import { Bot } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { AddresseePill, CARD_BUTTON } from "./bits";
import { AttributionPill } from "./attribution-pill";
import { MessageMarkdown } from "./message-markdown";
import { shortName, type AuthorIndex } from "./view-model";
import type { MessageRow, ReceiptRow, ThreadCardRow, TranscriptRow } from "./view-model-rows";

export function Transcript({
  rows,
  index,
  flashId,
  canLaunchAgent = false,
  launchBusy = false,
  onLaunchAgent,
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
        return (
          <Message
            key={row.id}
            row={row}
            index={index}
            flash={row.id === flashId}
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
 * The shell every authored row shares: the ATTRIBUTION PILL as the group header,
 * the body blocks under it, and the side.
 *
 * ⚠ THE HEADER IS A PILL AND THE AVATAR MOVED INSIDE IT (Samuel, 2026-08-22).
 * The `w-10` avatar gutter and the baseline name/chip/time row are GONE:
 * `attribution-pill.tsx › AttributionPill` carries avatar + name + time as one
 * capsule, and the message blocks stack BELOW it at full column width. That
 * changes the row from a horizontal pair into a column, so **the side is now
 * `items-end` / `items-start` on this element rather than `flex-row-reverse`** —
 * the RULE is unchanged (INVARIANTS §5: `authorUserId === currentUserId`), only
 * the axis it is expressed on. The bodies keep their own `items-end`, which is
 * what `MESSAGE_BLOCK`'s 92% cap gives them something to pull against.
 *
 * ⚠ A CONTINUATION STILL DROPS THE HEADER, and now drops NO indent with it.
 * Under the gutter layout a continuation had to keep a `w-10` spacer or it lined
 * up left of the row it continued; with the pill above the body, the first row's
 * body starts at the same edge a continuation's does, so the spacer would be the
 * thing that misaligned them.
 */
function AuthoredRow({
  id,
  side,
  author,
  authorLabel,
  time,
  agent,
  agentId = null,
  continuation,
  flash,
  children,
}: {
  id: string;
  side: "me" | "peer";
  author: MessageRow["author"];
  authorLabel: string;
  time: string;
  agent: boolean;
  /** WHICH agent, when the writer stamped it — see `attribution-pill.tsx`. */
  agentId?: string | null;
  continuation: boolean;
  flash: boolean;
  children: React.ReactNode;
}) {
  const mine = side === "me";
  return (
    <article
      data-message-id={id}
      className={cn(
        // The negative margin + padding pair keeps the flash tint from
        // shifting layout: the row always owns the strip it may highlight.
        "-mx-2 flex flex-col gap-1.5 rounded-[10px] px-2 py-1 transition-colors duration-700",
        mine ? "items-end" : "items-start",
        flash && "bg-link/10 duration-150"
      )}
    >
      {!continuation && (
        <AttributionPill
          author={author}
          authorLabel={authorLabel}
          agent={agent}
          agentId={agentId}
          time={time}
        />
      )}
      {/* ⚠ `w-full` so the column is the row's full width whatever the article's
          align-items says — the pill hugs its content, the bodies must not. */}
      <div className={cn("flex w-full min-w-0 flex-col gap-1.5", mine && "items-end")}>
        {children}
      </div>
    </article>
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

function Message({
  row,
  index,
  flash,
}: {
  row: MessageRow;
  index: AuthorIndex;
  flash: boolean;
}) {
  return (
    <AuthoredRow
      id={row.id}
      side={row.side}
      author={row.author}
      authorLabel={row.authorLabel}
      time={row.time}
      agent={row.agent}
      agentId={row.agentId}
      continuation={row.continuation}
      flash={flash}
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

/**
 * THE POSTED REQUEST — what a "New agent thread" send leaves in the channel.
 *
 * Dark-shell card (2026-08-19) — no longer the `MESSAGE_CARD` face: a
 * body the message points at rather than says. **ONE CARD, N THREADS** — the
 * fan-out writes one `channel_tasks` row per addressee (INVARIANTS §5: a thread
 * is one requester + one target) and they share a server-stamped `fanoutGroup`,
 * so each pill is one real ADDRESSEE, read off that thread's own
 * `targetUserId`.
 *
 * ⚠ THE PILLS CARRY NO APPROVAL STATE, and their absence is a measurement, not
 * a style choice. The mock's "1 of 3 agents approved" needs a per-target consent
 * projection, and a consent read is scoped to `(operator, workspace)` with the
 * operator always `ctx.userId` (INVARIANTS §6) — so the REQUESTER cannot see
 * their addressees' decisions at all, and "no pending row" would report
 * never-asked as approved. Filed as REFACTOR-FINDINGS F-206; the pill states the
 * party and nothing else until a projection exists.
 *
 * ⚠ AND IT CARRIES NO PENDING STATE OF THE VIEWER'S OWN EITHER, SINCE 2026-08-22
 * (Samuel): *"remove all the stuff about declining and approving of threads — you
 * have the thread, you open it, and either you launch agent or you don't."* The
 * `PendingChip`, the `requested` set behind it and the inline **Decline /
 * Launch agent** consent pair are all DELETED. What is left is TWO ACTIONS and
 * neither is an answer to anybody: **Open thread** (the existing selection nav)
 * and **Launch agent** (the direct launch — `use-agents-panel.ts › launchAgent`,
 * which spawns a responder-style agent on this card's own thread). No decline
 * anywhere.
 */
function ThreadCardMessage({
  row,
  index,
  flash,
  canLaunchAgent,
  launchBusy,
  onLaunch,
  onOpen,
}: {
  row: ThreadCardRow;
  index: AuthorIndex;
  flash: boolean;
  canLaunchAgent: boolean;
  launchBusy: boolean;
  onLaunch: () => void;
  onOpen: () => void;
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
      {/* Dark shell (Samuel, 2026-08-19, from the "AI Tools" reference): the
          card is a CTA-ink container whose top bar carries the label in white,
          with the white panel INSET inside it, own rounded corners — the
          `--surface-cta` / `--text-on-cta` pair, the same ink `.auth-btn-3d`
          wears, never a literal hex. */}
      <div className="mt-1 w-full max-w-[460px] overflow-hidden rounded-[14px] bg-surface-cta text-left ring-1 ring-surface-cta">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <Bot size={13} aria-hidden className="shrink-0 text-text-on-cta" />
          <span className="text-small font-medium text-text-on-cta">
            Agent thread
          </span>
          <span className="flex-1" />
        </div>
        {/* `m-0.5 mt-0`: the sliver of ink left visible around the white panel
            is the reference's border-line (thinned from m-1, Samuel
            2026-08-19); the bar above supplies the top. `bg-white` is a ruled
            exception to the token surfaces — Samuel wants this panel PURE
            white, not `--bg-elevated`'s near-white. */}
        <div className="m-0.5 mt-0 flex flex-col gap-2 rounded-[12px] bg-white p-3">
        {/* ⚠ Same `wrap-anywhere` rule as the body, for the same reason: a
            title or a preview with no spaces in it would otherwise size this
            card's column off its min-content width and run past the card
            edge (the `line-clamp` only hides the overflow, it does not stop
            it). */}
        <span className="wrap-anywhere text-body font-semibold text-text-primary">
          {first.title}
        </span>
        <p className="line-clamp-3 wrap-anywhere text-caption text-text-muted">
          {row.preview}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {row.threads.map((thread) => {
            const person = thread.targetUserId
              ? index.byId.get(thread.targetUserId)
              : undefined;
            // ⚠ An addressee the roster cannot resolve still gets a pill — the
            // request WAS raised against them, and dropping the pill would
            // under-report who was addressed. It is the one claim this card
            // must never get wrong.
            return (
              <AddresseePill
                key={thread.id}
                label={
                  person
                    ? shortName(
                        {
                          userId: person.userId,
                          email: person.email,
                          displayName: person.displayName,
                          avatarUrl: person.avatarUrl,
                        },
                        index.currentUserId
                      )
                    : "Unknown member"
                }
              />
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-caption text-text-muted" />
          {/* ⚠ TWO ACTIONS, AND NEITHER IS A CONSENT DECISION (Samuel,
              2026-08-22). The inline Decline / Launch agent pair that stood
              here answered a `pending` inbound row through the CAS'd
              `PATCH /consent/[id]`; that lane is gone, along with the strip
              under the thread header and the Inbox's inbound rows. **THERE IS
              NO DECLINE ANYWHERE.**

              "Launch agent" is the DIRECT launch — the same bridge op the
              composer's Bot icon and the Agents tab's New Agent button fire
              (`use-agents-panel.ts › launchAgent`), spawning one of the
              operator's own agents on THIS card's thread. It raises no consent
              row and answers no request.

              ⚠ IT IS `openThreadId`, THE SAME THREAD "Open thread" OPENS, and
              that identity is load-bearing: a fan-out card names N threads, and
              `view-model-rows.ts › ownThreadOf` already picked the one this
              viewer is party to. Launching on any other one would start an
              agent in an exchange the operator cannot write in.

              ⚠ ABSENT, NOT DISABLED, WITHOUT THE BRIDGE. A plain browser has no
              agent to start, and a permanently greyed button is
              indistinguishable from a broken one (`bits.tsx › IconButton`
              carries the same rule). `launchBusy` is the in-flight guard over a
              real click and is a different fact. */}
          {canLaunchAgent && (
            <button
              type="button"
              disabled={launchBusy}
              onClick={onLaunch}
              className="auth-btn-3d h-8 shrink-0 rounded-[8px] px-3 text-caption font-medium text-white disabled:opacity-60"
            >
              Launch agent
            </button>
          )}
          <button type="button" onClick={onOpen} className={CARD_BUTTON}>
            Open thread
          </button>
        </div>
        </div>
      </div>
    </AuthoredRow>
  );
}
