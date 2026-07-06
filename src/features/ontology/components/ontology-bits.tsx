"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { OBJECT_TYPES } from "../seed";
import type { ObjectTypeId } from "../types";

/** Shared atoms — study-notes design language, verbatim. */

/** Floating bento card (study-notes `.bento`). */
export function Bento({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[14px] border border-black/[0.08] bg-[#fbfcfd] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_18px_rgba(0,0,0,0.05)]",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Bordered section — the study-notes intro-panel, verbatim: uppercase
 * label strip (card-2) over a concave inset body.
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
  return (
    <section className="w-full overflow-hidden rounded-[14px] border border-black/[0.12]">
      <div className="flex items-center gap-2 bg-[#f4f6f9] px-4 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#646d78]">
          {label}
        </span>
        {meta && <span className="text-[11px] text-[#98a2ad]">{meta}</span>}
        <span className="flex-1" />
        {action}
      </div>
      <div className="border-t border-black/[0.06] bg-[#eef1f5] shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),inset_0_1px_2px_rgba(0,0,0,0.06),inset_0_-1px_0_rgba(255,255,255,0.9)]">
        {children}
      </div>
    </section>
  );
}

/** Concave input well — study-notes auth-field treatment for add-row fields. */
export const FIELD_WELL =
  "rounded-lg border border-black/[0.06] bg-[#e9eaec] shadow-[inset_0_2px_4px_rgba(0,0,0,0.13),inset_0_1px_2px_rgba(0,0,0,0.07),inset_0_-1px_0_rgba(255,255,255,0.9)] focus:border-black/[0.22] focus:outline-none";

/** Raised chip sitting on an inset body — verse-pill on a concave field. */
export const CHIP =
  "rounded-full border border-black/[0.12] bg-[#fbfcfd] px-2.5 py-0.5 text-xs font-medium text-[#232a31] shadow-[0_1px_2px_rgba(0,0,0,0.05)]";

/** Small colored dot for an object type (rail rows, cluster map). */
export function TypeDot({ type }: { type: ObjectTypeId }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: OBJECT_TYPES[type].border }}
      aria-hidden
    />
  );
}

