"use client";

/**
 * ChatPanelBody — real conversational chat inside a canvas chat panel.
 *
 * Behaviour:
 *   - Normal typed messages flow through /api/chat via `useChat`.
 *     Responses stream in token by token using the UPDATE_STREAMING_MESSAGE
 *     reducer action so only one streaming bubble is ever in flight.
 *   - If the user types a bare URL (and nothing else), we shortcut to
 *     the existing ingestion flow via `usePanelIngestion`. This keeps the
 *     "paste a link to ingest" UX the user asked to preserve.
 *   - When the panel lives inside a cluster, `useChat` automatically
 *     gathers sibling EntryPanels and includes them as `clusterContext`
 *     in every API call — see `cluster-context.ts`.
 *
 * Rendering is done by a local `<RenderedMessage>` that handles the
 * full shared `ChatMessage` union: text, user-text, streaming, progress,
 * artifacts, tool_activity, and entry_cards.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MarkdownMessage } from "@/components/design";
import { ArtifactsPanel } from "@/components/ingest/artifacts-panel";
import type { ChatMessage } from "@/components/ingest/chat-message";
import type { ChatPanelData } from "../../types";
import { useCanvas } from "../../canvas-store";
import { usePanelIngestion } from "../../use-panel-ingestion";
import { useChat } from "./use-chat";
import { isUrlOnlyMessage, extractUrl } from "./url-detection";
import { findEnclosingClusterName } from "./cluster-context";
import { useChatName } from "./use-chat-name";

interface ChatPanelBodyProps {
  panel: ChatPanelData;
}

export function ChatPanelBody({ panel }: ChatPanelBodyProps) {
  const { state, dispatch } = useCanvas();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Chat + ingestion hooks — we pick which one to use per message based
  // on URL detection.
  const { send: sendChat, isStreaming: chatStreaming } = useChat({ panel });
  const { startIngestion } = usePanelIngestion(panel);

  // Auto-generate a topic name for the chat after the first AI response.
  useChatName(panel);

  // Current cluster name (for the "in cluster: X" badge at the top).
  const clusterName = findEnclosingClusterName(panel.id, state);

  const isProcessing = chatStreaming || panel.isProcessing;

  // Auto-scroll to bottom on new messages / streaming updates.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [panel.messages]);

  // Seed input consumption — when the FixedInputBar spawns this panel
  // with a typed message, fire a normal chat/ingest send as if the user
  // had typed it here. Clear the pending input BEFORE calling send so a
  // StrictMode double-invoke can't double-fire the request.
  useEffect(() => {
    const pending = panel.pendingInput;
    if (!pending) return;
    dispatch({ type: "CLEAR_PENDING_INPUT", panelId: panel.id });
    if (isUrlOnlyMessage(pending)) {
      startIngestion(extractUrl(pending));
    } else {
      sendChat(pending);
    }
    // sendChat / startIngestion refs are stable via useCallback, so
    // depending on panel.pendingInput alone is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.pendingInput]);

  // Auto-resize the textarea as the user types.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  function handleSend() {
    const text = input.trim();
    if (!text || isProcessing) return;
    setInput("");
    if (isUrlOnlyMessage(text)) {
      // URL-only shortcut → kick off ingestion (same path as the old
      // chat panel). Progress and artifacts flow into the chat log.
      startIngestion(extractUrl(text));
    } else {
      sendChat(text);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend = !isProcessing && input.trim().length > 0;
  const hasMessages = panel.messages.length > 0;

  return (
    <>
      {/* Cluster badge — small indicator at the top of the message area
          showing which cluster this chat is loaded into, if any. */}
      {clusterName && (
        <div
          data-no-drag
          className="shrink-0 px-4 pt-3 pb-0 flex items-center gap-1.5"
        >
          <span className="font-mono text-[9px] uppercase tracking-wider text-white/40">
            In cluster:
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-white/70">
            {clusterName}
          </span>
        </div>
      )}

      {/* Messages — scrollable region. Empty padding between messages is
          draggable (inherits grab cursor); text inside bubbles has its
          own cursor and blocks drag via globals.css. */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
      >
        {!hasMessages && (
          <p className="text-xs text-white/30 italic font-mono uppercase tracking-wide">
            {clusterName
              ? "Ask a question about this cluster. You can also paste a URL to ingest."
              : "Start a conversation. You can also paste a URL to ingest a post."}
          </p>
        )}
        {panel.messages.map((msg, i) => (
          <RenderedMessage key={i} message={msg} />
        ))}
      </div>

      {/* Input bar */}
      <div data-no-drag className="shrink-0 p-3">
        <div className="relative rounded-xl overflow-hidden backdrop-blur-[12px] backdrop-saturate-[1.4] bg-black/[0.35] border border-white/[0.1] shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors duration-200 focus-within:bg-black/[0.4] focus-within:border-white/[0.18]">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 30%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.25) 70%, transparent 100%)",
            }}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() =>
              dispatch({ type: "SET_SELECTION", panelIds: [panel.id] })
            }
            placeholder={
              isProcessing
                ? "Thinking..."
                : clusterName
                  ? `Message in ${clusterName}...`
                  : "Send a message or paste a URL..."
            }
            disabled={isProcessing}
            rows={1}
            className="w-full bg-transparent px-3 pt-3 pb-1.5 text-sm leading-[20px] text-white/90 outline-none resize-none placeholder:text-white/30 disabled:opacity-50 min-h-[40px] max-h-[140px]"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="font-mono text-[9px] uppercase tracking-wide text-white/30">
              {isProcessing ? "Streaming" : "Enter to send"}
            </span>
            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label={isProcessing ? "Processing" : "Send"}
              className="w-6 h-6 flex items-center justify-center text-white/50 hover:text-white/90 border border-white/[0.12] hover:border-white/[0.22] rounded-[3px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white/[0.04] hover:bg-white/[0.08]"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M7 11V3" />
                <path d="M3 7l4-4 4 4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Message renderer ───────────────────────────────────────────────

function RenderedMessage({ message }: { message: ChatMessage }) {
  // User text bubble — frosted glass, right-aligned.
  if (message.role === "user" && message.type === "text") {
    return (
      <div className="max-w-[90%] md:max-w-[80%] ml-auto">
        <div className="text-sm leading-[22px] text-white/90 bg-white/[0.08] border border-white/[0.1] rounded py-2 px-3">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  // AI text — direct markdown, left-aligned.
  if (message.role === "ai" && message.type === "text") {
    return (
      <div className="max-w-[90%] md:max-w-[80%] mr-auto">
        <MarkdownMessage content={message.content} />
      </div>
    );
  }

  // Streaming AI text — same as text but with a cursor-ish indicator.
  if (message.role === "ai" && message.type === "streaming") {
    return (
      <div className="max-w-[90%] md:max-w-[80%] mr-auto">
        {message.content.length > 0 ? (
          <MarkdownMessage content={message.content + " ▍"} />
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

// ── Inline progress log ────────────────────────────────────────────

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
  events: import("@/components/ingest/chat-message").ProgressEvent[];
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
