import type { ChatMessage as ChatMsg } from "@/shared/types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { EntryCard } from "./EntryCard";
import { Check, Loader2 } from "lucide-react";

interface ChatMessageProps {
  message: ChatMsg;
  onAddToCanvas?: (entryId: string) => void;
}

export function ChatMessageBubble({ message, onAddToCanvas }: ChatMessageProps) {
  // User text — right-aligned pill, subtle bg tint, no heavy border.
  // Matches the main-site canvas chat visual language.
  if (message.role === "user" && message.type === "text") {
    return (
      <div className="ml-auto max-w-[80%] animate-fade-in">
        <div className="text-[13px] text-[var(--text-primary)] bg-white/[0.04] rounded-lg py-2 px-3 leading-relaxed">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  // AI text — full width unbubbled. Text flows like a document, matching
  // the canvas chat.
  if (message.role === "ai" && message.type === "text") {
    return (
      <div className="w-full text-[13px] leading-relaxed animate-fade-in">
        <MarkdownRenderer content={message.content} />
      </div>
    );
  }

  // AI streaming — same unbubbled layout + blinking caret.
  if (message.role === "ai" && message.type === "streaming") {
    return (
      <div className="w-full text-[13px] leading-relaxed">
        <MarkdownRenderer content={message.content} />
        <span className="inline-block w-1.5 h-4 bg-[var(--accent-primary)] animate-pulse ml-0.5 align-middle" />
      </div>
    );
  }

  // Tool activity
  if (message.role === "ai" && message.type === "tool_activity") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] py-1 animate-fade-in">
        {message.status === "calling" ? (
          <Loader2 size={12} className="animate-spin text-[var(--accent-primary)]" />
        ) : (
          <Check size={12} className="text-[var(--success)]" />
        )}
        <span className="font-mono">
          {message.toolName}
          {message.status === "calling" ? "…" : ""}
        </span>
        {message.summary && (
          <span className="text-[var(--text-muted)] truncate max-w-[200px]">
            {message.summary}
          </span>
        )}
      </div>
    );
  }

  // Entry cards
  if (message.role === "ai" && message.type === "entry_cards") {
    return (
      <div className="w-full space-y-2 animate-fade-in">
        {message.entries.map((entry) => (
          <EntryCard
            key={entry.entry_id}
            entryId={entry.entry_id}
            title={entry.title || "Untitled"}
            summary={entry.summary}
            sourceUrl={entry.source_url}
            complexity={entry.complexity}
            onAddToCanvas={onAddToCanvas}
          />
        ))}
      </div>
    );
  }

  return null;
}
