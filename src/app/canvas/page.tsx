"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { CanvasProvider } from "@/components/canvas/canvas-store";
import { CanvasGridSync } from "@/components/canvas/canvas-grid-sync";
import { Canvas } from "@/components/canvas/canvas";
import { FixedInputBar } from "@/components/canvas/fixed-input-bar";
import { OnboardingProvider } from "@/components/onboarding/onboarding-provider";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

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

export default function CanvasPage() {
  const [userId, setUserId] = useState<string | undefined>();
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    getSupabaseBrowser()
      .auth.getUser()
      .then(({ data }: { data: { user: { id: string } | null } }) => {
        if (data.user) setUserId(data.user.id);
      })
      .finally(() => setAuthReady(true));
  }, []);

  // Don't render CanvasProvider until auth resolves — otherwise useReducer
  // initializes with userId=undefined, loads from the wrong localStorage key,
  // and never re-initializes when userId arrives, causing data loss on reload.
  if (!authReady) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground text-sm">Loading canvas...</div>
      </div>
    );
  }

  return (
    <CanvasProvider userId={userId}>
      <OnboardingProvider userId={userId}>
        <CanvasGridSync />
        <CanvasPortal />
        <FixedInputBar />
      </OnboardingProvider>
    </CanvasProvider>
  );
}
