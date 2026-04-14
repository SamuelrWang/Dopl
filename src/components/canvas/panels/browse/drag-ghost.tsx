"use client";

import { useRef, useImperativeHandle, forwardRef } from "react";
import { createPortal } from "react-dom";
import type { BrowseEntry } from "./use-browse-state";

const platformLabels: Record<string, string> = {
  x: "X",
  instagram: "IG",
  reddit: "Reddit",
  github: "GitHub",
  web: "Web",
};

export interface DragGhostHandle {
  updatePosition: (x: number, y: number) => void;
  show: (entry: BrowseEntry) => void;
  hide: () => void;
}

export const DragGhost = forwardRef<DragGhostHandle>(function DragGhost(_, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    updatePosition(x: number, y: number) {
      if (containerRef.current) {
        containerRef.current.style.left = `${x}px`;
        containerRef.current.style.top = `${y}px`;
      }
    },
    show(entry: BrowseEntry) {
      if (!contentRef.current || !containerRef.current) return;
      const platform = entry.source_platform || "web";
      const label = platformLabels[platform] || "Web";
      contentRef.current.innerHTML = `
        <span class="font-mono text-[8px] uppercase tracking-wider text-white/60 bg-white/[0.08] px-1.5 py-0.5 rounded-[2px]">${label}</span>
        <span class="text-[11px] text-white/90 font-medium line-clamp-1 leading-tight">${entry.title || "Untitled"}</span>
      `;
      containerRef.current.style.display = "flex";
    },
    hide() {
      if (containerRef.current) {
        containerRef.current.style.display = "none";
      }
    },
  }));

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={containerRef}
      style={{
        display: "none",
        position: "fixed",
        transform: "translate(-50%, -50%)",
        zIndex: 99999,
        pointerEvents: "none",
      }}
      className="flex items-center gap-2 px-3 py-2 rounded-[6px] bg-black/80 backdrop-blur-md border border-white/[0.15] shadow-xl max-w-[200px]"
    >
      <div ref={contentRef} className="flex items-center gap-2 min-w-0" />
    </div>,
    document.body,
  );
});
