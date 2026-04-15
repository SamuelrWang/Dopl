/**
 * ChatView — Tab-scoped AI chat with page context awareness.
 *
 * Features:
 *  - "Extract Page" pill in the input area for one-click page ingestion
 *  - Voice input via Web Speech API
 *  - Circular send button matching the main site design
 *  - Entry cards appear inline in chat after successful ingestion
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useTabChat } from "../hooks/useTabChat";
import { usePageContent } from "../hooks/usePageContent";
import { useBgMessage } from "../hooks/useBgMessage";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { ChatMessageBubble } from "../components/ChatMessage";
import { Send, Square, Trash2, Globe, Loader2 } from "lucide-react";
import type { ChatMessage, IngestResponse } from "@/shared/types";

interface ChatViewProps {
  onAddToCanvas?: (entryId: string) => void;
  onNavigateToIngest?: (url: string) => void;
}

export function ChatView({ onAddToCanvas, onNavigateToIngest }: ChatViewProps) {
  const { messages, isStreaming, sendMessage, cancel, clearChat } = useTabChat();
  const { page, loading: readingPage, extract } = usePageContent();
  const { send } = useBgMessage();
  const [input, setInput] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevFullTextRef = useRef("");

  const {
    isListening,
    fullText,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    clearTranscript,
    error: voiceError,
  } = useSpeechRecognition();

  // Live-sync voice transcript into textarea
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

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Get current tab info
  const getCurrentTab = useCallback(async () => {
    return new Promise<{ url?: string; title?: string }>((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => resolve(t || {}));
    });
  }, []);

  // ── Extract Page handler ────────────────────────────────────────────
  const handleExtractPage = useCallback(async () => {
    setExtracting(true);
    try {
      const tab = await getCurrentTab();
      const pageData = await extract();

      if (!pageData) {
        // Extraction failed entirely
        // Add a hint message to chat
        const hint: ChatMessage = {
          role: "ai",
          type: "text",
          content: "Couldn't extract content from this page. Try navigating to a specific article or post.",
        };
        // We need to use sendMessage indirectly — just add to messages via a workaround
        // Since we can't directly push to useTabChat, we'll send a system-like message
        // Actually, let's just ingest the URL directly as fallback
        if (tab.url) {
          await ingestUrl(tab.url);
        }
        return;
      }

      // Check extraction quality
      const isThin = pageData.wordCount < 50;
      const isGenericFeed =
        pageData.contentType === "generic" && pageData.wordCount < 100;
      const isXFeed =
        pageData.contentType === "tweet" &&
        (tab.url?.match(/^https?:\/\/(x|twitter)\.com\/[^/]+\/?$/) ||
          tab.url?.match(/^https?:\/\/(x|twitter)\.com\/home/));

      if (isThin || isGenericFeed || isXFeed) {
        // For X single tweets, just ingest the URL
        if (pageData.contentType === "tweet" && !isXFeed && tab.url) {
          await ingestUrl(tab.url);
          return;
        }
        // For thin/generic/feed pages, try URL-only ingest
        if (tab.url) {
          await ingestUrl(tab.url);
        }
        return;
      }

      // Good extraction — ingest with extracted text
      await ingestUrl(tab.url || pageData.url, pageData.content);
    } catch (err) {
      console.error("Extract page failed:", err);
    } finally {
      setExtracting(false);
    }
  }, [extract, getCurrentTab]);

  // ── Ingest URL and add to canvas ────────────────────────────────────
  const ingestUrl = useCallback(
    async (url: string, text?: string) => {
      try {
        const payload: { type: "INGEST_URL"; url: string; text?: string } = {
          type: "INGEST_URL",
          url,
        };
        if (text) payload.text = text;

        const result = await send<IngestResponse>(payload);

        if (result?.entry_id) {
          // Add to canvas
          if (onAddToCanvas) {
            onAddToCanvas(result.entry_id);
          }
          await send({ type: "ADD_CANVAS_PANEL", entryId: result.entry_id }).catch(() => {});

          setExtracted(true);
          // Reset extracted state after a few seconds
          setTimeout(() => setExtracted(false), 5000);
        }
      } catch (err) {
        console.error("Ingest failed:", err);
      }
    },
    [send, onAddToCanvas]
  );

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;

    if (isListening) {
      stopListening();
      clearTranscript();
      prevFullTextRef.current = "";
    }

    // Check if input is a bare URL — offer to ingest
    const urlPattern = /^https?:\/\/\S+$/;
    if (urlPattern.test(input.trim()) && onNavigateToIngest) {
      onNavigateToIngest(input.trim());
      setInput("");
      return;
    }

    sendMessage(input, page?.content);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = input.trim().length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="text-2xl mb-2 opacity-30">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-1">Tab-scoped AI chat</p>
            <p className="text-[10px] text-[var(--text-disabled)]">
              Click "Extract Page" to ingest the current page into your canvas.
              Or paste a URL to ingest it directly.
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessageBubble key={i} message={msg} onAddToCanvas={onAddToCanvas} />
        ))}
      </div>

      {/* Input area */}
      <div className="border-t border-[var(--border-default)] p-3">
        <div className="rounded-xl overflow-hidden bg-[var(--bg-elevated)] border border-[var(--border-default)] focus-within:border-[var(--accent-primary)] transition-colors">
          {/* Extract Page pill row */}
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
            <button
              onClick={handleExtractPage}
              disabled={extracting || readingPage}
              className={`inline-flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium rounded-full transition-all ${
                extracted
                  ? "bg-[var(--success)]/15 text-[var(--mint)] border border-[var(--success)]/30"
                  : extracting || readingPage
                    ? "bg-[var(--accent-soft)]/15 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20 opacity-70"
                    : "bg-[var(--accent-soft)]/15 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20 hover:bg-[var(--accent-primary)]/20 hover:border-[var(--accent-primary)]/40"
              }`}
            >
              {extracting || readingPage ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Globe size={12} />
              )}
              {extracted
                ? "Extracted"
                : extracting || readingPage
                  ? "Extracting..."
                  : "Extract Page"}
            </button>

            {/* Page context indicator */}
            {page && !extracted && (
              <span className="text-[10px] text-[var(--text-disabled)] truncate">
                {page.title}
              </span>
            )}
          </div>

          {/* Textarea */}
          <div className="px-3 pb-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your knowledge base..."
              rows={1}
              className="w-full bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)]
                resize-none focus:outline-none"
              style={{ minHeight: "36px", maxHeight: "120px" }}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
            />
          </div>

          {/* Bottom row: actions */}
          <div className="flex items-center justify-between px-3 pb-2.5">
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--coral)] hover:bg-[var(--danger)]/10 transition-colors"
                  title="Clear chat"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
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
                      className="w-4 h-4 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                      <line x1="8" y1="22" x2="16" y2="22" />
                    </svg>
                  )}
                </button>
              )}

              {/* Send / Cancel — circular */}
              {isStreaming ? (
                <button
                  onClick={cancel}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-[var(--danger)]/20 text-[var(--coral)] hover:bg-[var(--danger)]/30 transition-colors"
                  title="Stop"
                >
                  <Square size={12} />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!canSend}
                  aria-label="Send"
                  className="w-7 h-7 flex items-center justify-center rounded-full
                    text-[var(--text-muted)] hover:text-[var(--text-primary)]
                    border border-[var(--border-default)] hover:border-[var(--border-strong)]
                    bg-white/[0.04] hover:bg-white/[0.08]
                    transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
