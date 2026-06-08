"use client";

/**
 * ChatThread — main pane of the dedicated /[workspaceSlug]/chat page.
 * Owns one private conversation: messages, composer, scope picker,
 * artifact promotion. Distinct from the canvas chat panel (which lives
 * inside the canvas store).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Mic, Paperclip } from "lucide-react";
import type { ChatMessage } from "@/shared/types/chat";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
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
  const [user, setUser] = useState<User | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch the current user once on mount so the message list can
  // render the right-side avatar + name above each user bubble.
  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowser();
    supabase.auth
      .getUser()
      .then(({ data }: { data: { user: User | null } }) => {
        if (!cancelled) setUser(data.user);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Memoize so PrivateMessageList doesn't re-render on every keystroke
  // — the prop reference would otherwise change every render.
  const currentUser = useMemo(
    () =>
      user
        ? {
            userId: user.id,
            email: user.email ?? null,
            displayName:
              (user.user_metadata?.full_name as string | undefined) ||
              (user.user_metadata?.name as string | undefined) ||
              null,
            avatarUrl:
              (user.user_metadata?.avatar_url as string | undefined) ?? null,
          }
        : null,
    [user]
  );

  const canSend = !isStreaming && input.trim().length > 0;

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

      {/* Messages — full panel width. Agent content has its own
          inner max-width so AI text still wraps around halfway across
          the panel; user bubbles right-align within the panel. */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-10 py-6">
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
              currentUser={currentUser}
              onPromoteArtifact={onPromoteArtifact}
            />
          )}
        </div>
      </div>

      {/* Composer — same centered column as messages. */}
      <div className="shrink-0 px-6 pb-4 pt-2">
        <div className="max-w-3xl mx-auto">
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
            {/* Send — circular, mirrors the canvas chat panel. */}
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label={isStreaming ? "Processing" : "Send"}
              className="shrink-0 w-7 h-7 flex items-center justify-center text-white/50 hover:text-white/90 border border-white/[0.12] hover:border-white/[0.22] rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer"
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
  );
}
