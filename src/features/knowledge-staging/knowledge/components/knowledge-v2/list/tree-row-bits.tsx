"use client";

/** STAGING (new with the overhaul, PORTING.md): the tree rows' small parts, split from `tree-rows.tsx` for the 500-line cap. */
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { FilePlus, FolderPlus } from "lucide-react";
import { SMALL_PILL_BUTTON, SMALL_PILL_ICON } from "@/shared/ui/small-action-button";
import styles from "../knowledge-v2.module.css";

type CreateFolder = (parentId: string | null, name: string) => Promise<string>;
type CreateEntry = (folderId: string | null, title: string) => Promise<string>;

/**
 * One create flow for the base root and every folder: one write at a time, and a new folder is
 * stub-marked so Escape removes the empty placeholder. `beforeCreate` runs first (a folder reveals
 * itself, or its new child would land hidden).
 */
export function useTreeCreate({
  parentId,
  onCreateFolder,
  onCreateEntry,
  beginStubEdit,
  beforeCreate,
}: {
  parentId: string | null;
  onCreateFolder: CreateFolder;
  onCreateEntry: CreateEntry;
  beginStubEdit: (id: string) => void;
  beforeCreate?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const create = async (kind: "entry" | "folder") => {
    if (busy) return;
    setBusy(true);
    beforeCreate?.();
    try {
      if (kind === "folder") {
        beginStubEdit(await onCreateFolder(parentId, "Untitled folder"));
      } else {
        await onCreateEntry(parentId, "Untitled entry");
      }
    } catch {
      // Parent toasts.
    } finally {
      setBusy(false);
    }
  };
  return { busy, create };
}

/** Enter and Space press a row the way a click does; keys from a control inside it are its own. */
export function pressOnKey(onPress: (() => void) | undefined) {
  if (!onPress) return undefined;
  return (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    onPress();
  };
}

/** Base-root create affordance, on the kit's outlined pill. Folder rows handle their own children on hover. */
export function AddRow({
  onCreateFolder,
  onCreateEntry,
  beginStubEdit,
}: {
  onCreateFolder: CreateFolder;
  onCreateEntry: CreateEntry;
  beginStubEdit: (id: string) => void;
}) {
  const { busy, create } = useTreeCreate({
    parentId: null,
    onCreateFolder,
    onCreateEntry,
    beginStubEdit,
  });
  return (
    <div className={styles.addRow}>
      <button
        type="button"
        className={SMALL_PILL_BUTTON}
        disabled={busy}
        onClick={() => create("entry")}
      >
        <FilePlus size={SMALL_PILL_ICON} aria-hidden="true" /> New file
      </button>
      <button
        type="button"
        className={SMALL_PILL_BUTTON}
        disabled={busy}
        onClick={() => create("folder")}
      >
        <FolderPlus size={SMALL_PILL_ICON} aria-hidden="true" /> New folder
      </button>
    </div>
  );
}

/** Icon button kept out of the row's own button semantics: no nesting. */
export function RowIconBtn({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      disabled={disabled}
      className={styles.treeActionBtn}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      {children}
    </button>
  );
}
