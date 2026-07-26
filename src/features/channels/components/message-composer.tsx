"use client";

import { useState } from "react";
import { SendHorizontal } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface Props {
  /** Resolve when the send settles; a rejection keeps the text for retry. */
  onSend: (body: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Message composer pinned to the bottom of the thread — a concave-field
 * well holding an auto-submitting textarea (Enter sends, Shift+Enter adds
 * a newline) and a raised send button.
 */
export function MessageComposer({ onSend, disabled, placeholder }: Props) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  const canSend = value.trim().length > 0 && !sending && !disabled;

  async function send() {
    if (!canSend) return;
    const body = value.trim();
    setSending(true);
    try {
      await onSend(body);
      setValue("");
    } catch {
      // Keep the text so the user can retry — the caller surfaces the error.
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="shrink-0 px-14 pb-5 pt-2">
      <div className="mx-auto max-w-[760px]">
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
              canSend
                ? "btn-light text-text-primary"
                : "text-text-disabled"
            )}
          >
            <SendHorizontal size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
