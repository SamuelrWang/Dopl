/**
 * ChatView — Tab-scoped AI chat with page context awareness.
 * Ephemeral per-tab conversations that auto-delete when the tab closes.
 */

import { useState, useRef, useEffect } from "react";
import { useTabChat } from "../hooks/useTabChat";
import { usePageContent } from "../hooks/usePageContent";
import { ChatMessageBubble } from "../components/ChatMessage";
import { QuickActions } from "../components/QuickActions";
import { Send, Square, Trash2, FileText } from "lucide-react";

interface ChatViewProps {
  onAddToCanvas?: (entryId: string) => void;
  onNavigateToIngest?: (url: string) => void;
}

export function ChatView({ onAddToCanvas, onNavigateToIngest }: ChatViewProps) {
  const { messages, isStreaming, sendMessage, cancel, clearChat } = useTabChat();
  const { page, loading: readingPage, extract } = usePageContent();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;

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

  const handleReadPage = async () => {
    const extracted = await extract();
    if (extracted) {
      // Optionally auto-add a system message noting the page context
      // This happens implicitly via canvasContext in the sendMessage call
    }
  };

  const handleIngestPage = async () => {
    // Get current tab URL
    const tab = await new Promise<{ url?: string }>((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => resolve(t || {}));
    });
    if (tab.url && onNavigateToIngest) {
      onNavigateToIngest(tab.url);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Quick actions bar */}
      <QuickActions
        onReadPage={handleReadPage}
        onIngestPage={handleIngestPage}
        readingPage={readingPage}
        pageRead={!!page}
      />

      {/* Page context indicator */}
      {page && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--accent-soft)]/10 border-b border-[var(--border-subtle)]">
          <FileText size={12} className="text-[var(--accent-primary)] shrink-0" />
          <span className="text-[10px] text-[var(--accent-primary)] truncate">
            Page context: {page.title} ({page.wordCount} words)
          </span>
        </div>
      )}

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
              Click "Read Page" to give the AI context about what you're viewing.
              Paste a URL to ingest it into your knowledge base.
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessageBubble key={i} message={msg} onAddToCanvas={onAddToCanvas} />
        ))}
      </div>

      {/* Input area */}
      <div className="border-t border-[var(--border-default)] p-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your knowledge base..."
              rows={1}
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg
                px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)]
                resize-none focus:outline-none focus:border-[var(--accent-primary)]
                glow-focus transition-all"
              style={{ minHeight: "36px", maxHeight: "120px" }}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
            />
          </div>
          <div className="flex items-center gap-1">
            {isStreaming ? (
              <button
                onClick={cancel}
                className="p-2 rounded-lg bg-[var(--danger)]/20 text-[var(--coral)] hover:bg-[var(--danger)]/30 transition-colors"
                title="Stop"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="p-2 rounded-lg bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]
                  hover:bg-[var(--accent-primary)]/30 transition-colors disabled:opacity-30"
                title="Send"
              >
                <Send size={14} />
              </button>
            )}
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--coral)] hover:bg-[var(--danger)]/10 transition-colors"
                title="Clear chat"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
