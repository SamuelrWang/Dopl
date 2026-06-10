"use client";

/**
 * FixedInputBar — bottom-fixed input that spawns a NEW ChatPanel for each
 * URL the user sends. Uses the same dark-glass styling and dimensions as
 * the previous IngestChat input bar (which already matches openclaw spec).
 *
 * Sending here:
 *  1. Computes a spawn position at the camera viewport center (in world coords)
 *  2. Dispatches CREATE_CHAT_PANEL
 *  3. Calls startPanelIngestion(dispatch, panelId, url) to begin the ingestion
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { getCanvasViewportSize } from "./viewport-size";
import {
  computeNewPanelPosition,
  nextPanelIdString,
  useCanvas,
} from "./canvas-store";
import {
  DEFAULT_PANEL_SIZE,
  KNOWLEDGE_PANEL_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  SKILLS_PANEL_SIZE,
} from "./types";
import { useSpeechRecognition } from "@/shared/hooks/use-speech-recognition";
import { useChatDrawer } from "./chat-drawer-context";

export function FixedInputBar() {
  const { state, dispatch } = useCanvas();
  const { isOpen: chatOpen, toggle: toggleChatDrawer } = useChatDrawer();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    isListening,
    fullText,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    clearTranscript,
    error: voiceError,
  } = useSpeechRecognition();

  const prevFullTextRef = useRef("");

  // Live-sync voice transcript into the textarea
  useEffect(() => {
    if (isListening && fullText !== prevFullTextRef.current) {
      prevFullTextRef.current = fullText;
      setInput(fullText);
    }
  }, [isListening, fullText]);

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening();
      // final text is already in input via the live-sync effect
      prevFullTextRef.current = "";
    } else {
      clearTranscript();
      prevFullTextRef.current = "";
      startListening();
    }
  }, [isListening, stopListening, clearTranscript, startListening]);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Pick up a pending message from the landing page (stored before login redirect)
  const landingMessageHandled = useRef(false);
  useEffect(() => {
    if (landingMessageHandled.current) return;
    const pending = localStorage.getItem("dopl-landing-message");
    if (!pending) return;
    landingMessageHandled.current = true;
    localStorage.removeItem("dopl-landing-message");
    // Delay briefly so the canvas store is fully initialized
    setTimeout(() => {
      spawnChatPanel(pending);
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Spawn a ChatPanel at the camera viewport center. If `pendingInput` is
   * provided, the panel consumes it on mount and fires a normal chat (or
   * URL-ingest) flow — letting the user start a real conversation from
   * the bottom bar without needing to type the message again inside the
   * panel itself.
   */
  function spawnChatPanel(pendingInput?: string): string {
    const { vw, vh } = getCanvasViewportSize();
    const { x, y } = computeNewPanelPosition(
      state,
      vw,
      vh,
      DEFAULT_PANEL_SIZE.width,
      DEFAULT_PANEL_SIZE.height
    );
    const id = nextPanelIdString(state);
    const title = "New Chat";
    dispatch({
      type: "CREATE_CHAT_PANEL",
      id,
      x,
      y,
      title,
      pendingInput,
    });
    return id;
  }

  /**
   * Spawn a chat panel and hand it the typed message as `pendingInput`;
   * the new chat panel fires /api/chat on mount.
   */
  function handleSend() {
    const text = input.trim();
    if (!text) return;
    if (isListening) {
      stopListening();
      clearTranscript();
      prevFullTextRef.current = "";
    }
    setInput("");
    spawnChatPanel(text);
  }

  /** Spawn a new empty chat panel without sending anything. */
  function handleSpawnChat() {
    spawnChatPanel();
  }

  /**
   * Spawn a knowledge panel — singleton, frame-existing-or-spawn pattern.
   */
  function handleSpawnKnowledge() {
    const { vw, vh } = getCanvasViewportSize();

    const existing = state.panels.find((p) => p.type === "knowledge");
    if (existing) {
      const fitZoom = Math.max(
        MIN_ZOOM,
        Math.min(
          MAX_ZOOM,
          Math.min(vw / existing.width, vh / existing.height) * 0.9
        )
      );
      dispatch({
        type: "SET_CAMERA",
        camera: {
          x: -(existing.x + existing.width / 2) * fitZoom + vw / 2,
          y: -(existing.y + existing.height / 2) * fitZoom + vh / 2,
          zoom: fitZoom,
        },
      });
      dispatch({ type: "SET_SELECTION", panelIds: [existing.id] });
      return;
    }

    const { x, y } = computeNewPanelPosition(
      state,
      vw,
      vh,
      KNOWLEDGE_PANEL_SIZE.width,
      KNOWLEDGE_PANEL_SIZE.height
    );
    const id = `knowledge-${state.nextPanelId}`;
    dispatch({ type: "CREATE_KNOWLEDGE_PANEL", id, x, y });
  }

  /**
   * Spawn a skills panel — singleton, frame-existing-or-spawn pattern.
   */
  function handleSpawnSkills() {
    const { vw, vh } = getCanvasViewportSize();

    const existing = state.panels.find((p) => p.type === "skills");
    if (existing) {
      const fitZoom = Math.max(
        MIN_ZOOM,
        Math.min(
          MAX_ZOOM,
          Math.min(vw / existing.width, vh / existing.height) * 0.9
        )
      );
      dispatch({
        type: "SET_CAMERA",
        camera: {
          x: -(existing.x + existing.width / 2) * fitZoom + vw / 2,
          y: -(existing.y + existing.height / 2) * fitZoom + vh / 2,
          zoom: fitZoom,
        },
      });
      dispatch({ type: "SET_SELECTION", panelIds: [existing.id] });
      return;
    }

    const { x, y } = computeNewPanelPosition(
      state,
      vw,
      vh,
      SKILLS_PANEL_SIZE.width,
      SKILLS_PANEL_SIZE.height
    );
    const id = `skills-${state.nextPanelId}`;
    dispatch({ type: "CREATE_SKILLS_PANEL", id, x, y });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend = input.trim().length > 0;

  return (
    <div
      className="fixed z-[32] flex justify-center px-4 pointer-events-none"
      style={{
        bottom: "calc(var(--app-panel-bottom) + 10px)",
        left: "var(--app-panel-left)",
        right: "var(--app-panel-right)",
        transform: "translateX(calc(var(--chat-drawer-inset, 0px) / -2))",
        transition: "transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        willChange: "transform",
      }}
    >
      <div className="w-[95%] md:w-3/4 max-w-3xl pointer-events-auto">
        <div
          className="relative rounded-2xl overflow-hidden backdrop-blur-xl border border-border-default shadow-[var(--shadow-panel)] transition-colors duration-200 focus-within:border-border-strong"
          style={{ backgroundColor: "var(--input-surface)" }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background: "var(--shine-top-gradient)",
            }}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            className="w-full bg-transparent px-4 pt-4 pb-2 text-base leading-[24px] text-text-primary outline-none resize-none placeholder:text-text-muted disabled:opacity-50 min-h-[48px] max-h-[200px]"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            {/* Left pill group — Chat + Knowledge + Skills */}
            <div className="inline-flex items-center gap-2">
              {/* CHAT pill — opens the fixed chat drawer */}
              <button
                onClick={toggleChatDrawer}
                aria-label="Toggle chat panel"
                className={`inline-flex items-center h-7 px-3 font-mono text-[10px] uppercase tracking-wider rounded-full transition-colors border ${
                  chatOpen
                    ? "text-text-primary bg-surface-selected border-border-highlight"
                    : "text-text-tertiary hover:text-text-primary bg-surface-raised-2 hover:bg-surface-raised-4 border-border-default hover:border-border-highlight"
                }`}
              >
                Chat
              </button>
              {/* KNOWLEDGE pill — spawns a knowledge panel */}
              <button
                onClick={handleSpawnKnowledge}
                aria-label="Spawn knowledge panel"
                className="inline-flex items-center h-7 px-3 font-mono text-[10px] uppercase tracking-wider text-text-tertiary hover:text-text-primary bg-surface-raised-2 hover:bg-surface-raised-4 border border-border-default hover:border-border-highlight rounded-full transition-colors"
              >
                Knowledge
              </button>
              {/* SKILLS pill — spawns a skills panel */}
              <button
                onClick={handleSpawnSkills}
                aria-label="Spawn skills panel"
                className="inline-flex items-center h-7 px-3 font-mono text-[10px] uppercase tracking-wider text-text-tertiary hover:text-text-primary bg-surface-raised-2 hover:bg-surface-raised-4 border border-border-default hover:border-border-highlight rounded-full transition-colors"
              >
                Skills
              </button>
            </div>
            <div className="flex items-center gap-2">
              {/* Voice input — bare icon, no button chrome */}
              {voiceSupported && (
                <button
                  type="button"
                  onClick={handleVoiceToggle}
                  aria-label={isListening ? "Stop recording" : "Start voice input"}
                  title={
                    voiceError
                      ? voiceError
                      : isListening
                      ? "Recording... click to stop"
                      : "Voice input"
                  }
                  className="flex items-center justify-center w-7 h-7 transition-colors"
                >
                  {isListening ? (
                    <span className="flex items-end gap-[2px] h-4">
                      {[1, 2, 3, 4, 3].map((h, i) => (
                        <span
                          key={i}
                          className="w-[2px] rounded-full bg-red-400"
                          style={{
                            height: `${h * 3}px`,
                            animation: `voiceBar 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
                          }}
                        />
                      ))}
                    </span>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-4 h-4 text-text-muted hover:text-text-secondary transition-colors"
                    >
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                      <line x1="8" y1="22" x2="16" y2="22" />
                    </svg>
                  )}
                </button>
              )}
              {/* Send — circular */}
              <button
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send"
                className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-text-primary border border-border-default hover:border-border-highlight rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-surface-raised-2 hover:bg-surface-raised-4"
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
      {isListening && (
        <style>{`
          @keyframes voiceBar {
            from { transform: scaleY(0.5); }
            to   { transform: scaleY(1.5); }
          }
        `}</style>
      )}
    </div>
  );
}
