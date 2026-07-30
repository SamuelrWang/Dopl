"use client";

import { useMemo, useState } from "react";
import { Info, SendHorizontal, WifiOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { FIELD_WELL } from "@/shared/ui/wells";
import type { ChannelMember } from "../types";
import { AddressPicker } from "./address-picker";

export interface SendOptions {
  toUserId?: string;
  summary?: string;
}

interface Props {
  /** Resolve when the send settles; a rejection keeps the text for retry. */
  onSend: (body: string, opts?: SendOptions) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  /** Channel roster (with presence) for the addressing picker. */
  members: ChannelMember[];
  currentUserId: string;
  /**
   * True in a direct (1:1) channel. A DM has exactly one peer, so there is no
   * one to pick: the addressing row is hidden and every human send auto-targets
   * that peer (`toUserId = peer`).
   */
  isDirect?: boolean;
}

/**
 * Resolve the addressing options for a human send. Pure so the addressing
 * model (DM auto-targets the peer; a channel send carries the picked addressee;
 * an unaddressed channel send targets no one) is unit-testable without a DOM.
 *
 * - Direct channel: always addresses the resolved peer; the summary is the
 *   optional one-liner (undefined when blank).
 * - Channel with a picked addressee: addresses them; the summary is the
 *   one-liner, or the first line of the body as an implicit intent.
 * - Channel with no addressee: no options (the message reaches no agent).
 */
export function resolveSendOptions(params: {
  isDirect: boolean;
  peerId: string | null;
  toUserId: string | null;
  summary: string;
  body: string;
}): SendOptions | undefined {
  const { isDirect, peerId, toUserId, summary, body } = params;
  const trimmedSummary = summary.trim();
  if (isDirect) {
    return peerId
      ? { toUserId: peerId, summary: trimmedSummary || undefined }
      : undefined;
  }
  if (toUserId) {
    return {
      toUserId,
      summary: trimmedSummary || body.split("\n")[0].slice(0, 200),
    };
  }
  return undefined;
}

/**
 * Message composer pinned to the bottom of the thread. One unified input: a
 * concave-field well with an auto-submitting textarea (Enter sends, Shift+Enter
 * adds a newline) and a raised send button. Above the well, an optional
 * addressing row targets one teammate's agent (`toUserId`) with a one-line
 * intent (`summary`); in a DM the peer is implicit, so only the optional
 * one-liner shows.
 *
 * A human send ALWAYS posts a message. Opening a thread is no longer a human
 * toggle — it is agent-driven (an agent calls `create_thread` over MCP), and the
 * web still renders any resulting threads with their cards / milestones /
 * receipts.
 *
 * In a DM every human send auto-addresses the peer. In a channel of three or
 * more, an UNADDRESSED message triggers no agent at all (the targeting rule
 * only implies a recipient in a two-person channel), so the composer says so
 * rather than letting the message land silently.
 */
export function MessageComposer({
  onSend,
  disabled,
  placeholder,
  members,
  currentUserId,
  isDirect,
}: Props) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [toUserId, setToUserId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");

  // The peer of a direct channel is the one other member; every DM send
  // auto-targets it, so a stale picked addressee can never color a direct send.
  const peerId = useMemo(
    () =>
      isDirect
        ? members.find((m) => m.userId !== currentUserId)?.userId ?? null
        : null,
    [isDirect, members, currentUserId]
  );

  // The agent a send actually reaches: the DM peer, else the picked addressee
  // (null in a channel = an unaddressed broadcast).
  const resolvedTargetId = isDirect ? peerId : toUserId;
  const target = useMemo(
    () =>
      resolvedTargetId
        ? members.find((m) => m.userId === resolvedTargetId) ?? null
        : null,
    [resolvedTargetId, members]
  );

  const canSendMessage = value.trim().length > 0 && !sending && !disabled;

  // Two members = the other one is the implicit target, so an unaddressed
  // message still reaches an agent. Three or more and it reaches none. A DM
  // never shows this (it always has an implicit peer).
  const showUnaddressedHint = !isDirect && !toUserId && members.length >= 3;

  async function sendMessage() {
    if (!canSendMessage) return;
    const body = value.trim();
    const opts = resolveSendOptions({
      isDirect: Boolean(isDirect),
      peerId,
      toUserId,
      summary,
      body,
    });
    setSending(true);
    try {
      await onSend(body, opts);
      setValue("");
      setSummary("");
      setToUserId(null);
    } catch {
      // Keep the text so the user can retry; the caller surfaces the error.
    } finally {
      setSending(false);
    }
  }

  const offlineHint = target && !target.agentOnline && (
    <div className="mb-2 flex items-center gap-1.5 text-caption text-text-muted">
      <WifiOff size={12} className="shrink-0" />
      {target.lastSeenAt === null
        ? "Their agent has never connected. Nothing picks this up until they set up the desktop app."
        : "Their agent is offline. This will run when it reconnects."}
    </div>
  );

  return (
    <div className="shrink-0 px-14 pb-5 pt-2">
      <div className="mx-auto max-w-[760px]">
        {!isDirect ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <AddressPicker
              members={members}
              currentUserId={currentUserId}
              value={toUserId}
              onChange={(next) => {
                setToUserId(next);
                if (!next) setSummary("");
              }}
            />
            {toUserId && (
              <input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                maxLength={200}
                placeholder="One-line intent (optional)"
                className={cn(
                  FIELD_WELL,
                  "min-w-0 flex-1 rounded-full px-3 py-1 text-caption text-text-primary placeholder:text-text-muted"
                )}
              />
            )}
          </div>
        ) : (
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={200}
            placeholder="One-line intent (optional)"
            className={cn(
              FIELD_WELL,
              "mb-2 w-full rounded-full px-3 py-1 text-caption text-text-primary placeholder:text-text-muted"
            )}
          />
        )}

        {offlineHint}

        {showUnaddressedHint && (
          <div className="mb-2 flex items-center gap-1.5 text-caption text-text-muted">
            <Info size={12} className="shrink-0" />
            No agent will pick this up unless you address it.
          </div>
        )}

        <div className="concave-field flex items-end gap-2 rounded-[12px] px-3 py-2">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            rows={1}
            disabled={disabled}
            placeholder={placeholder ?? "Message the channel"}
            spellCheck
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-body leading-relaxed text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!canSendMessage}
            aria-label="Send message"
            className={cn(
              "mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition-colors",
              canSendMessage ? "btn-light text-text-primary" : "text-text-disabled"
            )}
          >
            <SendHorizontal size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
