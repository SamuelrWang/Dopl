"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { CanvasProvider } from "@/components/canvas/canvas-store";
import { CanvasGridSync } from "@/components/canvas/canvas-grid-sync";
import { Canvas } from "@/components/canvas/canvas";
import { FixedInputBar } from "@/components/canvas/fixed-input-bar";

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

export default function IngestPage() {
  return (
    <CanvasProvider>
      <CanvasGridSync />
      <CanvasPortal />
      <FixedInputBar />
    </CanvasProvider>
  );
}
