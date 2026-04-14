"use client";

/**
 * use-conversation-sync.ts — Syncs chat panel conversations between the
 * client-side canvas (localStorage/reducer) and the server-side conversations
 * table in Supabase.
 *
 * Load-on-mount:
 *   - Fetch all conversations for the user
 *   - Hydrate matching local chat panels with server messages
 *   - Push local-only conversations to the server
 *
 * Save-on-change (debounced per panel):
 *   - Watch for chat panels whose messages or title changed
 *   - POST to /api/conversations with filtered text messages + pinned state
 */

import { useEffect, useRef } from "react";
import { useCanvas } from "./canvas-store";
import type { ChatPanelData } from "./types";
import { messagesToApiHistory } from "./panels/chat/chat-message-types";
import type { ChatMessage } from "@/components/ingest/chat-message";

interface ServerConversation {
  id: string;
  panel_id: string;
  title: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  pinned: boolean;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

const SAVE_DEBOUNCE_MS = 2000;

/** Snapshot key for tracking changes — includes message count, title, and pinned state. */
function panelSnapshotKey(panel: ChatPanelData): string {
  return `${panel.messages.length}|${panel.title}|${panel.pinned ?? false}`;
}

export function useConversationSync() {
  const { state, dispatch } = useCanvas();
  const syncedRef = useRef(false);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const prevSnapshotsRef = useRef<Map<string, string>>(new Map());

  // ── Load on mount (runs once) ─────────────────────────────────────
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;

    async function loadConversations() {
      try {
        const res = await fetch("/api/conversations");
        if (!res.ok) return;

        const { conversations }: { conversations: ServerConversation[] } =
          await res.json();

        const localChatPanels = state.panels.filter(
          (p): p is ChatPanelData => p.type === "chat"
        );
        const localPanelIds = new Set(localChatPanels.map((p) => p.id));
        const serverPanelIds = new Set(conversations.map((c) => c.panel_id));

        // Server conversations with matching local panels → hydrate
        for (const conv of conversations) {
          if (localPanelIds.has(conv.panel_id)) {
            const messages: ChatMessage[] = conv.messages.map((m) => ({
              role: m.role === "user" ? "user" : "ai",
              type: "text" as const,
              content: m.content,
            }));

            if (messages.length > 0) {
              dispatch({
                type: "HYDRATE_CHAT_MESSAGES",
                panelId: conv.panel_id,
                messages,
                conversationId: conv.id,
              });
            }

            // Hydrate pinned and expiresAt
            dispatch({
              type: "SET_CHAT_PINNED",
              panelId: conv.panel_id,
              pinned: conv.pinned,
            });

            // Update title if server has a non-placeholder name
            if (conv.title && !/^Chat\s*#\d+$/i.test(conv.title)) {
              dispatch({
                type: "UPDATE_CHAT_TITLE",
                panelId: conv.panel_id,
                title: conv.title,
              });
            }
          }
        }

        // Local chat panels with messages not on server → push
        for (const panel of localChatPanels) {
          if (!serverPanelIds.has(panel.id) && panel.messages.length > 0) {
            const apiMessages = messagesToApiHistory(panel.messages);
            if (apiMessages.length > 0) {
              fetch("/api/conversations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  panel_id: panel.id,
                  title: panel.title,
                  messages: apiMessages,
                  pinned: panel.pinned ?? false,
                }),
              }).catch(() => {});
            }
          }
        }

        // Initialize tracking
        const snapshots = new Map<string, string>();
        for (const panel of localChatPanels) {
          snapshots.set(panel.id, panelSnapshotKey(panel));
        }
        prevSnapshotsRef.current = snapshots;
      } catch {
        // Sync is best-effort
      }
    }

    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Save on change (debounced per panel) ──────────────────────────
  useEffect(() => {
    if (!syncedRef.current) return;

    const chatPanels = state.panels.filter(
      (p): p is ChatPanelData => p.type === "chat"
    );

    const prev = prevSnapshotsRef.current;
    const next = new Map<string, string>();

    for (const panel of chatPanels) {
      const key = panelSnapshotKey(panel);
      next.set(panel.id, key);

      const prevKey = prev.get(panel.id);

      // Save if anything changed (messages, title, or pinned)
      if (key !== prevKey && panel.messages.length > 0) {
        const existing = debounceTimers.current.get(panel.id);
        if (existing) clearTimeout(existing);

        const panelId = panel.id;
        const title = panel.title;
        const pinned = panel.pinned ?? false;
        const messages = messagesToApiHistory(panel.messages);

        if (messages.length > 0) {
          const timer = setTimeout(() => {
            fetch("/api/conversations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                panel_id: panelId,
                title,
                messages,
                pinned,
              }),
            }).catch(() => {});
            debounceTimers.current.delete(panelId);
          }, SAVE_DEBOUNCE_MS);

          debounceTimers.current.set(panelId, timer);
        }
      }
    }

    // Clean up timers for panels that no longer exist
    for (const [panelId, timer] of debounceTimers.current) {
      if (!next.has(panelId)) {
        clearTimeout(timer);
        debounceTimers.current.delete(panelId);
      }
    }

    prevSnapshotsRef.current = next;
  }, [state.panels]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of debounceTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);
}
