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
import { FixedBrainPanel } from "@/features/canvas/fixed-brain-panel";
import { DrawerProvider } from "@/features/canvas/chat-drawer-context";
import { OnboardingProvider } from "@/features/onboarding/components/onboarding-provider";
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

  return createPortal(
    <div className="fixed inset-0 z-[1]">
      <Canvas />
    </div>,
    document.body
  );
}

interface Props {
  userId: string;
  workspaceId: string;
  canvasSlug: string;
  initialState: CanvasState;
  initialConversations: ServerConversation[];
}

export default function CanvasClientShell({
  userId,
  workspaceId,
  canvasSlug,
  initialState,
  initialConversations,
}: Props) {
  return (
    <CanvasProvider
      userId={userId}
      workspaceId={workspaceId}
      canvasSlug={canvasSlug}
      initialState={initialState}
      initialConversations={initialConversations}
    >
      <DrawerProvider>
        <OnboardingProvider userId={userId}>
          <CanvasGridSync />
          <LayoutSnapshotSync canvasSlug={canvasSlug} />
          <CanvasPortal />
          <FixedInputBar />
          <FixedChatPanel />
          <FixedBrainPanel />
          <PaywallGate />
        </OnboardingProvider>
      </DrawerProvider>
    </CanvasProvider>
  );
}

function LayoutSnapshotSync({ canvasSlug }: { canvasSlug: string }) {
  useLayoutSnapshot(canvasSlug);
  return null;
}
