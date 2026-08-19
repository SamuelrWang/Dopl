"use client";

/**
 * Channels v2 — THE TRANSCRIPT: the rows of one channel or one thread.
 *
 * Authorship is a SIDE, not a style: peers left, the viewer right, and an agent
 * hangs on its OPERATOR's side with an "Agent" chip beside the name — never in
 * a third column (MAPPING.md § Message alignment).
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
import { AddresseePill, CARD_BUTTON, MESSAGE_CARD, PendingChip } from "./bits";
import { AgentChip } from "./bits";
import {
  MENTION_TOKEN_RE,
  buildMentionIndex,
  resolveMentionToken,
} from "../../lib/mentions";
import { shortName, type AuthorIndex, type MessageRow, type ReceiptRow, type ThreadCardRow, type TranscriptRow } from "./view-model";

export function Transcript({
  rows,
  index,
  flashId,
  requested,
  onOpenThread,
}: {
  rows: TranscriptRow[];
  index: AuthorIndex;
  /** Briefly set right after a Tags-inbox click lands on a row. */
  flashId: string | null;
  /** Thread ids the viewer has been asked about and has not answered. */
  requested: ReadonlySet<string>;
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
    <div className="flex max-w-[720px] flex-col gap-5">
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
            <span className="text-body font-semibold text-text-primary">
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

function Message({
  row,
  index,
  flash,
}: {
  row: MessageRow;
  index: AuthorIndex;
  flash: boolean;
}) {
  const mine = row.side === "me";
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
          <p
            key={i}
            className={cn("text-lead text-text-primary", mine && "text-right")}
          >
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
 * Same `MESSAGE_CARD` face as the mock drew, because it is the same object: a
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
 * never-asked as approved. Filed as REFACTOR-FINDINGS F-203; the pill states the
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
  onOpen,
}: {
  row: ThreadCardRow;
  index: AuthorIndex;
  flash: boolean;
  requested: ReadonlySet<string>;
  onOpen: () => void;
}) {
  const first = row.threads[0];
  const waiting = row.threads.some((t) => requested.has(t.id));
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
      <div className={cn(MESSAGE_CARD, "flex flex-col gap-2 text-left")}>
        <div className="flex items-center gap-1.5">
          <Bot size={13} aria-hidden className="shrink-0 text-text-muted" />
          <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
            Agent thread
          </span>
          <span className="flex-1" />
          {waiting && <PendingChip />}
        </div>
        <span className="text-body font-semibold text-text-primary">
          {first.title}
        </span>
        <p className="line-clamp-3 text-caption text-text-muted">{row.preview}</p>

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
          <button type="button" onClick={onOpen} className={CARD_BUTTON}>
            Open thread
          </button>
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
