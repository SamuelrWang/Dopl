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
import { useCanvas } from "./canvas-store";
import type { ChatPanelData } from "./types";
import { messagesToApiHistory } from "./panels/chat/chat-message-types";
import type { ChatMessage, ChatAttachment } from "@/components/ingest/chat-message";

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

export function ChatConversationsProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<ServerConversation[]>([]);
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

/** Snapshot key for tracking changes — includes message count, title, and pinned state. */
function panelSnapshotKey(panel: ChatPanelData): string {
  return `${panel.messages.length}|${panel.title}|${panel.pinned ?? false}`;
}

export function useConversationSync() {
  const { state, dispatch, dbReady } = useCanvas();
  const { setConversations } = useChatConversations();
  const syncedRef = useRef(false);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const prevSnapshotsRef = useRef<Map<string, string>>(new Map());

  // ── Load on mount (runs once, after canvas hydration) ─────────────
  // Gated on dbReady so state.panels already contains the hydrated chat
  // panels by the time we read from it. Without this gate, the async
  // callback captures the initial empty state closure, `localPanelIds`
  // is empty, and HYDRATE_CHAT_MESSAGES never dispatches — the user
  // sees chat panels with no messages after every reload.
  useEffect(() => {
    if (!dbReady) return;
    if (syncedRef.current) return;
    syncedRef.current = true;

    async function loadConversations() {
      try {
        const res = await fetch("/api/conversations");
        if (!res.ok) return;

        const { conversations }: { conversations: ServerConversation[] } =
          await res.json();

        // Expose to the drawer via context so it can render closed chats.
        setConversations(conversations);

        const localChatPanels = state.panels.filter(
          (p): p is ChatPanelData => p.type === "chat"
        );
        const localPanelIds = new Set(localChatPanels.map((p) => p.id));
        const serverPanelIds = new Set(conversations.map((c) => c.panel_id));

        // Server conversations with matching local panels → hydrate
        for (const conv of conversations) {
          if (localPanelIds.has(conv.panel_id)) {
            const messages: ChatMessage[] = conv.messages.map((m) => {
              if (m.role === "user") {
                const msg: ChatMessage = {
                  role: "user",
                  type: "text" as const,
                  content: m.content,
                };
                // Restore attachment metadata (without ephemeral base64/textContent).
                // The `url` field will be empty — the UI will use storagePath to
                // generate signed URLs on demand.
                if (m.attachments && m.attachments.length > 0) {
                  msg.attachments = m.attachments.map((a) => ({
                    ...a,
                    url: "", // Will be populated by signed URL generation
                  }));
                }
                return msg;
              }
              return {
                role: "ai" as const,
                type: "text" as const,
                content: m.content,
              };
            });

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
            if (conv.title && !/^(Chat\s*#\d+|New Chat)$/i.test(conv.title)) {
              dispatch({
                type: "UPDATE_CHAT_TITLE",
                panelId: conv.panel_id,
                title: conv.title,
              });
            }
          }
        }

        // Resolve signed URLs for any attachments loaded from the server.
        // Collect all storage paths that need URLs, batch-sign them, then
        // update the messages via HYDRATE_CHAT_MESSAGES with the URLs filled in.
        const pathsToSign: string[] = [];
        for (const conv of conversations) {
          if (!localPanelIds.has(conv.panel_id)) continue;
          for (const m of conv.messages) {
            if (m.attachments) {
              for (const a of m.attachments) {
                pathsToSign.push(a.storagePath);
              }
            }
          }
        }

        if (pathsToSign.length > 0) {
          try {
            const urlRes = await fetch("/api/chat/attachment-url", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paths: pathsToSign }),
            });
            if (urlRes.ok) {
              const { urls } = (await urlRes.json()) as {
                urls: Record<string, string>;
              };
              // Re-hydrate panels that have attachments with signed URLs
              for (const conv of conversations) {
                if (!localPanelIds.has(conv.panel_id)) continue;
                const hasAttachments = conv.messages.some(
                  (m) => m.attachments && m.attachments.length > 0
                );
                if (!hasAttachments) continue;

                const updated: ChatMessage[] = conv.messages.map((m) => {
                  if (m.role === "user" && m.attachments && m.attachments.length > 0) {
                    return {
                      role: "user" as const,
                      type: "text" as const,
                      content: m.content,
                      attachments: m.attachments.map((a) => ({
                        ...a,
                        url: urls[a.storagePath] || "",
                      })),
                    };
                  }
                  return {
                    role: (m.role === "user" ? "user" : "ai") as "user" | "ai",
                    type: "text" as const,
                    content: m.content,
                  };
                });
                dispatch({
                  type: "HYDRATE_CHAT_MESSAGES",
                  panelId: conv.panel_id,
                  messages: updated,
                  conversationId: conv.id,
                });
              }
            }
          } catch (err) {
            console.error("[conversation-sync] attachment URL signing failed:", err);
          }
        }

        // Local chat panels with messages not on server → push
        for (const panel of localChatPanels) {
          if (!serverPanelIds.has(panel.id) && panel.messages.length > 0) {
            const persistMessages = messagesToPersistFormat(panel.messages);
            if (persistMessages.length > 0) {
              fetch("/api/conversations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  panel_id: panel.id,
                  title: panel.title,
                  messages: persistMessages,
                  pinned: panel.pinned ?? false,
                }),
              }).catch((err) => console.error("[conversation-sync] push local conversation failed:", err));
            }
          }
        }

        // Initialize tracking based on what we JUST hydrated — not the
        // pre-hydration snapshot of panels. If we used the stale panel
        // snapshots ({messages:0, title:..., pinned:false}), the save
        // effect would immediately fire right after HYDRATE_CHAT_MESSAGES
        // (panel state now differs from the stale snapshot) and re-POST
        // every conversation back to the server unnecessarily.
        //
        // ServerMessage is already filtered to the same text-only set
        // that the save effect serializes, so conv.messages.length is
        // the exact panel.messages.length after hydration.
        const snapshots = new Map<string, string>();
        for (const conv of conversations) {
          if (localPanelIds.has(conv.panel_id)) {
            snapshots.set(
              conv.panel_id,
              `${conv.messages.length}|${conv.title}|${conv.pinned ?? false}`
            );
          }
        }
        // Also seed panels that WEREN'T on the server (freshly created,
        // not yet pushed) so we don't trigger false positives.
        for (const panel of localChatPanels) {
          if (!serverPanelIds.has(panel.id)) {
            snapshots.set(panel.id, panelSnapshotKey(panel));
          }
        }
        prevSnapshotsRef.current = snapshots;
      } catch (err) {
        console.error("[conversation-sync] Failed to load conversations:", err);
      }
    }

    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbReady]);

  // ── Save on change (debounced per panel) ──────────────────────────
  // Build a cheap composite key of only chat-relevant data so we can
  // skip the more expensive per-panel diffing when nothing chat-related
  // changed (e.g. a panel was just moved/resized).
  const chatSnapshotKeyRef = useRef("");

  useEffect(() => {
    if (!syncedRef.current) return;

    const chatPanels = state.panels.filter(
      (p): p is ChatPanelData => p.type === "chat"
    );

    // Quick bail: build a composite key from chat-specific fields only.
    // If it hasn't changed, skip all the per-panel diff work.
    const compositeKey = chatPanels
      .map((p) => `${p.id}:${p.messages.length}:${p.title}:${p.pinned ?? false}`)
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
        const title = panel.title;
        const pinned = panel.pinned ?? false;
        const messages = messagesToPersistFormat(panel.messages);

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
