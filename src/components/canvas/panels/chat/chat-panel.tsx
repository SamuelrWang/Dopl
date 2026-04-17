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
 *   - Users can attach files and images via the paperclip button, drag
 *     & drop, or paste from clipboard. Attachments are uploaded to
 *     Supabase Storage on send and included as multimodal content blocks
 *     for Anthropic vision/document support.
 *
 * Rendering is done by a local `<RenderedMessage>` that handles the
 * full shared `ChatMessage` union: text, user-text, streaming, progress,
 * artifacts, tool_activity, and entry_cards.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Check } from "lucide-react";
import { MarkdownMessage } from "@/components/design";
import { ArtifactsPanel } from "@/components/ingest/artifacts-panel";
import type { ChatMessage, ChatAttachment } from "@/components/ingest/chat-message";
import type { ChatPanelData } from "../../types";
import { usePanelsContext } from "../../canvas-store";
import { useChat } from "./use-chat";
import { useChatName } from "./use-chat-name";
import {
  type PendingAttachment,
  validateFiles,
  fileToPending,
  revokePendingUrl,
  AttachButton,
  AttachmentPreviewStrip,
  SentAttachmentPreview,
} from "./chat-attachments";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";

interface ChatPanelBodyProps {
  panel: ChatPanelData;
}

