"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

const MENU_W = 224;
const MENU_MAX_H = 256;

export interface PickMenuItem {
  id: string;
  name: string;
  /** Items are grouped under click-to-expand section rows. */
  group: string;
}

interface Props {
  items: PickMenuItem[];
  onPick: (id: string) => void;
  /** Already-selected ids — hidden from the menu. */
  excludeIds?: string[];
  trigger: ReactNode;
  triggerClassName?: string;
}

/**
 * Small click-driven picker: the trigger opens a compact menu of groups;
 * clicking a group expands its items beneath it; clicking an item picks
 * it. No hover-expansion — every level opens on click.
 */
export function PickMenu({
  items,
  onPick,
  excludeIds = [],
  trigger,
  triggerClassName,
}: Props) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const excluded = new Set(excludeIds);
  const visible = items.filter((i) => !excluded.has(i.id));
  const groups = [...new Set(visible.map((i) => i.group))];

  const close = () => {
    setAnchor(null);
    setOpenGroup(null);
  };

  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor((prev) => (prev ? null : { x: rect.left, y: rect.bottom + 4 }));
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {anchor &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={rootRef}
            className="fixed z-[9999] overflow-y-auto rounded-xl border border-black/[0.12] bg-[#fbfcfd] p-1 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_10px_28px_rgba(0,0,0,0.14)]"
            style={{
              width: MENU_W,
              maxHeight: MENU_MAX_H,
              left: Math.min(anchor.x, window.innerWidth - MENU_W - 16),
              top: Math.min(anchor.y, window.innerHeight - MENU_MAX_H - 16),
            }}
          >
            {groups.length === 0 && (
              <p className="px-2 py-1.5 text-[13px] text-[#98a2ad]">
                Nothing available to add
              </p>
            )}
            {groups.map((group) => {
              const open = group === openGroup;
              const groupItems = visible.filter((i) => i.group === group);
              return (
                <div key={group}>
                  <button
                    type="button"
                    onClick={() => setOpenGroup(open ? null : group)}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-semibold transition-colors",
                      open
                        ? "text-[#232a31]"
                        : "text-[#646d78] hover:bg-black/[0.04] hover:text-[#232a31]"
                    )}
                  >
                    <ChevronRight
                      size={11}
                      className={cn(
                        "shrink-0 text-[#98a2ad] transition-transform",
                        open && "rotate-90"
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{group}</span>
                    <span className="text-[11.5px] font-normal text-[#98a2ad]">
                      {groupItems.length}
                    </span>
                  </button>
                  {open &&
                    groupItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onPick(item.id);
                          close();
                        }}
                        className="flex w-full items-center rounded-lg py-1.5 pr-2 pl-6 text-left text-[13.5px] text-[#646d78] transition-colors hover:bg-black/[0.04] hover:text-[#232a31]"
                      >
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      </button>
                    ))}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
