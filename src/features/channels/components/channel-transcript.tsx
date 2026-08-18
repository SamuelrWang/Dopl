"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { pendingRow } from "@/shared/ui/pending";
import type { ChannelAgent, ChannelMessage } from "../types";
import { agentAttributionFor } from "../lib/agent-display";
import { isPendingId } from "../lib/optimistic-cache";
import {
  deriveMessageReceipt,
  RECEIPT_LABEL,
  type ReceiptStatus,
} from "../lib/message-receipt";
import { ActivityEventRow } from "./activity-event-row";

/**
 * The channel transcript. Human messages and agent chat render as bordered
 * bubbles (agent = elevated surface, human = subtle card surface); `task_*` and
 * `system` rows are flat centered activity lines. Addressing metadata shows who
 * a message was directed at + why.
 *
 * ⚠ THE SESSION CARD IS GONE — wiring plan Phase 5 (2026-08-18). Every row that
 * used to collapse into one now renders on its own, because the machinery that
 * grouped them (`lib/group-thread*`, `session-card.tsx`, `session-card-status`,
 * the `channel_tasks` status/title OVERLAY and its loading-flicker suppression)
 * was deleted with the surface it fed. An agent's run state lives in the AGENTS
 * TAB (`channels-v2/agents-tab.tsx`), read from the operator's own machine —
 * not in a shared transcript.
 *
 * ⚠ THIS PAGE IS ON ITS WAY OUT AND THIS IS THE SMALLEST EDIT THAT KEEPS IT
 * HONEST, not a redesign. `channels-view-core.tsx` and everything under it are
 * deleted at the v2 cutover (wiring plan Phase 12); the v2 transcript
 * (`channels-v2/transcript.tsx`) is where the replacement already lives, and it
 * drops the three runtime kinds outright (`view-model.ts › isLifecycleEcho`).
 * Here they still render as activity lines, which is what they were before the
 * card existed. Do not invest in this component.
 *
 * ⚠ Only plain chat bubbles are SIDED (viewer's own right, everyone else's left,
 * capped at ~2/3 of the column). Activity lines stay FULL WIDTH — they are
 * shared state, not someone's turn in the conversation.
 *
 * ⚠ THE `session:<threadId>` ANCHOR SURVIVED THE CARD, deliberately. It was the
 * card's element id and `rooms-sidebar.tsx` scrolls to it; it now rides the
 * FIRST row of each thread instead, so the one navigation this page still has
 * keeps working. What did NOT survive is the transient ring — that was a
 * property of the card, and ringing an arbitrary bubble would point at a message
 * rather than at the exchange.
 */