export function ChatPanelBody({ panel }: ChatPanelBodyProps) {
  const { panels, clusters, dispatch } = usePanelsContext();
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragCounter = useRef(0);

  const { send: sendChat, isStreaming: chatStreaming } = useChat({ panel });

  // Voice input
  const {
    isListening,
    fullText,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    clearTranscript,
    error: voiceError,
  } = useSpeechRecognition();
  const prevFullTextRef = useRef("");

  // Live-sync voice transcript into the textarea
  useEffect(() => {
    if (isListening && fullText !== prevFullTextRef.current) {
      prevFullTextRef.current = fullText;
      setInput(fullText);
    }
  }, [isListening, fullText]);

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening();
      prevFullTextRef.current = "";
    } else {
      clearTranscript();
      prevFullTextRef.current = "";
      startListening();
    }
  }, [isListening, stopListening, clearTranscript, startListening]);

  // Auto-generate a topic name for the chat after the first AI response.
  useChatName(panel);

  // Current cluster name (for the "in cluster: X" badge at the top).
  const clusterName = useMemo(() => {
    const cluster = clusters.find((c) => c.panelIds.includes(panel.id));
    return cluster?.name ?? null;
  }, [clusters, panel.id]);

  const isProcessing = chatStreaming || panel.isProcessing || isUploading;

  // Build entry name lookup for citation pills
  const entryNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of panels) {
      if (p.type === "entry") {
        map[p.entryId] = p.title;
      }
    }
    return map;
  }, [panels]);

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
    sendChat(pending);
    // sendChat ref is stable via useCallback, so
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

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      pendingAttachments.forEach(revokePendingUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss attachment error after 4 seconds
  useEffect(() => {
    if (!attachError) return;
    const timer = setTimeout(() => setAttachError(null), 4000);
    return () => clearTimeout(timer);
  }, [attachError]);

  // ── File handling ──────────────────────────────────────────────────

  const addFiles = useCallback(
    (files: File[]) => {
      const { valid, error } = validateFiles(files, pendingAttachments.length);
      if (error) {
        setAttachError(error);
        return;
      }
      setAttachError(null);
      setPendingAttachments((prev) => [
        ...prev,
        ...valid.map(fileToPending),
      ]);
    },
    [pendingAttachments.length]
  );

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => {
      const item = prev.find((a) => a.id === id);
      if (item) revokePendingUrl(item);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // ── Upload + send ──────────────────────────────────────────────────

  async function uploadAttachments(): Promise<ChatAttachment[] | null> {
    if (pendingAttachments.length === 0) return [];

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("panel_id", panel.id);
      for (const a of pendingAttachments) {
        formData.append("files", a.file);
      }

      const res = await fetch("/api/chat/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAttachError(err.error || `Upload failed (${res.status})`);
        return null;
      }

      const { attachments } = await res.json();
      return attachments as ChatAttachment[];
    } catch (err) {
      setAttachError(
        `Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      return null;
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if ((!text && !hasAttachments) || isProcessing) return;

    if (isListening) {
      stopListening();
      clearTranscript();
      prevFullTextRef.current = "";
    }

    // Upload attachments first if any
    let uploadedAttachments: ChatAttachment[] | undefined;
    if (hasAttachments) {
      const result = await uploadAttachments();
      if (!result) return; // upload failed, error already shown
      uploadedAttachments = result.length > 0 ? result : undefined;
      // Clear pending attachments
      pendingAttachments.forEach(revokePendingUrl);
      setPendingAttachments([]);
    }

    setInput("");
    sendChat(text || " ", uploadedAttachments);
  }

  // ── Event handlers ─────────────────────────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      addFiles(files);
    }
  }

  const canSend =
    !isProcessing &&
    (input.trim().length > 0 || pendingAttachments.length > 0);
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

      {/* Messages — scrollable region with drag & drop support */}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto p-4 space-y-3 min-h-0 transition-colors duration-150 ${
          isDragOver
            ? "bg-white/[0.04] ring-1 ring-inset ring-white/[0.15] rounded-lg"
            : ""
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="flex items-center justify-center py-6">
            <span className="font-mono text-xs uppercase tracking-wider text-white/40">
              Drop files to attach
            </span>
          </div>
        )}
        {!hasMessages && !isDragOver && (
          <p className="text-xs text-white/30 italic font-mono uppercase tracking-wide">
            {clusterName
              ? "Ask a question about this cluster. You can also paste a URL to ingest."
              : "Start a conversation. You can also paste a URL or drop files."}
          </p>
        )}
        {panel.messages.map((msg, i) => (
          <RenderedMessage key={i} message={msg} entryNames={entryNames} />
        ))}
      </div>

      {/* Attachment error toast */}
      {attachError && (
        <div
          data-no-drag
          className="shrink-0 mx-3 mb-1 px-3 py-1.5 rounded-[4px] bg-red-500/20 border border-red-500/30 text-red-300 text-[11px] font-mono"
        >
          {attachError}
        </div>
      )}

      {/* Input bar */}
      <div data-no-drag className="shrink-0 p-3">
        <div className="relative rounded-xl overflow-hidden bg-[var(--input-surface)] border border-white/[0.1] shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors duration-200 focus-within:bg-[var(--input-surface-focus)] focus-within:border-white/[0.18]">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 30%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.25) 70%, transparent 100%)",
            }}
          />
          {/* Pending attachment previews */}
          <AttachmentPreviewStrip
            attachments={pendingAttachments}
            onRemove={removeAttachment}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() =>
              dispatch({ type: "SET_SELECTION", panelIds: [panel.id] })
            }
            placeholder={
              isUploading
                ? "Uploading..."
                : isProcessing
                  ? "Thinking..."
                  : clusterName
                    ? `Message in ${clusterName}...`
                    : "Send a message, paste a URL, or drop files..."
            }
            disabled={isProcessing}
            rows={1}
            className="w-full bg-transparent px-3 pt-3 pb-1.5 text-xs leading-[18px] text-white/90 outline-none resize-none placeholder:text-white/30 disabled:opacity-50 min-h-[36px] max-h-[120px]"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <AttachButton onFiles={addFiles} disabled={isProcessing} />
            <div className="flex items-center gap-2">
              {/* Voice input */}
              {voiceSupported && (
                <button
                  type="button"
                  onClick={handleVoiceToggle}
                  aria-label={isListening ? "Stop recording" : "Start voice input"}
                  title={
                    voiceError
                      ? voiceError
                      : isListening
                      ? "Recording... click to stop"
                      : "Voice input"
                  }
                  className="flex items-center justify-center w-7 h-7 transition-colors"
                >
                  {isListening ? (
                    <span className="flex items-end gap-[2px] h-4">
                      {[1, 2, 3, 4, 3].map((h, i) => (
                        <span
                          key={i}
                          className="w-[2px] rounded-full bg-red-400"
                          style={{
                            height: `${h * 3}px`,
                            animation: `voiceBar 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
                          }}
                        />
                      ))}
                    </span>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-4 h-4 text-white/40 hover:text-white/70 transition-colors"
                    >
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                      <line x1="8" y1="22" x2="16" y2="22" />
                    </svg>
                  )}
                </button>
              )}
              {/* Send — circular */}
              <button
                onClick={handleSend}
                disabled={!canSend}
                aria-label={isProcessing ? "Processing" : "Send"}
                className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white/90 border border-white/[0.12] hover:border-white/[0.22] rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white/[0.04] hover:bg-white/[0.08]"
              >
                <svg
                  width="14"
                  height="14"
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
      </div>
      {isListening && (
        <style>{`
          @keyframes voiceBar {
            from { transform: scaleY(0.5); }
            to   { transform: scaleY(1.5); }
          }
        `}</style>
      )}
    </>
  );
}

// ── Message renderer ───────────────────────────────────────────────

