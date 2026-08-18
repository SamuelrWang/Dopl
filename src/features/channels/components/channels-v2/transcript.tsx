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
import { AddresseePill, CARD_BUTTON, MESSAGE_CARD } from "./bits";
import { AgentChip } from "./bits";
import { shortName, threadParties, type AuthorIndex, type MessageRow, type ThreadCardRow, type TranscriptRow } from "./view-model";

export function Transcript({
  rows,
  index,
  flashId,
  onOpenThread,
}: {
  rows: TranscriptRow[];
  index: AuthorIndex;
  /** Briefly set right after a Tags-inbox click lands on a row. */
  flashId: string | null;
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
        if (row.kind === "thread-card") {
          return (
            <ThreadCardMessage
              key={row.id}
              row={row}
              index={index}
              flash={row.id === flashId}
              onOpen={() => onOpenThread(row.thread.id)}
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
            <Body text={paragraph} index={index} />
          </p>
        )
      )}
    </AuthoredRow>
  );
}

/**
 * THE POSTED THREAD — what a thread's opening message leaves in the channel.
 *
 * Same `MESSAGE_CARD` face as the mock drew, because it is the same object: a
 * body the message points at rather than says. The card is the ONE artifact
 * and storage holds one requester + one target (INVARIANTS §5), so the pills
 * name the parties.
 *
 * ⚠ NO APPROVAL LINE. The mock's "1 of 3 agents approved" reads a fan-out that
 * Phase 3 builds and a consent projection that does not exist: consent is
 * per-target, TTL'd and re-derived at consume time (INVARIANTS §6), and the
 * absence of a pending row does not distinguish approved from never-asked.
 */
function ThreadCardMessage({
  row,
  index,
  flash,
  onOpen,
}: {
  row: ThreadCardRow;
  index: AuthorIndex;
  flash: boolean;
  onOpen: () => void;
}) {
  const parties = threadParties(row.thread, index);
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
        </div>
        <span className="text-body font-semibold text-text-primary">
          {row.thread.title}
        </span>
        <p className="line-clamp-3 text-caption text-text-muted">{row.preview}</p>

        {parties.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {parties.map((person) => (
              <AddresseePill
                key={person.userId}
                label={shortName(person, index.currentUserId)}
              />
            ))}
          </div>
        )}

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

/** A run of `@…` that could be a handle. Deliberately loose on the token and
 *  strict on the MATCH: only a token that resolves against the roster is
 *  tinted, so plain prose containing an `@` renders as prose. */
const MENTION_TOKEN = /(@[^\s@]+)/g;

/** Roster-derived handles a mention token may name. */
function handlesFor(index: AuthorIndex): Map<string, string> {
  const map = new Map<string, string>();
  for (const [userId, member] of index.byId) {
    for (const raw of [member.displayName, member.email?.split("@")[0]]) {
      if (!raw) continue;
      map.set(raw.toLowerCase(), userId);
      const first = raw.split(" ")[0];
      if (first) map.set(first.toLowerCase(), userId);
    }
  }
  return map;
}

/**
 * Message body with roster-resolved @-mentions tinted, and a mention OF THE
 * VIEWER additionally tinted — these are the rows the Tags inbox points at, and
 * they should be findable by eye once a scroll lands nearby.
 *
 * ⚠ PURE DISPLAY. Nothing here is the addressing rule: addressing is
 * `metadata.to_user_id`, stamped server-side and stripped from caller input
 * (INVARIANTS §5). A tinted name is not a claim that anybody was reached.
 */
function Body({ text, index }: { text: string; index: AuthorIndex }) {
  const handles = handlesFor(index);
  return (
    <>
      {text.split(MENTION_TOKEN).map((part, i) => {
        if (!part.startsWith("@")) return <span key={i}>{part}</span>;
        const userId = handles.get(part.slice(1).toLowerCase().replace(/[.,:;!?]+$/, ""));
        if (!userId) return <span key={i}>{part}</span>;
        return (
          <span
            key={i}
            className={cn(
              "font-medium text-link",
              userId === index.currentUserId && "rounded-[4px] bg-link/10 px-0.5"
            )}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}
