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
  /** When false, hide write actions (Rename / Move / Delete) entirely
   *  — the user is read-only on this resource and the server would
   *  reject the call anyway. (Audit A-013.) When the access fetch is
   *  still pending, treat as `true` so admins/owners don't see a
   *  flash of an actions-less menu. */
  canEdit?: boolean;
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
  canEdit = true,
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
      className="fixed z-[1000] min-w-[160px] rounded-md border border-border-default bg-[var(--bg-inset-hover)] shadow-2xl shadow-black/60 py-1"
    >
      {canEdit ? (
        <>
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
          <div className="my-1 mx-1 h-px bg-surface-raised-3" />
          <MenuItem
            icon={<Trash2 size={12} />}
            label="Delete"
            onClick={() => {
              onClose();
              onDelete(item);
            }}
            destructive
          />
        </>
      ) : (
        <div className="px-3 py-1.5 text-[11px] text-text-secondary/70">
          Read-only — ask an admin for edit access.
        </div>
      )}
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
          : "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary cursor-pointer"
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
