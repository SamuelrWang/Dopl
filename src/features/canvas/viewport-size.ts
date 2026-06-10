"use client";

/**
 * Size of the visible canvas viewport. The canvas no longer fills the
 * window — it's inset to the AppShell's white-panel rect — so camera
 * math (spawn-at-center, frame-panel) must use the viewport's real
 * dimensions, not window.innerWidth/Height (which would land panels
 * ~280px right / ~45px below the visual center). Falls back to window
 * dims when the viewport isn't mounted (SSR, tests).
 */
export function getCanvasViewportSize(): { vw: number; vh: number } {
  if (typeof window === "undefined") return { vw: 1200, vh: 800 };
  const el = document.querySelector("[data-canvas-viewport]");
  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { vw: rect.width, vh: rect.height };
    }
  }
  return { vw: window.innerWidth, vh: window.innerHeight };
}
