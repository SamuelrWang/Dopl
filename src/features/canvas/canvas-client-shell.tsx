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
import shellStyles from "@/shared/layout/app-shell/app-shell.module.css";
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

  // Inset to the AppShell's white-panel rect (single-sourced via the
  // --app-panel-* vars in globals.css) so the canvas sits exactly where the
  // shell's main panel would be. z-[31] floats above the AppShell root
  // (z-30) but below modals (z-40). The lightScope class re-themes every
  // token-based panel/overlay inside to the new light palette. The Canvas
  // resizes to this box automatically via its ResizeObserver, and pointer
  // math uses getBoundingClientRect so the offset is handled. Still portaled
  // to <body> so the shell chrome can never intercept marquee/drag events.
  return createPortal(
    <div
      className={`${shellStyles.lightScope} canvas-surface canvas-surface-light fixed z-[31] overflow-hidden border border-border-subtle shadow-[var(--shadow-panel)]`}
      style={{
        top: "var(--app-panel-top)",
        left: "var(--app-panel-left)",
        right: "var(--app-panel-right)",
        bottom: "var(--app-panel-bottom)",
        borderRadius: "var(--shell-panel-radius) 8px 8px 8px",
      }}
    >
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
        {/* Fixed overlays render outside the portal; the wrapper div has no
            layout but carries the light token scope so they match the new
            canvas palette. */}
        <div className={shellStyles.lightScope}>
          <FixedInputBar />
          <FixedChatPanel />
        </div>
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
