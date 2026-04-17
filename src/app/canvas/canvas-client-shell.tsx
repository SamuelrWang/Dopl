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
import { useEffect, useState } from "react";
import { CanvasProvider } from "@/components/canvas/canvas-store";
import { CanvasGridSync } from "@/components/canvas/canvas-grid-sync";
import { Canvas } from "@/components/canvas/canvas";
import { FixedInputBar } from "@/components/canvas/fixed-input-bar";
import { FixedChatPanel } from "@/components/canvas/fixed-chat-panel";
import { FixedBrainPanel } from "@/components/canvas/fixed-brain-panel";
import { DrawerProvider } from "@/components/canvas/chat-drawer-context";
import { OnboardingProvider } from "@/components/onboarding/onboarding-provider";
import { PaywallGate } from "@/components/billing/paywall-gate";
import type { CanvasState } from "@/components/canvas/types";
import type { ServerConversation } from "@/components/canvas/use-conversation-sync";

/**
 * The canvas renders via a portal to document.body so it escapes the root
 * layout's <main> wrapper (which sits inside a z-[2] stacking context and
 * would otherwise intercept all pointer events, blocking marquee selection).
 */
function CanvasPortal() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
  initialState: CanvasState;
  initialConversations: ServerConversation[];
}

export default function CanvasClientShell({
  userId,
  initialState,
  initialConversations,
}: Props) {
  return (
    <CanvasProvider
      userId={userId}
      initialState={initialState}
      initialConversations={initialConversations}
    >
      <DrawerProvider>
        <OnboardingProvider userId={userId}>
          <CanvasGridSync />
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