function RenderedMessage({ message, entryNames }: { message: ChatMessage; entryNames?: Record<string, string> }) {
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

// ── Onboarding cards ──────────────────────────────────────────────

function McpSetupCard() {
  const [tab, setTab] = useState<"claude" | "cursor" | "other">("claude");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/user/keys")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const active = (data.keys || []).filter(
          (k: { revoked_at: string | null }) => !k.revoked_at
        );
        if (active.length > 0) return; // key exists, generate new
        return fetch("/api/user/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Onboarding MCP" }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && setApiKey(d.key));
      })
      .catch(() => {});

    // Also try to generate if no keys found
    fetch("/api/user/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Onboarding MCP" }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setApiKey(d.key))
      .catch(() => {});
  }, []);

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const keyPlaceholder = apiKey || "YOUR_API_KEY";

  const cliCommand =
    tab === "claude"
      ? `claude mcp add dopl --scope user --transport stdio -- npx @dopl/mcp-server --api-key ${keyPlaceholder}`
      : tab === "cursor"
        ? `npx @dopl/mcp-server --api-key ${keyPlaceholder}`
        : `npx @dopl/mcp-server --api-key ${keyPlaceholder}`;

  const jsonConfig =
    tab === "claude"
      ? JSON.stringify({ mcpServers: { dopl: { command: "npx", args: ["@dopl/mcp-server", "--api-key", keyPlaceholder] } } }, null, 2)
      : tab === "cursor"
        ? JSON.stringify({ mcpServers: { dopl: { command: "npx", args: ["@dopl/mcp-server", "--api-key", keyPlaceholder] } } }, null, 2)
        : JSON.stringify({ dopl: { command: "npx", args: ["@dopl/mcp-server", "--api-key", keyPlaceholder] } }, null, 2);

  const tabs: { id: "claude" | "cursor" | "other"; label: string }[] = [
    { id: "claude", label: "Claude Code" },
    { id: "cursor", label: "Cursor" },
    { id: "other", label: "Other" },
  ];

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/[0.04] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-purple-500/10">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400/70">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <span className="font-mono text-[10px] uppercase tracking-wider text-purple-300/70">MCP Connection</span>
      </div>
      <div className="px-3 pt-2 flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-2 py-1 font-mono text-[9px] uppercase tracking-wide rounded-[3px] transition-colors ${
              tab === t.id
                ? "bg-purple-500/15 text-purple-200/90 border border-purple-500/25"
                : "text-white/40 hover:text-white/60 border border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-3 space-y-2">
        {tab === "claude" && (
          <div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-white/30 mb-1">CLI command</div>
            <div className="relative group">
              <pre className="text-[10px] font-mono text-white/60 bg-black/20 rounded p-2 pr-8 overflow-x-auto whitespace-pre-wrap break-all">{cliCommand}</pre>
              <button onClick={() => copy(cliCommand, "cli")} className="absolute top-1.5 right-1.5 text-white/20 hover:text-white/60 transition-colors">
                {copied === "cli" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
        )}
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-white/30 mb-1">
            {tab === "claude" ? "Or add to config JSON" : "MCP Config"}
          </div>
          <div className="relative group">
            <pre className="text-[10px] font-mono text-white/60 bg-black/20 rounded p-2 pr-8 overflow-x-auto whitespace-pre-wrap break-all">{jsonConfig}</pre>
            <button onClick={() => copy(jsonConfig, "json")} className="absolute top-1.5 right-1.5 text-white/20 hover:text-white/60 transition-colors">
              {copied === "json" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>
        {!apiKey && (
          <div className="font-mono text-[9px] text-white/25">Loading your API key...</div>
        )}
      </div>
    </div>
  );
}

function ChromeExtensionCard() {
  return (
    <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.04] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-blue-500/10">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400/70">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
          <line x1="21.17" y1="8" x2="12" y2="8" />
          <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
          <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
        </svg>
        <span className="font-mono text-[10px] uppercase tracking-wider text-blue-300/70">Chrome Extension</span>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-[11px] text-white/60 leading-relaxed">
          Ingest pages as you browse — right-click to send to your knowledge base. Great for paywalled or login-gated content. Only extracts when you tell it to.
        </p>
        <div className="flex items-center gap-2">
          <a
            href="/downloads/dopl-extension.zip"
            download="dopl-extension.zip"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-blue-200/90 bg-blue-500/15 border border-blue-500/25 rounded-[3px] hover:bg-blue-500/25 transition-colors"
          >
            Download Extension
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7L7 3" /><path d="M4 3H7V6" /></svg>
          </a>
        </div>
        <div className="font-mono text-[9px] text-white/25 leading-relaxed">
          Unzip the download, open chrome://extensions, enable Developer mode, click "Load unpacked", and select the unzipped folder. Then click the Dopl icon in your toolbar and enter your API key to connect.
        </div>
      </div>
    </div>
  );
}

function InsufficientCreditsCard({ balance, cost }: { balance: number; cost: number }) {
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-amber-500/10">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-amber-400/80"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span className="font-mono text-[10px] uppercase tracking-wider text-amber-300/80">
          Out of credits
        </span>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-[11px] text-white/75 leading-relaxed">
          You have <span className="font-mono text-amber-300/80">{balance}</span>{" "}
          credits left, but this action needs{" "}
          <span className="font-mono text-amber-300/80">{cost}</span>. Upgrade
          for more credits, or come back tomorrow for your daily bonus.
        </p>
        <div className="flex items-center gap-2">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-amber-100/95 bg-amber-500/20 border border-amber-500/30 rounded-[3px] hover:bg-amber-500/30 transition-colors"
          >
            Upgrade
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 7L7 3" />
              <path d="M4 3H7V6" />
            </svg>
          </Link>
          <Link
            href="/settings/billing"
            className="inline-flex items-center px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-white/50 hover:text-white/80 transition-colors"
          >
            View balance
          </Link>
        </div>
      </div>
    </div>
  );
}
