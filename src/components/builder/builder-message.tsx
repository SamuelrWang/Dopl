"use client";

import { cn } from "@/lib/utils";
import { MarkdownMessage } from "@/components/design";

export interface EntryReference {
  entry_id: string;
  title: string | null;
  summary: string | null;
  source_url?: string;
  complexity?: string | null;
  similarity?: number;
}

export type BuilderMessage =
  | { role: "ai"; type: "text"; content: string; citations?: Map<string, EntryReference> }
  | { role: "user"; type: "text"; content: string }
  | {
      role: "ai";
      type: "tool_activity";
      toolName: string;
      status: "calling" | "done";
      summary?: string;
    }
  | { role: "ai"; type: "streaming"; content: string };

/** Regex to match [cite:UUID] markers in text */
const CITE_REGEX = /\[cite:([a-f0-9-]+)\]/gi;

/**
 * Renders markdown content with citation markers replaced by clickable pills.
 * During streaming, markers show as raw text. On finalized messages, they
 * become interactive pills.
 */
function CitedMarkdown({
  content,
  citations,
  onCitationClick,
}: {
  content: string;
  citations?: Map<string, EntryReference>;
  onCitationClick?: (entry: EntryReference) => void;
}) {
  if (!citations || citations.size === 0) {
    // No citations — strip any [cite:...] markers and render plain markdown
    const cleaned = content.replace(CITE_REGEX, "");
    return <MarkdownMessage content={cleaned} />;
  }

  // Split content into text segments and citation markers
  const parts: Array<{ type: "text"; value: string } | { type: "cite"; entryId: string; index: number }> = [];
  let lastIndex = 0;
  let citeIndex = 0;
  const citeNumbers = new Map<string, number>();
  let match: RegExpExecArray | null;

  // Reset regex state
  CITE_REGEX.lastIndex = 0;
  while ((match = CITE_REGEX.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    const entryId = match[1];
    if (!citeNumbers.has(entryId)) {
      citeNumbers.set(entryId, ++citeIndex);
    }
    parts.push({ type: "cite", entryId, index: citeNumbers.get(entryId)! });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: "text", value: content.slice(lastIndex) });
  }

  return (
    <div className="relative">
      {parts.map((part, i) => {
        if (part.type === "text") {
          return <MarkdownMessage key={i} content={part.value} />;
        }
        const entry = citations.get(part.entryId);
        if (!entry) {
          // Unknown citation — skip
          return null;
        }
        return (
          <button
            key={i}
            onClick={() => onCitationClick?.(entry)}
            className="inline-flex items-center gap-0.5 mx-0.5 px-1.5 py-0.5 rounded-full bg-white/[0.08] border border-white/[0.12] text-white/60 text-[10px] font-mono hover:bg-white/[0.14] hover:text-white/80 hover:border-white/[0.2] transition-all duration-150 cursor-pointer align-baseline translate-y-[-1px]"
            title={entry.title || "Source"}
          >
            <span className="text-blue-400/80">{part.index}</span>
          </button>
        );
      })}
    </div>
  );
}

export function BuilderMessageBubble({
  message,
  onCitationClick,
}: {
  message: BuilderMessage;
  onCitationClick?: (entry: EntryReference) => void;
}) {
  return (
    <div
      className={cn(
        "max-w-[90%] md:max-w-[80%]",
        message.role === "user" ? "ml-auto" : "mr-auto group"
      )}
    >
      {/* User message — frosted glass bubble */}
      {message.role === "user" && (
        <div className="text-base leading-[24px] text-white/90 bg-white/[0.08] border border-white/[0.1] rounded py-2 px-4">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      )}

      {/* AI text — with citation pills */}
      {message.role === "ai" && message.type === "text" && (
        <CitedMarkdown
          content={message.content}
          citations={message.citations}
          onCitationClick={onCitationClick}
        />
      )}

      {/* AI streaming — no bubble, streaming markdown with cursor */}
      {message.role === "ai" && message.type === "streaming" && (
        <div className="relative">
          <MarkdownMessage content={message.content.replace(CITE_REGEX, "")} />
          <span
            className="inline-block w-1.5 h-4 bg-white/50 animate-pulse ml-0.5 align-text-bottom"
            aria-hidden
          />
        </div>
      )}

      {/* AI tool activity — compact inline status */}
      {message.role === "ai" && message.type === "tool_activity" && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08] font-mono text-[10px] uppercase tracking-wide text-white/50">
          {message.status === "calling" ? (
            <>
              <span
                className="inline-block w-1.5 h-1.5 rounded-none bg-blue-400 animate-pulse"
                aria-hidden
              />
              <span>
                {message.toolName === "search_knowledge_base"
                  ? "Researching..."
                  : "Diving deeper..."}
              </span>
            </>
          ) : (
            <>
              <span className="text-green-400">OK</span>
              <span className="normal-case tracking-normal text-white/60">
                {message.summary}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
