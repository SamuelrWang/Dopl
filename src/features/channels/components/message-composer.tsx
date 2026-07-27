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
}

/**
 * Message composer pinned to the bottom of the thread — a concave-field well
 * holding an auto-submitting textarea (Enter sends, Shift+Enter adds a
 * newline) and a raised send button. Above the well, an optional addressing
 * row targets one teammate's agent (`toUserId`) with a one-line intent
 * (`summary`), and warns when that agent is offline or was never set up.
 *
 * In a channel of three or more, an UNADDRESSED message triggers no agent at
 * all (the targeting rule only implies a recipient in a two-person channel),
 * so the composer says so rather than letting the message land silently.
 */
export function MessageComposer({
  onSend,
  disabled,
  placeholder,
  members,
  currentUserId,
}: Props) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [toUserId, setToUserId] = useState<string | null>(null);
  const [summary, setSummary] = useState("");

  const canSend = value.trim().length > 0 && !sending && !disabled;
  const target = useMemo(
    () => (toUserId ? members.find((m) => m.userId === toUserId) ?? null : null),
    [toUserId, members]
  );
  // Two members = the other one is the implicit target, so an unaddressed
  // message still reaches an agent. Three or more and it reaches none.
  const showUnaddressedHint = !toUserId && members.length >= 3;

  async function send() {
    if (!canSend) return;
    const body = value.trim();
    const opts: SendOptions | undefined = toUserId
      ? { toUserId, summary: summary.trim() || body.split("\n")[0].slice(0, 200) }
      : undefined;
    setSending(true);
    try {
      await onSend(body, opts);
      setValue("");
      setSummary("");
      setToUserId(null);
    } catch {
      // Keep the text so the user can retry — the caller surfaces the error.
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="shrink-0 px-14 pb-5 pt-2">
      <div className="mx-auto max-w-[760px]">
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

        {target && !target.agentOnline && (
          <div className="mb-2 flex items-center gap-1.5 text-caption text-text-muted">
            <WifiOff size={12} className="shrink-0" />
            {target.lastSeenAt === null
              ? "Their agent has never connected. Nothing picks this up until they set up the desktop app."
              : "Their agent is offline. This will run when it reconnects."}
          </div>
        )}

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
                void send();
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
            onClick={() => void send()}
            disabled={!canSend}
            aria-label="Send message"
            className={cn(
              "mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition-colors",
              canSend ? "btn-light text-text-primary" : "text-text-disabled"
            )}
          >
            <SendHorizontal size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
