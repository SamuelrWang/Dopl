"use client";

/**
 * CanvasClientShell — client-side entry point for the server-rendered
 * canvas. Receives `initialState` + `initialConversations` as props from
 * the server component and seeds CanvasProvider with them directly. No
 * loading spinners — the reducer has real state on first render.
 *
 * Compare with LegacyCanvasClientPage, which fetches state client-side
 * and shows spinners while it waits.
 */

import { createPortal } from "react-dom";
import { useSyncExternalStore } from "react";
import { CanvasProvider } from "@/features/canvas/canvas-store";
import { CanvasGridSync } from "@/features/canvas/canvas-grid-sync";
import { useLayoutSnapshot } from "@/features/canvas/use-layout-snapshot";
import { Canvas } from "@/features/canvas/canvas";
import { FixedInputBar } from "@/features/canvas/fixed-input-bar";
import { FixedChatPanel } from "@/features/canvas/fixed-chat-panel";
import { DrawerProvider } from "@/features/canvas/chat-drawer-context";
import { PaywallGate } from "@/features/billing/components/paywall-gate";
import type { CanvasState } from "@/features/canvas/types";
import type { ServerConversation } from "@/features/canvas/use-conversation-sync";

/**
 * The canvas renders via a portal to document.body so it escapes the root
 * layout's <main> wrapper (which sits inside a z-[2] stacking context and
 * would otherwise intercept all pointer events, blocking marquee selection).
 */
const noopSubscribe = () => () => {};

function CanvasPortal() {
  // Browser-only render gate via useSyncExternalStore so we don't
  // trip the no-setState-in-effect lint rule.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );

  if (!mounted) return null;

  // Inset to match the shell's content-panel geometry (sidebar width + gap on
  // the left, top-bar height + gap on top, small gap on the right/bottom) and
  // clip to the rounded panel. The Canvas resizes to this box automatically via
  // its ResizeObserver, and pointer math uses getBoundingClientRect so the
  // offset is handled. Still portaled to <body> so it escapes the z-[2] chrome
  // layer and receives marquee/drag events.
  return createPortal(
    <div className="fixed top-[60px] right-2 bottom-2 left-2 md:left-[264px] z-[1] overflow-hidden rounded-2xl border border-border-subtle bg-[var(--bg-elevated)] shadow-[var(--shadow-panel)]">
      <Canvas />
    </div>,
    document.body
  );
}

interface Props {
  userId: string;
  workspaceId: string;
  workspaceSlug: string;
  canvasSlug: string;
  initialState: CanvasState;
  initialConversations: ServerConversation[];
}

export default function CanvasClientShell({
  userId,
  workspaceId,
  workspaceSlug,
  canvasSlug,
  initialState,
  initialConversations,
}: Props) {
  return (
    <CanvasProvider
      userId={userId}
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      canvasSlug={canvasSlug}
      initialState={initialState}
      initialConversations={initialConversations}
    >
      <DrawerProvider>
        <CanvasGridSync />
        <LayoutSnapshotSync
          workspaceSlug={workspaceSlug}
          canvasSlug={canvasSlug}
        />
        <CanvasPortal />
        <FixedInputBar />
        <FixedChatPanel />
        <PaywallGate />
      </DrawerProvider>
    </CanvasProvider>
  );
}

function LayoutSnapshotSync({
  workspaceSlug,
  canvasSlug,
}: {
  workspaceSlug: string;
  canvasSlug: string;
}) {
  useLayoutSnapshot(workspaceSlug, canvasSlug);
  return null;
}
