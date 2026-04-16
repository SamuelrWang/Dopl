"use client";

/**
 * FixedChatPanel — supplementary fixed right-side drawer that lists all
 * canvas chat conversations and lets the user interact with the selected
 * one. Canvas chat panels remain independently usable; this is an add-on
 * for consolidated viewing.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  usePanelsContext,
  useCanvas,
  computeNewPanelPosition,
  nextPanelIdString,
} from "./canvas-store";
import { useChatDrawer } from "./chat-drawer-context";
import { ChatPanelBody } from "./panels/chat/chat-panel";
import { createWelcomeMessages } from "./onboarding-welcome";
import {
  BROWSE_PANEL_SIZE,
  CONNECTION_PANEL_SIZE,
  type ChatPanelData,
} from "./types";
import {
  useChatConversations,
  type ServerConversation,
} from "./use-conversation-sync";
import type { ChatMessage } from "@/components/ingest/chat-message";

const PANEL_WIDTH = 520;
const LIST_WIDTH = 180;
const EDGE_GAP = 16;

function formatTimeShort(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expiring";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d`;
  return `${hours}h`;
}

const ONBOARDING_KEY = "dopl-onboarding-chat-done";

/**
 * Convert a server-stored conversation's messages into the client
 * ChatMessage format used by the reducer. Mirrors (a subset of) the
 * logic in use-conversation-sync.tsx — attachment signed URLs aren't
 * regenerated here (the user can refresh to get fresh URLs); for a
 * reopened chat without attachments (the common case), this is exact.
 */
