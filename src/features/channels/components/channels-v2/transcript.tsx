"use client";

/**
 * Channels v2 — THE TRANSCRIPT: the rows of one channel or one thread.
 *
 * Authorship is a SIDE, not a style: peers left, the viewer right, and an agent
 * hangs on its OPERATOR's side with an "Agent" chip beside the name — never in
 * a third column (INVARIANTS §5).
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
import { Avatar } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { AddresseePill, CARD_BUTTON, PendingChip } from "./bits";
import { AgentChip } from "./bits";
import {
  MENTION_TOKEN_RE,
  buildMentionIndex,
  resolveMentionToken,
} from "../../lib/mentions";
import { shortName, type AuthorIndex } from "./view-model";
import type { MessageRow, ReceiptRow, ThreadCardRow, TranscriptRow } from "./view-model-rows";

export function Transcript({
  rows,
  index,
  flashId,
  requested,
  onDecideThread,
  onOpenThread,
}: {
  rows: TranscriptRow[];
  index: AuthorIndex;
  /** Briefly set right after a Tags-inbox click lands on a row. */
  flashId: string | null;
  /** Thread ids the viewer has been asked about and has not answered. */
  requested: ReadonlySet<string>;
  /** Decide a pending ask inline, right on the card (Samuel, 2026-08-20). */
  onDecideThread: (threadId: string, decision: "allow" | "deny") => void;
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
              requested={requested}
              onDecide={onDecideThread}
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

/** The shell every authored row shares: avatar gutter, name line, side. */
function AuthoredRow({
  id,
  side,
  author,
  authorLabel,
  time,
  agent,
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
        "-mx-2 flex gap-3 rounded-[10px] px-2 py-1 transition-colors duration-700",
        mine && "flex-row-reverse",
        flash && "bg-link/10 duration-150"
      )}
    >
      <div className="w-10 shrink-0">
        {!continuation && <Avatar person={author} size="md" />}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", mine && "items-end")}>
        {!continuation && (
          <div className={cn("flex items-baseline gap-2", mine && "flex-row-reverse")}>
            {/* `wrap-anywhere` for the same reason as the body: a roster name
                with no spaces in it must not widen the row past the pane. */}
            <span className="wrap-anywhere text-body font-semibold text-text-primary">
              {authorLabel}
            </span>
            {agent && <AgentChip className="self-center" />}
            <span className="text-micro text-text-muted">{time}</span>
          </div>
        )}
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
 */
const MESSAGE_BODY = "wrap-anywhere max-w-[92%] text-lead text-text-primary";

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
      continuation={row.continuation}
      flash={flash}
    >
      {row.body.split("\n").map((paragraph, i) =>
        paragraph.trim().length === 0 ? null : (
          <p key={i} className={MESSAGE_BODY}>
            <Body text={paragraph} index={index} mentionsMe={row.mentionsMe} />
          </p>
        )
      )}
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
 * ⚠ What IS derivable is the mirror image: a thread addressed to the VIEWER
 * whose own consent request is still pending renders `PendingChip`. That is
 * their own inbox, joined on the triggering seq — real data, and asymmetric for
 * exactly the reason above.
 */
function ThreadCardMessage({
  row,
  index,
  flash,
  requested,
  onDecide,
  onOpen,
}: {
  row: ThreadCardRow;
  index: AuthorIndex;
  flash: boolean;
  requested: ReadonlySet<string>;
  onDecide: (threadId: string, decision: "allow" | "deny") => void;
  onOpen: () => void;
}) {
  const first = row.threads[0];
  const waiting = row.threads.some((t) => requested.has(t.id));
  // The thread on this card THIS viewer owes an answer on (at most one — a
  // fan-out raises one thread per addressee).
  const ownedPending =
    row.threads.find((t) => requested.has(t.id))?.id ?? null;
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
          {waiting && <PendingChip />}
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
          {/* INLINE DECISION (Samuel, 2026-08-20; closes F-214's one-click
              gap): when THIS viewer owes an answer on one of the card's
              threads, the decision lives here rather than in something that
              floats over the page — the arrival pop-up is deleted. Same
              consent mutation, same CAS, same gate. "Launch agent" = the
              consent ALLOW, one click, saved/default launch settings; a
              fan-out addresses one thread at this viewer, so the first owed
              thread is the one being decided.

              ⚠ THIS IS ONE OF THREE DECISION SURFACES, NOT ONE OF TWO. The
              card and `thread-consent.tsx › ThreadAwaitingStrip` decide rows
              the seq→thread join could PLACE; `inbox-pane.tsx › InboxRow`
              decides the ones it could not (untagged triggers, aged-out
              pages, seq-less outbound drafts) and is the durable home of last
              resort. It is not a passive list — do not restate it as one, and
              do not remove its buttons on the strength of this comment. */}
          {ownedPending && (
            <>
              <button
                type="button"
                onClick={() => onDecide(ownedPending, "deny")}
                className={CARD_BUTTON}
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => onDecide(ownedPending, "allow")}
                className="auth-btn-3d h-8 shrink-0 rounded-[8px] px-3 text-caption font-medium text-white"
              >
                Launch agent
              </button>
            </>
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

/**
 * Message body with roster-resolved @-mentions tinted, and a mention OF THE
 * VIEWER additionally tinted — these are the rows the Tags inbox points at, and
 * they should be findable by eye once a scroll lands nearby.
 *
 * ⚠ ONE PARSER, ONE SOURCE OF "AM I TAGGED" (reconciled in Phase 6; there used
 * to be a private copy of the token rule and the handle map right here).
 *   - WHERE a tint goes is `lib/mentions.ts`, the SAME module the server's
 *     resolution runs, so the transcript cannot tint a name the stamp did not
 *     resolve;
 *   - WHETHER the viewer is tagged is `row.mentionsMe`, read off the
 *     SERVER-STAMPED `metadata.mentionedUserIds` (`view-model.ts ›
 *     toMessageRow`). That is the same fact the Tags inbox lists, so the
 *     transcript and the inbox cannot disagree about whether a message tagged
 *     you — which they could while the tint re-derived it from a roster that
 *     may have changed since the message was written.
 *
 * ⚠ PURE DISPLAY. Nothing here is the addressing rule: addressing is
 * `metadata.to_user_id`, stamped server-side and stripped from caller input
 * (INVARIANTS §5). A tinted name is not a claim that anybody was reached.
 */
function Body({
  text,
  index,
  mentionsMe,
}: {
  text: string;
  index: AuthorIndex;
  mentionsMe: boolean;
}) {
  const handles = buildMentionIndex([...index.byId.values()]);
  return (
    <>
      {text.split(MENTION_TOKEN_RE).map((part, i) => {
        if (!part.startsWith("@")) return <span key={i}>{part}</span>;
        const userId = resolveMentionToken(part, handles);
        if (!userId) return <span key={i}>{part}</span>;
        return (
          <span
            key={i}
            className={cn(
              "font-medium text-link",
              // ⚠ BOTH halves required: the stamp says this message tags me,
              // the token says THIS is where. The stamp alone cannot place a
              // highlight and the token alone is a re-derivation.
              mentionsMe &&
                userId === index.currentUserId &&
                "rounded-[4px] bg-link/10 px-0.5"
            )}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}
