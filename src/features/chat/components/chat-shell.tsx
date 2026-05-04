"use client";

/**
 * ChatShell — top-level wrapper for the dedicated /[workspaceSlug]/chat
 * page. Holds:
 *
 *   - Conversations list (fetched + locally cached)
 *   - Workspace data for the scope picker (clusters / KBs / skills)
 *   - Selected conversation panel_id
 *
 * Passes the relevant slices down to ConversationsRail and the chat
 * thread component. Conversations are private to the calling user
 * (visibility='private' on the conversations row).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConversationsRail, type RailConversation } from "./conversations-rail";
import { ChatThread } from "./chat-thread";
import type {
  ScopeFilters,
  ScopeOption,
} from "./cluster-scope-picker";
import type { ChatMessage } from "@/features/ingestion/components/chat-message";

interface ChatShellProps {
  workspaceId: string;
}

interface ConversationApiRow {
  id: string;
  panel_id: string;
  title: string;
  messages: ChatMessage[];
  pinned: boolean;
  visibility: "workspace" | "private";
  scope_filters: ScopeFilters | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export function ChatShell({ workspaceId }: ChatShellProps) {
  const [conversations, setConversations] = useState<ConversationApiRow[]>([]);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [clusters, setClusters] = useState<ScopeOption[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<ScopeOption[]>([]);
  const [skills, setSkills] = useState<ScopeOption[]>([]);

  // Fetch conversations on mount.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations?visibility=private", {
        headers: { "X-Workspace-Id": workspaceId },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { conversations: ConversationApiRow[] };
      setConversations(json.conversations || []);
    } catch (err) {
      console.warn("failed to load private conversations", err);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Fetch workspace data for the scope picker — fire and forget.
  useEffect(() => {
    const headers = { "X-Workspace-Id": workspaceId };
    fetch("/api/clusters", { headers })
      .then((r) => (r.ok ? r.json() : { clusters: [] }))
      .then((json: { clusters?: Array<{ id?: string; slug?: string; name: string }> }) =>
        setClusters(
          (json.clusters || []).map((c) => ({
            id: c.id || c.slug || c.name,
            name: c.name,
          }))
        )
      )
      .catch(() => {});
    fetch("/api/knowledge/bases", { headers })
      .then((r) => (r.ok ? r.json() : { bases: [] }))
      .then((json: { bases?: Array<{ id: string; name: string }> }) =>
        setKnowledgeBases(
          (json.bases || []).map((b) => ({ id: b.id, name: b.name }))
        )
      )
      .catch(() => {});
    fetch("/api/skills", { headers })
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then((json: { skills?: Array<{ id: string; name: string }> }) =>
        setSkills(
          (json.skills || []).map((s) => ({ id: s.id, name: s.name }))
        )
      )
      .catch(() => {});
  }, [workspaceId]);

  const railConversations: RailConversation[] = useMemo(
    () =>
      conversations.map((c) => ({
        panelId: c.panel_id,
        title: c.title,
        preview: lastUserSnippet(c.messages),
        timestamp: relativeTime(c.updated_at),
      })),
    [conversations]
  );

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.panel_id === selectedPanelId) ?? null,
    [conversations, selectedPanelId]
  );

  const handleNew = useCallback(() => {
    const newPanelId = `priv-${cryptoRandomId()}`;
    setSelectedPanelId(newPanelId);
  }, []);

  const handleFirstResponseSaved = useCallback(
    async () => {
      await refresh();
    },
    [refresh]
  );

  return (
    <div className="fixed top-[52px] right-0 bottom-0 left-0 md:left-64 z-[3] p-3 pointer-events-auto">
      <div className="h-full rounded-2xl border border-white/[0.1] bg-[var(--panel-surface)] overflow-hidden flex">
        <aside className="w-56 shrink-0 flex flex-col border-r border-white/[0.08]">
          <ConversationsRail
            conversations={railConversations}
            activePanelId={selectedPanelId}
            isLoading={isLoading}
            onSelect={setSelectedPanelId}
            onNew={handleNew}
          />
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          {selectedPanelId ? (
            <ChatThread
              key={selectedPanelId}
              workspaceId={workspaceId}
              panelId={selectedPanelId}
              initialMessages={selectedConversation?.messages || []}
              initialTitle={selectedConversation?.title || "New chat"}
              initialScopeFilters={selectedConversation?.scope_filters ?? null}
              clusters={clusters}
              knowledgeBases={knowledgeBases}
              skills={skills}
              onFirstResponseSaved={handleFirstResponseSaved}
            />
          ) : (
            <EmptyState onNew={handleNew} />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-[13px] text-text-secondary/70">
          Private chat — visible only to you.
        </p>
        <button
          type="button"
          onClick={onNew}
          className="px-3 py-1.5 rounded-md text-[12px] text-text-primary border border-white/[0.1] hover:bg-white/[0.04] transition-colors"
        >
          Start a new chat
        </button>
      </div>
    </div>
  );
}

function lastUserSnippet(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && m.type === "text") {
      const s = m.content.trim();
      return s.length > 80 ? s.slice(0, 77) + "…" : s || "(empty)";
    }
  }
  return "No messages yet.";
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h`;
  return `${Math.round(diffSec / 86400)}d`;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
