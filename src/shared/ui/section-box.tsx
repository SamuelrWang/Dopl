"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

const MIN_BODY_H = 56;

/**
 * SectionBox's concave-body recipe. Exported so sibling section patterns (e.g.
 * chats header-card disclosures) reuse it instead of forking the shadow stack.
 */
export const SECTION_BOX_INSET =
  "border-t border-border-subtle bg-bg-inset shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),inset_0_1px_2px_rgba(0,0,0,0.06),inset_0_-1px_0_rgba(255,255,255,0.9)]";

/**
 * Bordered section — uppercase label strip over a concave inset body, with a
 * corner grip that drag-resizes the body (clamped to its content height).
 */
export function SectionBox({
  label,
  meta,
  action,
  children,
}: {
  label: string;
  meta?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  const onGripDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = bodyRef.current;
    if (!el) return;
    const startY = e.clientY;
    const base = el.offsetHeight;
    const max = el.scrollHeight;
    const move = (ev: PointerEvent) => {
      setHeight(Math.min(Math.max(base + ev.clientY - startY, MIN_BODY_H), max));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <section className="w-full overflow-hidden rounded-[14px] border border-border-strong">
      <div className="flex items-center gap-2 bg-card-surface-subtle px-4 py-1.5">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          {label}
        </span>
        {meta && <span className="text-caption text-text-muted">{meta}</span>}
        <span className="flex-1" />
        {action}
      </div>
      <div className="relative">
        <div
          ref={bodyRef}
          style={height !== null ? { height } : undefined}
          className={cn(
            SECTION_BOX_INSET,
            height !== null && "overflow-y-auto overscroll-contain"
          )}
        >
          {children}
        </div>
        <button
          type="button"
          onPointerDown={onGripDown}
          title="Drag to resize"
          aria-label={`Resize ${label}`}
          className="absolute right-1.5 bottom-1.5 z-10 flex h-4 w-4 cursor-ns-resize items-center justify-center text-text-muted hover:text-text-secondary"
        >
          <ResizeGrip />
        </button>
      </div>
    </section>
  );
}

/** Diagonal corner grip — two slanted lines facing up-left. */
function ResizeGrip() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 11 11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 10 10 4M7.5 10 10 7.5" />
    </svg>
  );
}
