"use client";

import { Download, Edit2, FolderInput, Trash2 } from "lucide-react";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";

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
  /** Folder zips its subtree, entry exports one `.md`. Always available —
   *  read action, independent of `canEdit`. */
  onDownload: (item: ContextMenuItem) => void;
  onClose: () => void;
  /** False hides Rename / Move / Delete entirely: caller is read-only and the
   *  server would reject anyway (Audit A-013). ⚠ While the access fetch is
   *  pending pass `true`, or admins/owners flash an actions-less menu. */
  canEdit?: boolean;
}

/**
 * Cursor-anchored context menu for tree rows: shared Popover in coordinate
 * mode, so it clamps to the viewport and closes on click-outside, Escape, or
 * a menu-item click.
 */
export function TreeContextMenu({
  x,
  y,
  item,
  onRename,
  onMove,
  onDelete,
  onDownload,
  onClose,
  canEdit = true,
}: Props) {
  return (
    <Popover open at={{ x, y }} onClose={onClose}>
      <MenuItem
        icon={<Download size={12} />}
        onSelect={() => {
          onClose();
          onDownload(item);
        }}
      >
        {item.type === "folder" ? "Download as .zip" : "Download .md"}
      </MenuItem>
      {canEdit ? (
        <>
          <div className="mx-1 my-1 h-px bg-surface-raised-3" />
          <MenuItem
            icon={<Edit2 size={12} />}
            onSelect={() => {
              onClose();
              onRename(item);
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            icon={<FolderInput size={12} />}
            onSelect={() => {
              onClose();
              onMove(item);
            }}
          >
            Move to…
          </MenuItem>
          <div className="mx-1 my-1 h-px bg-surface-raised-3" />
          <MenuItem
            destructive
            icon={<Trash2 size={12} />}
            onSelect={() => {
              onClose();
              onDelete(item);
            }}
          >
            Delete
          </MenuItem>
        </>
      ) : (
        <div className="px-3 py-1.5 text-label text-text-secondary/70">
          Read-only — ask an admin for edit access.
        </div>
      )}
    </Popover>
  );
}
