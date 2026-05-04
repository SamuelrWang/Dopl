"use client";

/**
 * ChatThread — main pane of the dedicated /[workspaceSlug]/chat page.
 * Owns one private conversation: messages, composer, scope picker,
 * artifact promotion. Distinct from the canvas chat panel (which lives
 * inside the canvas store).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, Paperclip } from "lucide-react";
import type { ChatMessage } from "@/features/ingestion/components/chat-message";
import { usePrivateChat } from "./use-private-chat";
import { PrivateMessageList } from "./private-rendered-message";
import {
  ClusterScopePicker,
  type ScopeFilters,
  type ScopeOption,
} from "./cluster-scope-picker";

interface ChatThreadProps {
  workspaceId: string;
  panelId: string;
  initialMessages: ChatMessage[];
  initialTitle: string;
  initialScopeFilters: ScopeFilters | null;
  clusters: ScopeOption[];
  knowledgeBases: ScopeOption[];
  skills: ScopeOption[];
  onFirstResponseSaved: (panelId: string) => void;
}

export function ChatThread({
  workspaceId,
  panelId,
  initialMessages,
  initialTitle,
  initialScopeFilters,
  clusters,
  knowledgeBases,
  skills,
  onFirstResponseSaved,
}: ChatThreadProps) {
  const {
    messages,
    isStreaming,
    title,
    setTitle,
    scopeFilters,
    setScopeFilters,
    send,
    promoteArtifact,
  } = usePrivateChat({
    workspaceId,
    panelId,
    initialMessages,
    initialTitle,
    initialScopeFilters,
    onFirstResponseSaved,
  });

  const [input, setInput] = useState("");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-resize composer.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  function startTitleEdit() {
    setTitleDraft(title);
    setTitleEditing(true);
  }

  const onPromoteArtifact = useCallback(
    async ({
      artifactId,
      title: artifactTitle,
      markdown,
    }: {
      artifactId: string;
      title: string;
      markdown: string;
    }) => {
      const newPanelId = await promoteArtifact({
        artifactId,
        title: artifactTitle,
        markdown,
        panelId,
      });
      return newPanelId;
    },
    [panelId, promoteArtifact]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    void send(text);
  }

  // Auto-name the chat from the first user message if it's still "New chat".
  useEffect(() => {
    if (title !== "New chat" && title !== "") return;
    const firstUser = messages.find(
      (m) => m.role === "user" && m.type === "text"
    );
    if (firstUser && firstUser.role === "user" && firstUser.type === "text") {
      const candidate = firstUser.content.trim().slice(0, 60);
      if (candidate.length > 0) setTitle(candidate);
    }
  }, [messages, title, setTitle]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06]">
        {titleEditing ? (
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              const next = titleDraft.trim();
              if (next && next !== title) setTitle(next);
              setTitleEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setTitleEditing(false);
              }
            }}
            autoFocus
            className="flex-1 bg-transparent outline-none text-[13px] font-medium text-text-primary border-b border-white/[0.15]"
          />
        ) : (
          <button
            type="button"
            onClick={startTitleEdit}
            className="flex-1 text-left text-[13px] font-medium text-text-primary truncate cursor-text"
          >
            {title}
          </button>
        )}
        <ClusterScopePicker
          clusters={clusters}
          knowledgeBases={knowledgeBases}
          skills={skills}
          value={scopeFilters}
          onChange={setScopeFilters}
        />
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-8 py-6"
      >
        {messages.length === 0 ? (
          <div className="text-center py-16 text-text-secondary/60 text-[13px]">
            <p>Private chat — visible only to you.</p>
            <p className="mt-1 text-[11.5px] text-text-secondary/40">
              I can read your workspace data and synthesize plans. I don&apos;t
              execute actions — I&apos;ll draft prompts your agent can run.
            </p>
          </div>
        ) : (
          <PrivateMessageList
            messages={messages}
            isStreaming={isStreaming}
            onPromoteArtifact={onPromoteArtifact}
          />
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 px-4 pb-4 pt-2">
        <div className="flex items-end gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2">
          <button
            type="button"
            disabled
            aria-label="Attachments not yet wired in private chat"
            title="Attachments coming soon to private chat."
            className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-text-secondary/40 cursor-not-allowed"
          >
            <Paperclip size={14} />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming
                ? "Thinking…"
                : "Ask about your workspace, or describe what you need…"
            }
            disabled={isStreaming}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder:text-text-secondary/50 outline-none py-1 max-h-40 disabled:opacity-50"
          />
          <button
            type="button"
            disabled
            aria-label="Voice input not yet wired in private chat"
            className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-text-secondary/40 cursor-not-allowed"
          >
            <Mic size={14} />
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={isStreaming || input.trim().length === 0}
            aria-label="Send"
            className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center bg-white text-black hover:bg-white/90 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

