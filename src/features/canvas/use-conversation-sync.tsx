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
 *
 * Also exposes the full conversation list via <ChatConversationsProvider>
 * + useChatConversations(). The FixedChatPanel drawer reads this so it can
 * display closed-but-still-persisted chats (conversations whose matching
 * canvas panel has been closed) and re-open them on click.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useCanvas, useCanvasScope } from "./canvas-store";
import type { ChatPanelData } from "./types";
import type { ChatMessage, ChatAttachment } from "@/features/ingestion/components/chat-message";

/** Attachment metadata stored in persisted conversation JSONB (no base64). */
interface PersistedAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
}

interface ServerMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: PersistedAttachment[];
}

export interface ServerConversation {
  id: string;
  panel_id: string;
  title: string;
  messages: ServerMessage[];
  pinned: boolean;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// ── Conversations context ─────────────────────────────────────────────

interface ChatConversationsContextValue {
  /** Every conversation the server has for this user. Closed chats
   * (conversations whose panel_id isn't in state.panels) are surfaced
   * in the drawer from this list. */
  conversations: ServerConversation[];
  /** Replace the conversation list in memory. Used by both the mount
   * fetch inside useConversationSync and any mutation the drawer makes
   * (e.g. removing a conversation on permanent delete). */
  setConversations: React.Dispatch<React.SetStateAction<ServerConversation[]>>;
}

const ChatConversationsContext = createContext<ChatConversationsContextValue | null>(null);

export function ChatConversationsProvider({
  children,
  initialConversations,
}: {
  children: ReactNode;
  /** Server-rendered conversations list. When provided, the sync hook
   * skips its mount fetch and uses this list as the seed. */
  initialConversations?: ServerConversation[];
}) {
  const [conversations, setConversations] = useState<ServerConversation[]>(
    initialConversations ?? []
  );
  return (
    <ChatConversationsContext.Provider value={{ conversations, setConversations }}>
      {children}
    </ChatConversationsContext.Provider>
  );
}

export function useChatConversations(): ChatConversationsContextValue {
  const ctx = useContext(ChatConversationsContext);
  if (!ctx) {
    throw new Error(
      "useChatConversations must be used inside <ChatConversationsProvider>"
    );
  }
  return ctx;
}

/**
 * Strip ephemeral fields (base64, textContent) from attachments for persistence.
 * Only metadata is stored in the conversation JSONB.
 */
function stripEphemeralFromAttachments(
  attachments: ChatAttachment[] | undefined
): PersistedAttachment[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    fileSize: a.fileSize,
    storagePath: a.storagePath,
  }));
}

/**
 * Build API-ready messages for conversation persistence.
 * Similar to messagesToApiHistory but preserves attachment metadata.
 */
function messagesToPersistFormat(messages: ChatMessage[]): ServerMessage[] {
  const out: ServerMessage[] = [];
  for (const m of messages) {
    if (m.role === "user" && m.type === "text") {
      const msg: ServerMessage = { role: "user", content: m.content };
      const persisted = stripEphemeralFromAttachments(m.attachments);
      if (persisted) msg.attachments = persisted;
      out.push(msg);
    } else if (m.role === "ai" && m.type === "text") {
      out.push({ role: "assistant", content: m.content });
    }
  }
  return out;
}

const SAVE_DEBOUNCE_MS = 2000;

/**
 * Fingerprint the last message by role+type. The streaming → text
 * finalisation doesn't change messages.length, so without this the
 * snapshot key wouldn't flip on finalise and the agent's reply would
 * never persist. Content is deliberately excluded so token-by-token
 * streaming updates don't re-arm the debounce on every frame.
 */
function lastMessageSig(panel: ChatPanelData): string {
  const last = panel.messages[panel.messages.length - 1];
  return last ? `${last.role}:${last.type}` : "";
}

function panelSnapshotKey(panel: ChatPanelData): string {
  return `${panel.messages.length}|${lastMessageSig(panel)}|${panel.title}|${panel.pinned ?? false}`;
}

