"use client";

/**
 * FixedChatSidebar — fixed right-side panel that lists all canvas chat
 * conversations and shows a read-only message viewer for the selected one.
 *
 * Performance: the open/close toggle is driven entirely via DOM class
 * manipulation — no React state change, no re-render, no main-thread
 * work during the animation. React only re-renders when the user
 * selects a different conversation or panels change.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCanvas, useCanvasScope } from "./canvas-store";
import type { ChatPanelData } from "./types";
import { MarkdownMessage } from "@/shared/design";

function formatTimeShort(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expiring";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d`;
  return `${hours}h`;
}

const SIDEBAR_STORAGE_KEY = "dopl-sidebar-open";
const SIDEBAR_WIDTH = 480;

export function FixedChatSidebar() {
  const { state, dispatch } = useCanvas();
  const scope = useCanvasScope();
  const canvasId = scope?.canvasId ?? null;
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Track open state in a ref — never triggers re-render
  const openRef = useRef(
    typeof window !== "undefined" &&
      localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1"
  );

  // Apply initial state on mount (no animation)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (openRef.current) {
      // Skip transition for initial state
      el.style.transition = "none";
      el.dataset.open = "";
      document.documentElement.style.setProperty(
        "--sidebar-right-inset",
        `${SIDEBAR_WIDTH}px`
      );
      // Re-enable transition next frame
      requestAnimationFrame(() => {
        el.style.transition = "";
      });
    }
    return () => {
      document.documentElement.style.removeProperty("--sidebar-right-inset");
    };
  }, []);

  // Toggle is pure DOM — zero React work
  const handleToggle = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const next = !openRef.current;
    openRef.current = next;

    if (next) {
      el.dataset.open = "";
    } else {
      delete el.dataset.open;
    }

    document.documentElement.style.setProperty(
      "--sidebar-right-inset",
      next ? `${SIDEBAR_WIDTH}px` : "0px"
    );
    localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
    // Sync to DB (fire-and-forget)
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (canvasId) headers["X-Canvas-Id"] = canvasId;
    fetch("/api/canvas/state", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ sidebar_open: next }),
    }).catch(() => {});
  }, [canvasId]);

  const chatPanels = useMemo(
    () =>
      state.panels
        .filter((p): p is ChatPanelData => p.type === "chat")
        .sort((a, b) => {
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

  const effectivePanel = selectedPanel ?? chatPanels[0] ?? null;

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
      {/*
        Outer wrapper — driven by data-open attribute, not React state.
        CSS handles the transform so toggling = zero JS on the main thread.
      */}
      <div
        ref={wrapperRef}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: SIDEBAR_WIDTH + 24,
          transform: `translate3d(${SIDEBAR_WIDTH}px,0,0)`,
          transition: "transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
          willChange: "transform",
          zIndex: 40,
          display: "flex",
          pointerEvents: "none",
        }}
        // CSS: [data-open] overrides the default closed transform
        // This is set/removed by handleToggle via direct DOM manipulation
        data-sidebar-wrapper=""
      >
        {/* Toggle tab */}
        <button
          onClick={handleToggle}
          aria-label="Toggle chat sidebar"
          style={{ pointerEvents: "auto" }}
          className="self-center shrink-0 w-6 h-16 flex items-center justify-center rounded-l-lg bg-[#1c1c1f] border border-r-0 border-white/10 text-white/40 hover:text-white/80 hover:bg-[#252528]"
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
            <path d="M7 1l-6 6 6 6" />
          </svg>
        </button>

        {/* Inner panel — rounded corners here (not on the transforming element) */}
        <div
          className="flex-1 flex flex-col rounded-l-2xl overflow-hidden bg-[#1c1c1f]"
          style={{
            pointerEvents: "auto",
            boxShadow: "inset 1px 0 0 rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex w-full h-full">
            {/* Conversation list */}
            <div
              className="w-[180px] shrink-0 flex flex-col overflow-hidden"
              style={{ boxShadow: "inset -1px 0 0 rgba(255,255,255,0.06)" }}
            >
              <div
                className="shrink-0 px-3 h-10 flex items-center"
                style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}
              >
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
                      className={`w-full text-left px-3 py-2.5 ${
                        effectivePanel?.id === panel.id
                          ? "bg-white/[0.08]"
                          : "hover:bg-white/[0.04]"
                      }`}
                      style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.04)" }}
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
                  <div
                    className="shrink-0 px-4 h-10 flex items-center justify-between"
                    style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}
                  >
                    <span className="font-mono text-[11px] text-white/60 truncate">
                      {effectivePanel.title}
                    </span>
                    <button
                      onClick={handleLocate}
                      aria-label="Locate on canvas"
                      title="Pan canvas to this chat"
                      className="w-6 h-6 flex items-center justify-center rounded-[3px] text-white/30 hover:text-white/70 hover:bg-white/[0.06]"
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
                              {msg.role === "user" &&
                                msg.type === "text" &&
                                msg.attachments &&
                                msg.attachments.length > 0 && (
                                  <span className="block mt-1 font-mono text-[9px] text-white/30 uppercase">
                                    [{msg.attachments.length} attachment
                                    {msg.attachments.length > 1 ? "s" : ""}]
                                  </span>
                                )}
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
