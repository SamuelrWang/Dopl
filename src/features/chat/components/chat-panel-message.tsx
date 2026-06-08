"use client";

import { MarkdownMessage } from "@/shared/design";
import type { ChatMessage } from "@/shared/types/chat";
import { SentAttachmentPreview } from "./chat-attachments";

/**
 * Render one message from the shared `ChatMessage` union: user-text, AI
 * text, streaming, tool-activity badges, and the trial-expired notice.
 *
 * Display-only — all state is driven by the parent `ChatPanelBody`.
 */
export function RenderedMessage({
  message,
  entryNames,
}: {
  message: ChatMessage;
  entryNames?: Record<string, string>;
}) {
  // User text bubble — frosted glass, right-aligned.
  if (message.role === "user" && message.type === "text") {
    return (
      <div className="max-w-[90%] md:max-w-[80%] ml-auto">
        <div className="text-xs leading-[20px] text-white/90 bg-white/[0.08] border border-white/[0.1] rounded py-2 px-3">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
          {message.attachments && message.attachments.length > 0 && (
            <SentAttachmentPreview attachments={message.attachments} />
          )}
        </div>
      </div>
    );
  }

  // AI text — direct markdown, left-aligned.
  if (message.role === "ai" && message.type === "text") {
    return (
      <div className="max-w-[90%] md:max-w-[80%] mr-auto">
        <MarkdownMessage content={message.content} entryNames={entryNames} />
      </div>
    );
  }

  // Streaming AI text — same as text but with a cursor-ish indicator.
  if (message.role === "ai" && message.type === "streaming") {
    return (
      <div className="max-w-[90%] md:max-w-[80%] mr-auto">
        {message.content.length > 0 ? (
          <MarkdownMessage content={message.content + " ▍"} entryNames={entryNames} />
        ) : (
          <p className="text-xs text-white/40 italic font-mono uppercase tracking-wide animate-pulse">
            Thinking...
          </p>
        )}
      </div>
    );
  }

  // Tool activity badge — Claude running a workspace tool.
  if (message.role === "ai" && message.type === "tool_activity") {
    return (
      <div className="max-w-[90%] md:max-w-[80%] mr-auto">
        <div className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-white/50 bg-white/[0.04] border border-white/[0.08] rounded-[3px] px-2 h-6">
          <span
            className={
              message.status === "done"
                ? "text-[color:var(--mint)]"
                : "animate-pulse"
            }
          >
            {message.status === "done" ? "Done" : "..."}
          </span>
          <span>{message.toolName}</span>
          {message.summary && (
            <span className="text-white/30">— {message.summary}</span>
          )}
        </div>
      </div>
    );
  }

  // Trial expired — small inline notice. The root-level PaywallGate
  // shows the actual subscribe modal; this is just feedback in chat.
  if (message.role === "ai" && message.type === "trial_expired") {
    return (
      <div className="max-w-[95%] mr-auto rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
        {message.message}
      </div>
    );
  }

  return null;
}
