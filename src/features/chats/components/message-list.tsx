"use client";

import { cn } from "@/shared/lib/utils";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
}

/**
 * The summarized transcript as chat-like boxes: user messages sit on
 * the subtle card surface and indent right; agent messages stay flat
 * white. Verbatim excerpts (user-requested) render as pressed-in quote
 * wells inside their box.
 */
export function MessageList({ messages }: Props) {
  return (
    <div className="flex flex-col gap-2.5">
      {messages.map((message) => (
        <article
          key={message.index}
          className={cn(
            "rounded-[10px] border px-3.5 py-2.5",
            message.role === "user"
              ? "ml-12 border-border-default bg-card-surface-subtle"
              : "border-border-subtle bg-bg-elevated"
          )}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-micro font-medium uppercase tracking-wide text-text-muted">
              {message.role === "user" ? "You" : "Agent"} · #{message.index}
            </span>
            {message.verbatim && (
              <span className="rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
                verbatim
              </span>
            )}
          </div>
          <p className="break-words text-body leading-relaxed text-text-primary">
            {message.summary}
          </p>
          {message.verbatim && (
            <div className="concave-field mt-2 rounded-lg px-3 py-2.5">
              <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-text-primary">
                {message.verbatim}
              </p>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
