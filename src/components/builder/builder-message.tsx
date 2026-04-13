"use client";

import Link from "next/link";
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
  | { role: "ai"; type: "text"; content: string }
  | { role: "user"; type: "text"; content: string }
  | {
      role: "ai";
      type: "tool_activity";
      toolName: string;
      status: "calling" | "done";
      summary?: string;
    }
  | { role: "ai"; type: "entry_cards"; entries: EntryReference[] }
  | { role: "ai"; type: "streaming"; content: string };

export function BuilderMessageBubble({ message }: { message: BuilderMessage }) {
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

      {/* AI text — no bubble, markdown on the page */}
      {message.role === "ai" && message.type === "text" && (
        <MarkdownMessage content={message.content} />
      )}

      {/* AI streaming — no bubble, streaming markdown with cursor */}
      {message.role === "ai" && message.type === "streaming" && (
        <div className="relative">
          <MarkdownMessage content={message.content} />
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
                  ? "Searching knowledge base..."
                  : "Loading entry details..."}
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

      {/* AI entry references — inline glass cards */}
      {message.role === "ai" && message.type === "entry_cards" && (
        <div className="space-y-2">
          {message.entries.map((entry) => (
            <Link
              key={entry.entry_id}
              href={`/entries/${entry.entry_id}`}
              target="_blank"
              className="block group/card"
            >
              <div className="relative rounded-xl overflow-hidden backdrop-blur-[12px] backdrop-saturate-[1.4] bg-white/[0.05] border border-white/[0.1] hover:bg-white/[0.08] hover:border-white/[0.18] transition-all duration-200 py-3 px-4">
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 30%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.25) 70%, transparent 100%)",
                  }}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm text-white/90 truncate">
                      {entry.title || "Untitled"}
                    </h4>
                    <p className="text-xs text-white/50 mt-0.5 line-clamp-2 leading-relaxed">
                      {entry.summary || "No summary"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {entry.complexity && (
                      <span className="font-mono text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-[3px] bg-white/[0.04] border border-white/[0.1] text-white/60">
                        {entry.complexity}
                      </span>
                    )}
                    {entry.similarity !== undefined && (
                      <span className="font-mono text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-[3px] bg-white/[0.08] border border-white/[0.15] text-white/80">
                        {(entry.similarity * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
