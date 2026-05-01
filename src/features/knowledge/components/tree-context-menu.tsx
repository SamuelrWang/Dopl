"use client";

import { useEffect, useRef } from "react";
import { Edit2, FolderInput, Trash2 } from "lucide-react";

export interface ContextMenuItem {
  type: "folder" | "entry";
  id: string;
  label: string;
}

interface Props {
  /** Anchor coords in viewport pixels. */
  x: number;
  y: number;
  item: ContextMenuItem;
  onRename: (item: ContextMenuItem) => void;
  onMove: (item: ContextMenuItem) => void;
  onDelete: (item: ContextMenuItem) => void;
  onClose: () => void;
}

/**
 * Inline absolute-positioned context menu for tree rows. Closes on
 * click-outside, Escape, or a menu-item click.
 *
 * Kept dead simple — no Popover / portal — to match the existing
 * codebase pattern (see workspace dropdown in sidebar.tsx). Polish
 * pass can swap in base-ui Popover for proper a11y + portal anchoring.
 */
export function TreeContextMenu({
  x,
  y,
  item,
  onRename,
  onMove,
  onDelete,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: x, top: y }}
      className="fixed z-[1000] min-w-[160px] rounded-md border border-white/[0.1] bg-[oklch(0.16_0_0)] shadow-2xl shadow-black/60 py-1"
    >
      <MenuItem
        icon={<Edit2 size={12} />}
        label="Rename"
        onClick={() => {
          onClose();
          onRename(item);
        }}
      />
      <MenuItem
        icon={<FolderInput size={12} />}
        label="Move to…"
        onClick={() => {
          onClose();
          onMove(item);
        }}
      />
      <div className="my-1 mx-1 h-px bg-white/[0.06]" />
      <MenuItem
        icon={<Trash2 size={12} />}
        label="Delete"
        onClick={() => {
          onClose();
          onDelete(item);
        }}
        destructive
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={
        destructive
          ? "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/[0.08] cursor-pointer"
          : "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-white/[0.04] hover:text-text-primary cursor-pointer"
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
