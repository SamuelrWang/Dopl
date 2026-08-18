/**
 * Channels v2 — CENTER COLUMN: breadcrumb header, the transcript and the
 * composer card.
 *
 * TWO views over one column (MAPPING.md § the center-pane state machine):
 *
 * - **Channel view** (`openThread === null`) — the channel transcript, crumb
 *   `# Website`.
 * - **Thread view** — the thread's OWN transcript replaces it, crumb becomes
 *   `# Website / <title>` and the channel crumb is the way back. The composer
 *   stays put in both; only the transcript and the crumb trail swap.
 *
 * Authorship is a SIDE, not a style: peers left, the viewer right, and an agent
 * hangs on its operator's side with an "Agent" chip beside the name — never in
 * a third column.
 *
 * Static fixture render. No scroll restoration, no pagination, no writes.
 */

import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Bot,
  ChevronRight,
  Hash,
  Info,
  Layers,
  MoreHorizontal,
  SmilePlus,
  Sparkles,
} from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import {
  AddresseePill,
  AgentChip,
  CARD_BUTTON,
  IconButton,
  MESSAGE_CARD,
  ReactionPill,
} from "./bits";
import {
  agentLabel,
  CHANNEL_MESSAGES,
  CHANNEL_TITLE,
  type BodySpan,
  type MockMessage,
} from "./mock-data";
import { THREADS, THREAD_TRANSCRIPTS, type MockThread } from "./mock-threads";
import { ChannelsV2Composer } from "./composer";

/** "1 of 3 agents approved" — the one phrasing, read by the card and by the
 *  thread view's status strip so the two can never state different progress. */
function approvalLine(thread: MockThread): string {
  const addressees = thread.addressees ?? [];
  const approved = addressees.filter((a) => a.approved).length;
  return `${approved} of ${addressees.length} agents approved`;
}

/**
 * The Tags inbox's scroll-to-message signal. NONCED: clicking the same mention
 * twice must re-scroll, and a plain `{messageId}` object would be swallowed the
 * moment somebody "optimizes" the state update with an equality check — the
 * nonce makes every click a distinct value by construction.
 */
export interface ScrollTarget {
  messageId: string;
  nonce: number;
}

export function ChannelsV2MessagePane({
  openThread,
  onExitThread,
  onOpenThread,
  scrollTarget,
}: {
  /** Thread id, or `null` for the channel view. */
  openThread: string | null;
  onExitThread: () => void;
  /** Set by an in-transcript thread card — the channel view's way IN. */
  onOpenThread: (id: string) => void;
  /** Set by the Info tab's Tags inbox; null until the first click. */
  scrollTarget: ScrollTarget | null;
}) {
  const thread = THREADS.find((t) => t.id === openThread) ?? null;
  const messages = thread
    ? THREAD_TRANSCRIPTS[thread.id] ?? []
    : CHANNEL_MESSAGES;

  const scrollerRef = useRef<HTMLDivElement>(null);
  // The flash is DERIVED: a target flashes until its nonce is marked spent by
  // the timeout. No synchronous setState in the effect — the render pass
  // already knows the flash is on the moment the target lands.
  const [spentNonce, setSpentNonce] = useState(0);
  const flashId =
    scrollTarget && scrollTarget.nonce !== spentNonce
      ? scrollTarget.messageId
      : null;

  // Runs POST-render, so when a mention click also swapped the view, the new
  // transcript is already in the DOM by the time we look the row up. Smooth
  // scroll unless the user asked for reduced motion; the flash fades on its own
  // via the row's colour transition.
  useEffect(() => {
    if (!scrollTarget) return;
    const row = scrollerRef.current?.querySelector(
      `[data-message-id="${scrollTarget.messageId}"]`
    );
    if (!row) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
    const timer = setTimeout(() => setSpentNonce(scrollTarget.nonce), 1600);
    return () => clearTimeout(timer);
  }, [scrollTarget]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <PaneHeader threadTitle={thread?.title ?? null} onExitThread={onExitThread} />
      {thread?.status === "requested" && (
        // Slim strip, the kit's SectionBox header face at pane width: the
        // thread is open and being worked by one agent while two have not
        // answered, and that is invisible from the transcript alone.
        <p className="shrink-0 border-b border-border-subtle bg-card-surface-subtle px-6 py-1.5 text-caption text-text-secondary">
          Requested — {approvalLine(thread)}
        </p>
      )}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex max-w-[720px] flex-col gap-5">
          {messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              flash={message.id === flashId}
              onOpenThread={onOpenThread}
            />
          ))}
        </div>
      </div>
      <ChannelsV2Composer />
    </section>
  );
}

