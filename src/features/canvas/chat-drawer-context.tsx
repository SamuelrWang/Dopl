"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type DrawerType = "chat" | "brain" | null;

const PANEL_WIDTH = 520;
const EDGE_GAP = 16;

interface DrawerContextValue {
  activeDrawer: DrawerType;
  openChat: () => void;
  openBrain: () => void;
  close: () => void;
  toggleChat: () => void;
  toggleBrain: () => void;
}

const DrawerContext = createContext<DrawerContextValue>({
  activeDrawer: null,
  openChat: () => {},
  openBrain: () => {},
  close: () => {},
  toggleChat: () => {},
  toggleBrain: () => {},
});

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>("chat");

  const openChat = useCallback(() => setActiveDrawer("chat"), []);
  const openBrain = useCallback(() => setActiveDrawer("brain"), []);
  const close = useCallback(() => setActiveDrawer(null), []);
  const toggleChat = useCallback(
    () => setActiveDrawer((v) => (v === "chat" ? null : "chat")),
    [],
  );
  const toggleBrain = useCallback(
    () => setActiveDrawer((v) => (v === "brain" ? null : "brain")),
    [],
  );

  // Centralized CSS variable — one source of truth so switching drawers
  // doesn't momentarily flash 0px between cleanup and re-set.
  useEffect(() => {
    const insetPx = activeDrawer ? PANEL_WIDTH + EDGE_GAP * 2 : 0;
    document.documentElement.style.setProperty(
      "--chat-drawer-inset",
      `${insetPx}px`,
    );
    return () => {
      document.documentElement.style.removeProperty("--chat-drawer-inset");
    };
  }, [activeDrawer]);

  return (
    <DrawerContext.Provider
      value={{ activeDrawer, openChat, openBrain, close, toggleChat, toggleBrain }}
    >
      {children}
    </DrawerContext.Provider>
  );
}

/** Backward-compatible hook for the chat drawer. */
export function useChatDrawer() {
  const { activeDrawer, openChat, close, toggleChat } = useContext(DrawerContext);
  return useMemo(
    () => ({
      isOpen: activeDrawer === "chat",
      open: openChat,
      close,
      toggle: toggleChat,
    }),
    [activeDrawer, openChat, close, toggleChat],
  );
}

/** Hook for the brain drawer. */
export function useBrainDrawer() {
  const { activeDrawer, openBrain, close, toggleBrain } = useContext(DrawerContext);
  return useMemo(
    () => ({
      isOpen: activeDrawer === "brain",
      open: openBrain,
      close,
      toggle: toggleBrain,
    }),
    [activeDrawer, openBrain, close, toggleBrain],
  );
}

// Re-export for backward compat
export const ChatDrawerProvider = DrawerProvider;
