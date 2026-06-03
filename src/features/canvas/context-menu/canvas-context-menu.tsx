"use client";

/**
 * CanvasContextMenu — custom right-click (two-finger click) menu for the
 * canvas background. Replaces the native browser context menu with a
 * Cursor-style command palette: a "Start typing..." pill above a list of
 * create / frame / paste / chat / report actions, with hover-out submenus
 * for the three "Create" rows.
 *
 * Static UI for now — items don't dispatch anything yet. Closes on click
 * outside, Escape, or selecting any leaf action.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronRight, ArrowUp } from "lucide-react";
import { MENU_SECTIONS, type MenuItem, type Submenu } from "./menu-data";

const MENU_WIDTH = 200;

interface Props {
  x: number;
  y: number;
  onClose: () => void;
}

export function CanvasContextMenu({ x, y, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<MenuItem | null>(null);

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
  }, [onClose]);

  // Keep the menu inside the viewport — flip horizontally / clamp vertically.
  const left = Math.min(x, window.innerWidth - MENU_WIDTH - 12);
  const top = Math.min(y, window.innerHeight - 320);

  return (
    <div
      ref={rootRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: "fixed", left, top, width: MENU_WIDTH, zIndex: 99999 }}
      className="flex flex-col gap-1.5 select-none"
    >
      {/* Start typing pill */}
      <div className="flex items-center gap-1.5 h-[34px] pl-3.5 pr-1 rounded-[14px] bg-[#1c1c1e] border border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
        <input
          autoFocus
          placeholder="Start typing..."
          className="flex-1 bg-transparent text-[12px] text-white/90 outline-none placeholder:text-white/35"
        />
        <button
          type="button"
          aria-label="Submit"
          className="flex items-center justify-center w-6 h-6 rounded-full bg-white/[0.08] text-white/45 hover:bg-white/[0.14] transition-colors shrink-0"
        >
          <ArrowUp className="w-3 h-3" />
        </button>
      </div>

      {/* Action list */}
      <div className="relative rounded-[12px] bg-[#1a1a1a] border border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.5)] p-1">
        {MENU_SECTIONS.map((section, si) => (
          <div key={si}>
            {si > 0 && <div className="my-1.5 h-px bg-white/[0.07]" />}
            {section.map((item) => (
              <MenuRow
                key={item.id}
                item={item}
                active={openSubmenu?.id === item.id}
                onHover={() => setOpenSubmenu(item.submenu ? item : null)}
                onSelect={() => {
                  if (!item.submenu) onClose();
                }}
              />
            ))}
          </div>
        ))}

        {openSubmenu?.submenu && (
          <SubmenuPanel submenu={openSubmenu.submenu} onSelect={onClose} />
        )}
      </div>
    </div>
  );
}

function MenuRow({
  item,
  active,
  onHover,
  onSelect,
}: {
  item: MenuItem;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={onSelect}
      className={`group flex w-full items-center gap-2 h-8 px-2 rounded-[8px] text-[12px] transition-colors ${
        active ? "bg-white text-black" : "text-white/90 hover:bg-white hover:text-black"
      }`}
    >
      <Icon className="w-[14px] h-[14px] shrink-0" strokeWidth={1.8} />
      <span className="flex-1 text-left">{item.label}</span>
      {item.submenu && <ChevronRight className="w-3 h-3 shrink-0 opacity-60" />}
      {item.shortcut && (
        <span
          className={`text-[11px] tabular-nums ${
            active ? "text-black/45" : "text-white/35 group-hover:text-black/45"
          }`}
        >
          {item.shortcut}
        </span>
      )}
    </button>
  );
}

function SubmenuPanel({
  submenu,
  onSelect,
}: {
  submenu: Submenu;
  onSelect: () => void;
}) {
  return (
    <div
      className="absolute left-full top-1 ml-1 w-[140px] rounded-[12px] bg-[#1a1a1a] border border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.5)] p-1"
      style={{ zIndex: 1 }}
    >
      <div className="px-2 pt-1 pb-1 text-[9px] font-medium uppercase tracking-wider text-white/35">
        {submenu.title}
      </div>
      {submenu.groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="my-1 h-px bg-white/[0.07]" />}
          {group.map((label) => (
            <button
              key={label}
              type="button"
              onClick={onSelect}
              className="flex w-full items-center h-7 px-2 rounded-[8px] text-[12px] text-white/90 hover:bg-white hover:text-black transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