export function useConversationSync() {
  const { state } = useCanvas();
  const scope = useCanvasScope();
  const canvasId = scope?.canvasId ?? null;
  const { setConversations } = useChatConversations();
  const syncedRef = useRef(false);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const prevSnapshotsRef = useRef<Map<string, string>>(new Map());

  // Seed prevSnapshotsRef synchronously from the server-rendered initial
  // state so the save effect below doesn't immediately re-POST every
  // conversation back to the server on first render.
  //
  // Use the PANEL's current state (matches what the save effect's
  // panelSnapshotKey() computes on the next tick). loadCanvasInitialState
  // sometimes keeps the panel's original title when the conversation has
  // a placeholder title like "New Chat" — seeding from conv.title would
  // trigger a spurious POST on first load.
  if (!syncedRef.current) {
    syncedRef.current = true;
    const snapshots = new Map<string, string>();
    for (const panel of state.panels) {
      if (panel.type !== "chat") continue;
      snapshots.set(panel.id, panelSnapshotKey(panel));
    }
    prevSnapshotsRef.current = snapshots;
  }

  // ── Save on change (debounced per panel) ──────────────────────────
  // Build a cheap composite key of only chat-relevant data so we can
  // skip the more expensive per-panel diffing when nothing chat-related
  // changed (e.g. a panel was just moved/resized).
  const chatSnapshotKeyRef = useRef("");

  // Mirror latest panels into a ref so the debounced save can read the
  // post-finalise state when it fires — not the schedule-time snapshot.
  // Without this, a save scheduled while the last message is still a
  // `streaming` bubble would POST a payload with the bubble filtered
  // out (messagesToPersistFormat only keeps `text`), losing the reply.
  const panelsRef = useRef(state.panels);
  panelsRef.current = state.panels;

  useEffect(() => {
    if (!syncedRef.current) return;

    const chatPanels = state.panels.filter(
      (p): p is ChatPanelData => p.type === "chat"
    );

    // Quick bail: build a composite key from chat-specific fields only.
    // If it hasn't changed, skip all the per-panel diff work.
    const compositeKey = chatPanels
      .map(
        (p) =>
          `${p.id}:${p.messages.length}:${lastMessageSig(p)}:${p.title}:${p.pinned ?? false}`
      )
      .join("|");
    if (compositeKey === chatSnapshotKeyRef.current) return;
    chatSnapshotKeyRef.current = compositeKey;

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

        const timer = setTimeout(() => {
          debounceTimers.current.delete(panelId);

          const latest = panelsRef.current.find(
            (p): p is ChatPanelData => p.id === panelId && p.type === "chat"
          );
          if (!latest) return;

          const messages = messagesToPersistFormat(latest.messages);
          if (messages.length === 0) return;

          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (canvasId) headers["X-Canvas-Id"] = canvasId;
          fetch("/api/conversations", {
            method: "POST",
            headers,
            body: JSON.stringify({
              panel_id: panelId,
              title: latest.title,
              messages,
              pinned: latest.pinned ?? false,
            }),
          })
            .then(async (res) => {
              if (!res.ok) return;
              // Reflect the save in our context so the drawer can
              // show this conversation later if the canvas panel is
              // closed. Update-or-insert by panel_id.
              try {
                const { conversation } = await res.json();
                if (conversation && conversation.panel_id) {
                  setConversations((prevList) => {
                    const without = prevList.filter(
                      (c) => c.panel_id !== conversation.panel_id
                    );
                    return [conversation, ...without];
                  });
                }
              } catch {
                // Non-JSON or unexpected shape — skip context update.
              }
            })
            .catch((err) =>
              console.error(
                "[conversation-sync] save failed for panel:",
                panelId,
                err
              )
            );
        }, SAVE_DEBOUNCE_MS);

        debounceTimers.current.set(panelId, timer);
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