export function ChannelTranscript({
  messages,
  memberNames,
  currentUserId,
  agents,
}: {
  messages: ChannelMessage[];
  /** userId -> display name, for rendering addressing targets. */
  memberNames: Map<string, string>;
  /** Attribution for agent-authored messages. Omitted / unresolvable falls back
   *  to the plain "agent" pill. */
  agents?: ChannelAgent[];
  /** Gates the outgoing-message receipt line to the viewer's own bubbles. */
  currentUserId: string;
}) {
  const anchored = new Set<string>();
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((message) => {
        const taskId = readString(message.metadata.taskId);
        let anchorId: string | undefined;
        if (taskId !== null && !anchored.has(taskId)) {
          anchored.add(taskId);
          anchorId = `session:${taskId}`;
        }
        return message.kind === "message" ? (
          <MessageBubble
            key={message.id}
            anchorId={anchorId}
            message={message}
            messages={messages}
            memberNames={memberNames}
            currentUserId={currentUserId}
            agents={agents}
          />
        ) : (
          <ActivityEventRow key={message.id} anchorId={anchorId} message={message} />
        );
      })}
    </div>
  );
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function MessageBubble({
  anchorId,
  message,
  messages,
  memberNames,
  currentUserId,
  agents,
}: {
  /** `session:<threadId>` on the FIRST row of a thread — the anchor
   *  `rooms-sidebar.tsx` scrolls to. Undefined on every other row. */
  anchorId?: string;
  message: ChannelMessage;
  /** The full transcript, for deriving this message's outgoing receipt. */
  messages: ChannelMessage[];
  memberNames: Map<string, string>;
  currentUserId: string;
  agents?: ChannelAgent[];
}) {
  // PROVISIONAL, and it says so. The send patches the transcript one
  // frame after the click with a row carrying a `pending:` id (built by
  // `buildPendingMessage`, resolved to the saved row by `reconcileMessage`), so
  // that id IS the pending marker and no second flag rides the row. Until the
  // POST answers the bubble is dimmed and inert: the real text, immediately,
  // without claiming to be sent. `pending.ts` owns the recipe.
  const provisional = isPendingId(message.id);
  const isHuman = message.authorKind === "user";
  // Chat-style side: only MY OWN human message goes right. Everything else goes
  // left, including an AGENT row carrying my user id (my agent speaks for itself,
  // not for me), which is why this is gated on `authorKind === "user"` too.
  const isOwn = isHuman && message.authorUserId === currentUserId;
  const name = message.authorName || (isHuman ? "Member" : "Agent");
  const toUserId = readString(message.metadata.to_user_id);
  const summary = readString(message.metadata.summary);
  const toName = toUserId ? memberNames.get(toUserId) ?? "a teammate" : null;
  const receipt = deriveMessageReceipt(message, messages, currentUserId);
  // Named-agent attribution: a message stamped with `metadata.author_agent_id`
  // that resolves to a loaded agent says WHICH agent wrote it ("quartz ·
  // Ada's agent"). Unstamped, unresolvable, or a non-agent author keeps the
  // plain pill — the metadata key is display only and is never trusted further.
  const attribution = agentAttributionFor(
    message,
    agents ?? [],
    memberNames,
    currentUserId
  );

  // A summary promotes to the prominent line; the full body collapses behind a
  // chevron (default collapsed). A message with no summary keeps its body shown
  // inline exactly as before.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() =>
    summary ? new Set([message.id]) : new Set()
  );
  const collapsed = summary !== null && collapsedIds.has(message.id);
  const toggle = () =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next;
    });

  return (
    <article
      id={anchorId}
      {...pendingRow(
        provisional,
        cn(
          "max-w-[66%] rounded-[10px] border px-3.5 py-2.5",
          isOwn ? "self-end" : "self-start",
          isHuman
            ? "border-border-default bg-card-surface-subtle"
            : "border-border-subtle bg-bg-elevated"
        )
      )}
    >
      <div
        className={cn(
          "mb-1 flex items-center gap-1.5",
          isOwn && "justify-end"
        )}
      >
        {/* My own bubble drops the avatar: the right-hand side already says who
            wrote it, and a second identity marker only crowds the line. */}
        {!isOwn && (
          <Avatar
            person={{
              userId: message.authorUserId ?? name,
              email: null,
              displayName: message.authorName,
              avatarUrl: message.authorAvatarUrl,
            }}
            size="xs"
          />
        )}
        <span className="text-micro font-medium uppercase tracking-wide text-text-muted">
          {name} · {formatChannelTimestamp(message.createdAt)}
        </span>
        {!isHuman && (
          <span className="rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
            {message.authorKind === "agent" ? (
              attribution ? (
                <>
                  <span className="font-semibold text-text-primary">
                    {attribution.handle}
                  </span>
                  {` · ${attribution.ownerLabel}`}
                </>
              ) : (
                "agent"
              )
            ) : (
              "system"
            )}
          </span>
        )}
      </div>
      {toName && (
        <div
          className={cn(
            "mb-1 flex items-center gap-1 text-micro font-medium text-text-secondary",
            isOwn && "justify-end"
          )}
        >
          <ArrowRight size={11} className="shrink-0" />
          <span className="text-text-primary">{toName}</span>
        </div>
      )}
      {summary ? (
        <>
          <div className="flex items-start gap-1.5">
            <button
              type="button"
              onClick={toggle}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand message" : "Collapse message"}
              className="shrink-0 rounded-md p-0.5 text-text-muted transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
            >
              {collapsed ? (
                <ChevronRight size={13} />
              ) : (
                <ChevronDown size={13} />
              )}
            </button>
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-body font-medium leading-relaxed text-text-primary">
              {summary}
            </p>
          </div>
          {!collapsed && (
            <p className="mt-1 whitespace-pre-wrap break-words text-body leading-relaxed text-text-secondary">
              {message.body}
            </p>
          )}
        </>
      ) : (
        <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-text-primary">
          {message.body}
        </p>
      )}
      {receipt && <ReceiptLine status={receipt} own={isOwn} />}
    </article>
  );
}

/**
 * The delivery receipt under MY own outgoing standalone message — a quiet
 * text-micro line with a tiny leading dot. A real `failed` is danger-inked;
 * every other outcome, including the calm operator-chosen terminals, stays
 * muted. There is deliberately no
 * "Received"/"Read": the desktop does not ack, so the transcript is the only
 * source of truth.
 *
 * The line follows its bubble's side, so a receipt under a right-hand own
 * message reads flush to the same edge as the message it belongs to.
 */
function ReceiptLine({
  status,
  own = false,
}: {
  status: ReceiptStatus;
  /** True when the receipt sits under a right-aligned own bubble. */
  own?: boolean;
}) {
  const danger = status === "failed";
  return (
    <div
      className={cn(
        "mt-1.5 flex items-center gap-1 text-micro font-medium",
        own && "justify-end",
        danger ? "text-danger" : "text-text-muted"
      )}
    >
      <span
        className={cn(
          "h-1 w-1 shrink-0 rounded-full",
          danger ? "bg-danger" : "bg-text-muted"
        )}
      />
      {RECEIPT_LABEL[status]}
    </div>
  );
}
