"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/shared/lib/utils";
import { MarkdownMessage } from "@/components/design";
import { ArtifactsPanel } from "./artifacts-panel";

export interface ProgressEvent {
  type:
    | "info"
    | "step_start"
    | "step_complete"
    | "step_error"
    | "detail"
    | "complete"
    | "error";
  message: string;
  step?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

/**
 * EntryReference — shape used by the /api/chat streaming endpoint when
 * it surfaces entry search results as inline tool output. Mirrors the
 * builder-chat type so both chat flows share the same payload.
 */
export interface EntryReference {
  entry_id: string;
  title?: string;
  summary?: string;
  source_url?: string;
  complexity?: string;
}

/**
 * ChatAttachment — metadata for a file or image attached to a chat message.
 *
 * `base64` and `textContent` are ephemeral fields used only during the
 * current session to send content to the Anthropic API. They are NOT
 * persisted in conversation sync — only the metadata fields are stored.
 */
export interface ChatAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  url: string;
  base64?: string;
  textContent?: string;
}

/**
 * ChatMessage — unified message type used by ALL chat flows.
 *
 * The first four variants (text, user-text, progress, artifacts) are
 * used by the original URL-ingestion chat panel.
 *
 * The last three (streaming, tool_activity, entry_cards) are used by
 * the real conversational chat panel that talks to /api/chat. They're
 * added to the shared union so the reducer's APPEND_MESSAGE action
 * accepts them without any special-casing.
 *
 * The legacy ChatMessageBubble renderer below doesn't render the new
 * variants — the new chat panel ships its own renderer that does.
 */
export type ChatMessage =
  | { role: "ai"; type: "text"; content: string }
  | { role: "user"; type: "text"; content: string; attachments?: ChatAttachment[] }
  | {
      role: "ai";
      type: "progress";
      entryId: string;
      events: ProgressEvent[];
      status: "streaming" | "complete" | "error";
    }
  | {
      role: "ai";
      type: "artifacts";
      entryId: string;
      title: string;
      readme: string;
      agentsMd: string;
      manifest: Record<string, unknown>;
    }
  | { role: "ai"; type: "streaming"; content: string }
  | {
      role: "ai";
      type: "tool_activity";
      toolName: string;
      status: "calling" | "done";
      summary?: string;
    }
  | { role: "ai"; type: "entry_cards"; entries: EntryReference[] }
  | { role: "ai"; type: "onboarding_card"; cardType: "mcp_setup" | "chrome_extension" }
  | {
      role: "ai";
      type: "trial_expired";
      message: string;
    };

const eventTypeConfig: Record<
  ProgressEvent["type"],
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

function ProgressLog({
  events,
  status,
}: {
  events: ProgressEvent[];
  status: "streaming" | "complete" | "error";
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div
      ref={scrollRef}
      className="font-mono text-xs leading-relaxed max-h-[300px] overflow-y-auto bg-white/[0.04] border border-white/[0.08] rounded-lg p-3 space-y-0.5"
    >
      {events.map((event, i) => {
        const config = eventTypeConfig[event.type];
        const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        return (
          <div key={i} className={cn("flex gap-2", config.className)}>
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

export function ChatMessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div
      className={cn(
        "max-w-[90%] md:max-w-[80%]",
        message.role === "user" ? "ml-auto" : "mr-auto group"
      )}
    >
      {/* User text message — frosted glass bubble */}
      {message.role === "user" && (
        <div className="text-base leading-[24px] text-white/90 bg-white/[0.08] border border-white/[0.1] rounded py-2 px-4">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      )}

      {/* AI text message — no bubble, direct markdown */}
      {message.role === "ai" && message.type === "text" && (
        <MarkdownMessage content={message.content} />
      )}

      {/* AI progress log — kept as a subtle panel since it's a technical log */}
      {message.role === "ai" && message.type === "progress" && (
        <ProgressLog events={message.events} status={message.status} />
      )}

      {/* AI artifacts — rendered inline, no outer bubble */}
      {message.role === "ai" && message.type === "artifacts" && (
        <ArtifactsPanel
          entryId={message.entryId}
          title={message.title}
          readme={message.readme}
          agentsMd={message.agentsMd}
          manifest={message.manifest}
        />
      )}
    </div>
  );
}