function serverMessagesToChatMessages(
  conv: ServerConversation
): ChatMessage[] {
  return conv.messages.map((m) => {
    if (m.role === "user") {
      const msg: ChatMessage = {
        role: "user",
        type: "text" as const,
        content: m.content,
      };
      if (m.attachments && m.attachments.length > 0) {
        msg.attachments = m.attachments.map((a) => ({
          ...a,
          url: "", // signed URL regenerated on next full mount
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
}

export function FixedChatPanel() {
  const { isOpen, close, open } = useChatDrawer();
  const { panels, dispatch } = usePanelsContext();
  const { state, dbReady } = useCanvas();
  const { conversations } = useChatConversations();
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const onboardingRan = useRef(false);

  // First-load onboarding: create welcome conversation and open drawer.
  //
  // IMPORTANT: must wait for dbReady. HYDRATE_FROM_DB replaces state.panels
  // with whatever the DB returned, preserving only locally-processing
  // chats. If we create the welcome panel before hydration, it gets
  // nuked by HYDRATE_FROM_DB before the sync layer has a chance to POST
  // it — the panel disappears and the localStorage flag blocks
  // re-creation on next reload. Hence: wait for dbReady, then create.
  //
  // Also guard against re-creating the welcome panel if one already
  // exists in the hydrated state (e.g. on a fresh browser where the
  // localStorage flag isn't set but the user has done onboarding before
  // in another session). The id prefix is a stable marker.
  useEffect(() => {
    if (onboardingRan.current) return;
    if (typeof window === "undefined") return;
    if (!dbReady) return;
    if (localStorage.getItem(ONBOARDING_KEY) === "1") return;
    if (panels.some((p) => p.id.startsWith("chat-welcome-"))) {
      // Already have one from a prior session — don't spawn another.
      onboardingRan.current = true;
      localStorage.setItem(ONBOARDING_KEY, "1");
      return;
    }
    onboardingRan.current = true;

    // Position the welcome panel below the default connection + browse
    // panels so it's visible on the canvas AND doesn't bloat bounds.
    // Previously this was (-9999, -9999), which made computePanelsBounds
    // include a point ~10k units away, massively inflating canvas size.
    const welcomeX = 40;
    const welcomeY = 40 + Math.max(CONNECTION_PANEL_SIZE.height, BROWSE_PANEL_SIZE.height) + 32;

    const panelId = `chat-welcome-${Date.now()}`;
    dispatch({
      type: "CREATE_CHAT_PANEL",
      id: panelId,
      x: welcomeX,
      y: welcomeY,
      title: "Welcome to Dopl!",
    });

    // Hydrate with welcome messages
    const messages = createWelcomeMessages();
    // Small delay so the panel exists in state before hydrating
    setTimeout(() => {
      for (const msg of messages) {
        dispatch({ type: "APPEND_MESSAGE", panelId, message: msg });
      }
      setSelectedPanelId(panelId);
      open();
    }, 100);

    localStorage.setItem(ONBOARDING_KEY, "1");
  }, [dispatch, open, dbReady, panels]);

  const chatPanels = useMemo(
    () =>
      panels
        .filter((p): p is ChatPanelData => p.type === "chat")
        .sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return 0;
        }),
    [panels]
  );

  // Closed chats: server-known conversations whose matching canvas panel
  // has been closed. These still live in the DB (on their 7-day timer)
  // and surface here so the user can re-open them with a single click.
  const onCanvasPanelIds = useMemo(
    () => new Set(chatPanels.map((p) => p.id)),
    [chatPanels]
  );
  const closedConversations = useMemo(() => {
    return conversations
      .filter((c) => !onCanvasPanelIds.has(c.panel_id))
      .sort((a, b) => {
        // Pinned first, then newest updated_at
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.updated_at.localeCompare(a.updated_at);
      });
  }, [conversations, onCanvasPanelIds]);

  /**
   * Re-open a closed chat: recreate the canvas panel with the saved
   * panel_id, then hydrate messages / title / pinned from the stored
   * conversation. The sync layer will POST the recreated panel row back
   * into canvas_panels on its next tick. The conversations row is
   * already there — we never deleted it — so no refetch needed.
   */
  const reopenConversation = useCallback(
    (conv: ServerConversation) => {
      const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
      const vh = typeof window !== "undefined" ? window.innerHeight : 800;
      const { x, y } = computeNewPanelPosition(state, vw, vh, 480, 600);

      dispatch({
        type: "CREATE_CHAT_PANEL",
        id: conv.panel_id,
        x,
        y,
        title: conv.title,
      });

      const messages = serverMessagesToChatMessages(conv);
      if (messages.length > 0) {
        dispatch({
          type: "HYDRATE_CHAT_MESSAGES",
          panelId: conv.panel_id,
          messages,
          conversationId: conv.id,
        });
      }
      if (conv.pinned) {
        dispatch({
          type: "SET_CHAT_PINNED",
          panelId: conv.panel_id,
          pinned: true,
        });
      }
      setSelectedPanelId(conv.panel_id);
    },
    [dispatch, state]
  );

  // Suppress unused warning on nextPanelIdString — imported for future
  // use but current restore path reuses the conversation's own panel_id.
  void nextPanelIdString;

  const selectedPanel = useMemo(
    () => chatPanels.find((p) => p.id === selectedPanelId) ?? null,
    [chatPanels, selectedPanelId]
  );

  const effectivePanel = selectedPanel ?? chatPanels[0] ?? null;
  const hasAnyChats = chatPanels.length > 0 || closedConversations.length > 0;

  if (!isOpen) return null;

  return (
    <div
      className="fixed flex flex-col overflow-hidden rounded-2xl bg-[var(--panel-surface)] border border-white/[0.08]"
      style={{
        top: EDGE_GAP,
        right: EDGE_GAP,
        bottom: EDGE_GAP,
        width: PANEL_WIDTH,
        zIndex: 40,
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div
        className="shrink-0 h-10 flex items-center justify-between px-4 gap-2"
        style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-wider text-white/50 truncate min-w-0">
          {effectivePanel?.title || "Chat"}
        </span>
        <button
          onClick={close}
          aria-label="Close chat panel"
          className="w-6 h-6 shrink-0 flex items-center justify-center rounded-[3px] text-white/40 hover:text-white/80 hover:bg-white/[0.08] transition-colors"
        >
          <svg
            width="12"
            height="2"
            viewBox="0 0 12 2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <line x1="0" y1="1" x2="12" y2="1" />
          </svg>
        </button>
      </div>

      {/* ── Body: conversation list + divider toggle + active chat ── */}
      <div className="relative flex flex-1 min-h-0">
        {/* Left: conversation list (toggleable) */}
        {listOpen && (
          <div
            className="shrink-0 flex flex-col overflow-hidden"
            style={{
              width: LIST_WIDTH,
            }}
          >
            <div className="flex-1 overflow-y-auto">
              {!hasAnyChats ? (
                <div className="px-3 py-4 text-[11px] text-white/25 font-mono">
                  No chats yet
                </div>
              ) : (
                <>
                  {/* On-canvas chats */}
                  {chatPanels.map((panel) => (
                    <button
                      key={panel.id}
                      onClick={() => setSelectedPanelId(panel.id)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${
                        effectivePanel?.id === panel.id
                          ? "bg-white/[0.08]"
                          : "hover:bg-white/[0.04]"
                      }`}
                      style={{
                        boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.04)",
                      }}
                    >
                      <div className="font-mono text-[11px] text-white/70 truncate leading-tight">
                        {panel.title}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-mono text-[9px] text-white/25">
                          {panel.messages.filter((m) => m.type === "text").length}{" "}
                          msgs
                        </span>
                        {panel.pinned ? (
                          <span className="font-mono text-[9px] text-white/30">
                            Pinned
                          </span>
                        ) : panel.expiresAt ? (
                          <span className="font-mono text-[9px] text-white/20">
                            {formatTimeShort(panel.expiresAt)}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  ))}

                  {/* Closed chats — click to reopen on canvas */}
                  {closedConversations.length > 0 && (
                    <div
                      className="px-3 py-2 mt-1 text-[9px] uppercase tracking-wider text-white/25 font-mono"
                      style={{
                        boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.04)",
                      }}
                    >
                      Closed
                    </div>
                  )}
                  {closedConversations.map((conv) => (
                    <button
                      key={conv.panel_id}
                      onClick={() => reopenConversation(conv)}
                      title="Click to reopen on canvas"
                      className="w-full text-left px-3 py-2.5 transition-colors opacity-55 hover:opacity-100 hover:bg-white/[0.04]"
                      style={{
                        boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.04)",
                      }}
                    >
                      <div className="font-mono text-[11px] text-white/60 truncate leading-tight">
                        {conv.title || "Untitled chat"}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-mono text-[9px] text-white/25">
                          {conv.messages.length} msgs
                        </span>
                        {conv.pinned ? (
                          <span className="font-mono text-[9px] text-white/30">
                            Pinned
                          </span>
                        ) : conv.expires_at ? (
                          <span className="font-mono text-[9px] text-white/20">
                            {formatTimeShort(conv.expires_at)}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* Divider with centered toggle arrow */}
        <div className="relative shrink-0 w-px bg-white/[0.06]">
          <button
            onClick={() => setListOpen((v) => !v)}
            aria-label={listOpen ? "Hide conversations" : "Show conversations"}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 left-0 z-10 w-4 h-8 flex items-center justify-center rounded-full bg-[var(--panel-surface)] border border-white/[0.1] text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
          >
            <svg
              width="6"
              height="10"
              viewBox="0 0 6 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{
                transform: listOpen ? undefined : "rotate(180deg)",
                transition: "transform 150ms ease",
              }}
            >
              <path d="M5 1L1 5L5 9" />
            </svg>
          </button>
        </div>

        {/* Right: active chat */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {effectivePanel ? (
            <ChatPanelBody panel={effectivePanel} />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <span className="font-mono text-[11px] text-white/20">
                No conversation selected
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
