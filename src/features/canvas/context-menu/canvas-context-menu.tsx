"use client";

/**
 * CanvasContextMenu — custom right-click / double-click menu for empty
 * canvas space. A flat action list (New cluster / New chat / browsers);
 * every row fires `onAction(id)` and closes. Clamped to the viewport via
 * useClampedFixedPosition; closes on click outside or Escape.
 */

import { useEffect } from "react";
import { useClampedFixedPosition } from "@/shared/hooks/use-clamped-fixed-position";
import { MENU_SECTIONS, type MenuItem, type MenuItemId } from "./menu-data";

const MENU_WIDTH = 200;

interface Props {
  x: number;
  y: number;
  onAction: (id: MenuItemId) => void;
  onClose: () => void;
}

export function CanvasContextMenu({ x, y, onAction, onClose }: Props) {
  const { ref: rootRef, style: clampStyle } =
    useClampedFixedPosition<HTMLDivElement>(x, y, 12);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, rootRef]);

  return (
    <div
      ref={rootRef}
      onContextMenu={(e) => e.preventDefault()}
      // Stop pointer events from reaching the canvas viewport: without
      // this, pressing a menu item starts a marquee / cluster drag and
      // the viewport's pointer capture retargets the click away from
      // the button (same guard as SelectionMenu).
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      style={{ ...clampStyle, width: MENU_WIDTH, zIndex: 99999 }}
      className="select-none"
    >
      <div className="relative rounded-[12px] bg-bg-inset border border-border-subtle shadow-[0_10px_40px_rgba(0,0,0,0.18)] p-1">
        {MENU_SECTIONS.map((section, si) => (
          <div key={si}>
            {si > 0 && <div className="my-1.5 h-px bg-surface-raised-3" />}
            {section.map((item) => (
              <MenuRow
                key={item.id}
                item={item}
                onSelect={() => {
                  onClose();
                  onAction(item.id);
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MenuRow({ item, onSelect }: { item: MenuItem; onSelect: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full items-center gap-2 h-8 px-2 rounded-[8px] text-[12px] text-text-primary hover:bg-surface-invert hover:text-text-on-invert transition-colors cursor-pointer"
    >
      <Icon className="w-[14px] h-[14px] shrink-0" strokeWidth={1.8} />
      <span className="flex-1 text-left">{item.label}</span>
      {item.shortcut && (
        <span className="text-[11px] tabular-nums text-text-muted group-hover:text-text-on-invert/45">
          {item.shortcut}
        </span>
      )}
    </button>
  );
}
