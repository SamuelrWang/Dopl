"use client";

/**
 * FixedChatSidebar — fixed right-side panel that lists all canvas chat
 * conversations and shows a read-only message viewer for the selected one.
 *
 * Features:
 *   - Conversation list on the left (title, message count, pin/timer badge)
 *   - Message viewer on the right for the selected conversation
 *   - "Locate" button to pan the canvas to the selected panel
 *   - Slide-in/out toggle with a small tab on the right edge
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useCanvas } from "./canvas-store";
import type { ChatPanelData } from "./types";
import { MarkdownMessage } from "@/components/design";

function formatTimeShort(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expiring";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d`;
  return `${hours}h`;
}

const SIDEBAR_STORAGE_KEY = "sie-sidebar-open";

export function FixedChatSidebar() {
  const { state, dispatch } = useCanvas();
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);

  // Own local state — avoids re-rendering the entire canvas tree on toggle
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  });

  // Persist + set CSS variable
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--sidebar-right-inset", sidebarOpen ? "480px" : "0px");
    localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarOpen ? "1" : "0");
    return () => { root.style.removeProperty("--sidebar-right-inset"); };
  }, [sidebarOpen]);

  const chatPanels = useMemo(
    () =>
      state.panels
        .filter((p): p is ChatPanelData => p.type === "chat")
        .sort((a, b) => {
          // Pinned first, then by panel id (creation order)
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return 0;
        }),
    [state.panels]
  );

  const selectedPanel = useMemo(
    () => chatPanels.find((p) => p.id === selectedPanelId) ?? null,
    [chatPanels, selectedPanelId]
  );

  // Auto-select first panel if current selection is gone
  const effectivePanel = selectedPanel ?? chatPanels[0] ?? null;

  const handleToggle = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleLocate = useCallback(() => {
    if (!effectivePanel) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const zoom = state.camera.zoom;
    dispatch({
      type: "SET_CAMERA",
      camera: {
        x: -(effectivePanel.x + effectivePanel.width / 2) * zoom + vw / 2,
        y: -(effectivePanel.y + effectivePanel.height / 2) * zoom + vh / 2,
        zoom,
      },
    });
  }, [effectivePanel, state.camera.zoom, dispatch]);

  const textMessages = useMemo(() => {
    if (!effectivePanel) return [];
    return effectivePanel.messages.filter(
      (m) =>
        (m.role === "user" && m.type === "text") ||
        (m.role === "ai" && m.type === "text")
    );
  }, [effectivePanel]);

  return (
    <>
      {/* Sidebar wrapper — toggle tab + panel slide together */}
      <div
        className="fixed top-0 right-0 bottom-0 z-40 flex"
        style={{
          /* Extra width for the toggle tab that sticks out to the left */
          width: 480 + 24,
          transform: sidebarOpen ? "translate3d(0,0,0)" : "translate3d(480px,0,0)",
          transition: "transform 200ms cubic-bezier(0.4, 0, 0.2, 1)",
          willChange: "transform",
          contain: "layout style paint",
        }}
      >
        {/* Toggle tab — positioned at the left edge of the wrapper, slides with the panel */}
        <button
          onClick={handleToggle}
          aria-label={sidebarOpen ? "Close chat sidebar" : "Open chat sidebar"}
          className="self-center shrink-0 w-6 h-16 flex items-center justify-center rounded-l-lg bg-[#1c1c1f] border border-r-0 border-white/10 text-white/40 hover:text-white/80 hover:bg-[#252528] transition-colors"
        >
          <svg
            width="10"
            height="14"
            viewBox="0 0 10 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
          >
            {sidebarOpen ? (
              <path d="M3 1l6 6-6 6" />
            ) : (
              <path d="M7 1l-6 6 6 6" />
            )}
          </svg>
        </button>

        {/* Sidebar panel — solid background, rounded left corners */}
        <div className="relative flex-1 flex flex-col rounded-l-2xl overflow-hidden bg-[#1c1c1f] border-l border-y border-white/[0.08]">

        {/* Content */}
        <div className="relative flex w-full h-full">
          {/* Conversation list */}
          <div className="w-[180px] shrink-0 border-r border-white/[0.06] flex flex-col overflow-hidden">
            <div className="shrink-0 px-3 h-10 flex items-center border-b border-white/[0.06]">
              <span className="font-mono text-[10px] uppercase tracking-wider text-white/50">
                Conversations
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {chatPanels.length === 0 ? (
                <div className="px-3 py-4 text-[11px] text-white/25 font-mono">
                  No chats yet
                </div>
              ) : (
                chatPanels.map((panel) => (
                  <button
                    key={panel.id}
                    onClick={() => setSelectedPanelId(panel.id)}
                    className={`w-full text-left px-3 py-2.5 border-b border-white/[0.04] transition-colors ${
                      (effectivePanel?.id === panel.id)
                        ? "bg-white/[0.08]"
                        : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="font-mono text-[11px] text-white/70 truncate leading-tight">
                      {panel.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono text-[9px] text-white/25">
                        {panel.messages.filter((m) => m.type === "text").length} msgs
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
                ))
              )}
            </div>
          </div>

          {/* Message viewer */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {effectivePanel ? (
              <>
                {/* Viewer header */}
                <div className="shrink-0 px-4 h-10 flex items-center justify-between border-b border-white/[0.06]">
                  <span className="font-mono text-[11px] text-white/60 truncate">
                    {effectivePanel.title}
                  </span>
                  <button
                    onClick={handleLocate}
                    aria-label="Locate on canvas"
                    title="Pan canvas to this chat"
                    className="w-6 h-6 flex items-center justify-center rounded-[3px] text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <circle cx="6" cy="6" r="2" />
                      <path d="M6 1v2M6 9v2M1 6h2M9 6h2" />
                    </svg>
                  </button>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                  {textMessages.length === 0 ? (
                    <div className="text-[11px] text-white/20 font-mono py-4">
                      No messages yet
                    </div>
                  ) : (
                    textMessages.map((msg, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <span className="font-mono text-[9px] uppercase tracking-wider text-white/25">
                          {msg.role === "user" ? "You" : "AI"}
                        </span>
                        {msg.role === "ai" && msg.type === "text" ? (
                          <div className="text-[12px] text-white/70 leading-relaxed">
                            <MarkdownMessage content={msg.content} />
                          </div>
                        ) : (
                          <div className="text-[12px] text-white/70 leading-relaxed whitespace-pre-wrap">
                            {msg.type === "text" ? msg.content : ""}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
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
      </div>
    </>
  );
}
