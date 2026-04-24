"use client";

import Link from "next/link";
import { MarkdownMessage } from "@/shared/design";
import { ArtifactsPanel } from "@/features/ingestion/components/artifacts-panel";
import type { ChatMessage } from "@/features/ingestion/components/chat-message";
import { SentAttachmentPreview } from "./chat-attachments";
import { McpSetupCard, ChromeExtensionCard } from "./chat-panel-cards";

/**
 * Render one message from the shared `ChatMessage` union. Handles the
 * full set of variants: user-text, AI text, streaming, progress events,
 * artifact cards, tool-activity badges, entry-card results, inline
 * onboarding cards, and the legacy URL-ingest progress/artifact flow.
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

  // Tool activity badge — Claude searching / loading an entry.
  if (message.role === "ai" && message.type === "tool_activity") {
    const label =
      message.toolName === "search_knowledge_base"
        ? "Searching knowledge base"
        : message.toolName === "get_entry_details"
          ? "Loading entry details"
          : message.toolName === "ingest_url"
            ? "Ingesting URL"
            : message.toolName;
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
          <span>{label}</span>
          {message.summary && (
            <span className="text-white/30">— {message.summary}</span>
          )}
        </div>
      </div>
    );
  }

  // Entry cards — inline search results from a tool_result.
  if (message.role === "ai" && message.type === "entry_cards") {
    return (
      <div className="max-w-[90%] md:max-w-[80%] mr-auto space-y-1.5">
        {message.entries.map((entry) => (
          <Link
            key={entry.entry_id}
            href={`/entries/${entry.entry_id}`}
            target="_blank"
            className="block p-2 rounded-[3px] bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.18] transition-colors"
          >
            <div className="font-medium text-xs text-white/90 truncate">
              {entry.title || "Untitled Setup"}
            </div>
            {entry.summary && (
              <div className="text-[11px] text-white/50 line-clamp-2 mt-0.5">
                {entry.summary}
              </div>
            )}
          </Link>
        ))}
      </div>
    );
  }

  // Onboarding cards — inline interactive cards for MCP setup, Chrome extension, etc.
  if (message.role === "ai" && message.type === "onboarding_card") {
    return (
      <div className="max-w-[95%] mr-auto">
        {message.cardType === "mcp_setup" && <McpSetupCard />}
        {message.cardType === "chrome_extension" && <ChromeExtensionCard />}
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

  // Legacy progress log from URL-ingestion shortcut.
  if (message.role === "ai" && message.type === "progress") {
    return <ProgressInline events={message.events} status={message.status} />;
  }

  // Legacy artifacts card from URL-ingestion shortcut.
  if (message.role === "ai" && message.type === "artifacts") {
    return (
      <ArtifactsPanel
        entryId={message.entryId}
        title={message.title}
        readme={message.readme}
        agentsMd={message.agentsMd}
        manifest={message.manifest}
      />
    );
  }

  return null;
}

const progressEventConfig: Record<
  string,
  { icon: string; className: string }
> = {
  info: { icon: "->", className: "text-white/50" },
  step_start: { icon: ">>", className: "text-blue-400 font-medium" },
  step_complete: { icon: "OK", className: "text-green-400 font-medium" },
  step_error: { icon: "!!", className: "text-red-400 font-medium" },
  detail: { icon: "  ", className: "text-white/50 pl-4" },
  complete: { icon: "**", className: "text-green-400 font-bold" },
  error: { icon: "!!", className: "text-red-400 font-bold" },
};

function ProgressInline({
  events,
  status,
}: {
  events: import("@/features/ingestion/components/chat-message").ProgressEvent[];
  status: "streaming" | "complete" | "error";
}) {
  return (
    <div className="font-mono text-[11px] leading-relaxed max-h-[240px] overflow-y-auto bg-white/[0.03] border border-white/[0.08] rounded-[3px] p-3 space-y-0.5">
      {events.map((event, i) => {
        const config = progressEventConfig[event.type] ?? progressEventConfig.info;
        const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        return (
          <div key={i} className={`flex gap-2 ${config.className}`}>
            <span className="text-white/40 shrink-0 w-[60px]">{time}</span>
            <span className="shrink-0 w-[20px] text-center">{config.icon}</span>
            <span className="break-all">{event.message}</span>
          </div>
        );
      })}
      {status === "streaming" && (
        <div className="flex gap-2 text-white/40 animate-pulse">
          <span className="shrink-0 w-[60px]" />
          <span className="shrink-0 w-[20px] text-center">..</span>
          <span>working...</span>
        </div>
      )}
    </div>
  );
}