function PaneHeader({
  threadTitle,
  onExitThread,
}: {
  threadTitle: string | null;
  onExitThread: () => void;
}) {
  return (
    <header className="flex h-[56px] shrink-0 items-center gap-1 border-b border-border-default px-4">
      <Hash size={14} className="shrink-0 text-text-muted" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
        {threadTitle === null ? (
          <span className="truncate text-body font-semibold text-text-primary">
            {CHANNEL_TITLE}
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={onExitThread}
              className="truncate rounded-[7px] px-1 py-0.5 text-body text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
            >
              {CHANNEL_TITLE}
            </button>
            <ChevronRight size={12} className="shrink-0 text-text-disabled" />
            <span className="truncate text-body font-semibold text-text-primary">
              {threadTitle}
            </span>
          </>
        )}
      </nav>
      <IconButton icon={Bookmark} label="Bookmark channel" size={14} className="h-6 w-6" />
      <span className="flex-1" />
      <IconButton icon={MoreHorizontal} label="More actions" />
      <IconButton icon={Sparkles} label="Ask the assistant" />
      <IconButton icon={Info} label="Channel info" />
    </header>
  );
}

function Message({
  message,
  flash,
  onOpenThread,
}: {
  message: MockMessage;
  /** Briefly true right after a Tags-inbox click lands on this row. */
  flash: boolean;
  onOpenThread: (id: string) => void;
}) {
  const {
    author,
    authorLabel,
    time,
    side,
    agent,
    paragraphs,
    attachment,
    threadCard,
    reactions,
    continuation,
  } = message;
  const mine = side === "me";
  return (
    <article
      data-message-id={message.id}
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
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-1.5",
          mine && "items-end"
        )}
      >
        {!continuation && (
          <div
            className={cn(
              "flex items-baseline gap-2",
              mine && "flex-row-reverse"
            )}
          >
            <span className="text-body font-semibold text-text-primary">
              {authorLabel}
            </span>
            {agent && <AgentChip className="self-center" />}
            <span className="text-micro text-text-muted">{time}</span>
          </div>
        )}
        {paragraphs.map((spans, i) => (
          <p
            key={i}
            className={cn("text-lead text-text-primary", mine && "text-right")}
          >
            {spans.map((span, j) => (
              <Span key={j} span={span} />
            ))}
          </p>
        ))}
        {attachment && <AttachmentCard {...attachment} />}
        {threadCard && (
          <ThreadRequestCard
            {...threadCard}
            onOpen={() => onOpenThread(threadCard.threadId)}
          />
        )}
        {reactions && reactions.length > 0 && (
          <div
            className={cn(
              "mt-0.5 flex items-center gap-1.5",
              mine && "flex-row-reverse"
            )}
          >
            {reactions.map((reaction) => (
              <ReactionPill key={reaction.emoji} {...reaction} />
            ))}
            <button
              type="button"
              aria-label="Add reaction"
              title="Add reaction"
              className="flex h-[22px] w-[26px] items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
            >
              <SmilePlus size={14} />
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function Span({ span }: { span: BodySpan }) {
  if (!span.mention) return <>{span.text}</>;
  return (
    <span
      className={cn(
        "font-medium text-link",
        // A mention OF THE VIEWER additionally gets a soft tint — these are
        // the rows the Tags inbox points at, and they should be findable by
        // eye once the scroll lands nearby.
        span.self && "rounded-[4px] bg-link/10 px-0.5"
      )}
    >
      {span.text}
    </span>
  );
}

function AttachmentCard({ title, host }: { title: string; host: string }) {
  return (
    <div className={cn(MESSAGE_CARD, "flex items-center gap-3")}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-border-default bg-bg-inset text-text-secondary">
        <Layers size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-text-primary">
          {title}
        </span>
        <span className="truncate text-caption text-text-muted">{host}</span>
      </span>
      <button type="button" className={CARD_BUTTON}>
        Quick view
      </button>
    </div>
  );
}

/**
 * THE POSTED AGENT THREAD — what a "New agent thread" send leaves in the
 * channel. Same `MESSAGE_CARD` face as the attachment card, because it is the
 * same object: a body the message points at rather than says.
 *
 * The card is the ONE artifact; storage fans it out to one thread per addressee
 * (INVARIANTS §5). Each pill's check is that member's own consent decision
 * (INVARIANTS §6) — this is the channel's existing consent prompt, read back.
 * Pills are inert here: the composer is where addressees are chosen.
 */
function ThreadRequestCard({
  threadId,
  preview,
  onOpen,
}: {
  threadId: string;
  preview: string;
  onOpen: () => void;
}) {
  const thread = THREADS.find((t) => t.id === threadId);
  if (!thread) return null;
  const addressees = thread.addressees ?? [];

  return (
    <div className={cn(MESSAGE_CARD, "flex flex-col gap-2 text-left")}>
      <div className="flex items-center gap-1.5">
        <Bot size={13} aria-hidden className="shrink-0 text-text-muted" />
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          Agent thread
        </span>
      </div>
      <span className="text-body font-semibold text-text-primary">
        {thread.title}
      </span>
      <p className="text-caption text-text-muted">{preview}</p>

      <div className="flex flex-wrap gap-1.5">
        {addressees.map(({ member, approved }) => (
          <AddresseePill
            key={member.userId}
            label={agentLabel(member)}
            approved={approved}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-caption text-text-muted">
          {approvalLine(thread)}
        </span>
        <button type="button" onClick={onOpen} className={CARD_BUTTON}>
          Open thread
        </button>
      </div>
    </div>
  );
}
