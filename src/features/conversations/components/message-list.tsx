"use client";

import { cn } from "@/shared/lib/utils";
import type { ConversationMessage } from "../types";

interface Props {
  messages: ConversationMessage[];
}

/**
 * The summarized transcript: each message is the agent's concise
 * summary; verbatim excerpts (user-requested) render as pressed-in
 * quote wells beneath their summary.
 */
export function MessageList({ messages }: Props) {
  return (
    <div className="divide-y divide-border-subtle">
      {messages.map((message) => (
        <article key={message.index} className="py-4">
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className={cn(
                "text-micro font-semibold uppercase tracking-wide",
                message.role === "user" ? "text-text-secondary" : "text-text-primary"
              )}
            >
              {message.role === "user" ? "You" : "Agent"}
            </span>
            <span className="text-micro text-text-muted">#{message.index}</span>
            {message.verbatim && (
              <span className="rounded-full border border-border-strong bg-bg-inset px-2 py-px text-micro font-medium text-text-secondary">
                verbatim
              </span>
            )}
          </div>
          <p className="text-lead leading-relaxed text-text-primary">
            {message.summary}
          </p>
          {message.verbatim && (
            <div className="concave-field mt-2.5 rounded-lg px-3.5 py-3">
              <p className="whitespace-pre-wrap text-body leading-relaxed text-text-primary">
                {message.verbatim}
              </p>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
