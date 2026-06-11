"use client";

/**
 * ChatPanelBody — real conversational chat inside a canvas chat panel.
 *
 * Behaviour:
 *   - Typed messages flow through /api/chat via `useChat`. Responses
 *     stream in token by token using the UPDATE_STREAMING_MESSAGE
 *     reducer action so only one streaming bubble is ever in flight.
 *   - When the panel lives inside a cluster, `useChat` automatically
 *     gathers sibling panels and includes them as `clusterContext`
 *     in every API call — see `cluster-context.ts`.
 *   - Users can attach files and images via the paperclip button, drag
 *     & drop, or paste from clipboard. Attachments are uploaded to
 *     Supabase Storage on send and included as multimodal content blocks
 *     for Anthropic vision/document support.
 *
 * Rendering is done by `<RenderedMessage>` that handles the shared
 * `ChatMessage` union: text, user-text, streaming, tool_activity.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatAttachment } from "@/shared/types/chat";
import type { ChatPanelData } from "@/features/canvas/types";
import { usePanelsContext } from "@/features/canvas/canvas-store";
import { useChat } from "./use-chat";
import { useChatName } from "./use-chat-name";
import {
  type PendingAttachment,
  validateFiles,
  fileToPending,
  revokePendingUrl,
  AttachButton,
  AttachmentPreviewStrip,
} from "./chat-attachments";
import { RenderedMessage } from "./chat-panel-message";
import { useSpeechRecognition } from "@/shared/hooks/use-speech-recognition";

interface ChatPanelBodyProps {
  panel: ChatPanelData;
}

export function ChatPanelBody({ panel }: ChatPanelBodyProps) {
  const { dispatch } = usePanelsContext();
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

  const isProcessing = chatStreaming || panel.isProcessing || isUploading;

  const entryNames = useMemo<Record<string, string>>(() => ({}), []);

  // Auto-scroll to bottom on new messages / streaming updates.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [panel.messages]);

  // Seed input consumption — when the FixedInputBar spawns this panel
  // with a typed message, fire a normal chat/ingest send as if the user
  // had typed it here. Clearing the pending input isn't enough on its
  // own: React StrictMode double-invokes mount effects before the
  // CLEAR_PENDING_INPUT dispatch commits, so both passes see the same
  // pending value. The ref-by-value guard below is what actually keeps
  // the send idempotent, and also covers the narrow production case
  // where the panel unmounts/remounts before the clear commits.
  const consumedInputRef = useRef<string | null>(null);
  useEffect(() => {
    const pending = panel.pendingInput;
    if (!pending) return;
    if (consumedInputRef.current === pending) return;
    consumedInputRef.current = pending;
    dispatch({ type: "CLEAR_PENDING_INPUT", panelId: panel.id });
    sendChat(pending);
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
      {/* Messages — scrollable region with drag & drop support */}
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto p-4 space-y-3 min-h-0 transition-colors duration-150 ${
          isDragOver
            ? "bg-surface-raised-2 ring-1 ring-inset ring-border-strong rounded-lg"
            : ""
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="flex items-center justify-center py-6">
            <span className="font-mono text-xs uppercase tracking-wider text-text-muted">
              Drop files to attach
            </span>
          </div>
        )}
        {!hasMessages && !isDragOver && (
          <p className="text-xs text-text-muted italic font-mono uppercase tracking-wide">
            Start a conversation. You can drop files.
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
        <div className="relative rounded-xl overflow-hidden bg-[var(--input-surface)] border border-border-default shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_var(--hairline-shine)] transition-colors duration-200 focus-within:bg-[var(--input-surface-focus)] focus-within:border-border-strong">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background: "var(--shine-top-gradient)",
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
                  : "Send a message or drop files..."
            }
            disabled={isProcessing}
            rows={1}
            className="w-full bg-transparent px-3 pt-3 pb-1.5 text-xs leading-[18px] text-text-primary outline-none resize-none placeholder:text-text-muted disabled:opacity-50 min-h-[36px] max-h-[120px]"
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
                      className="w-4 h-4 text-text-muted hover:text-text-secondary transition-colors"
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
                className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-text-primary border border-border-strong hover:border-border-highlight rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-surface-raised-2 hover:bg-surface-raised-4"
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

