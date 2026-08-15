"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { InlineEditableRow } from "@/shared/ui/inline-editable-row";
import type { KnowledgeEntry, KnowledgeFolder } from "../../../types";
import { TreeContextMenu, type ContextMenuItem } from "../../tree-context-menu";
import styles from "../knowledge-v2.module.css";

interface Props {
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  selectedEntryId: string | null;
  canEdit: boolean;
  editingNodeId: string | null;
  onSelect: (entryId: string) => void;
  onCreateFolder: (parentId: string | null, name: string) => Promise<string>;
  onCreateEntry: (folderId: string | null, title: string) => Promise<string>;
  onRename: (item: ContextMenuItem) => void;
  onRequestMove: (item: ContextMenuItem) => void;
  onDelete: (item: ContextMenuItem) => void;
  onDownload: (item: ContextMenuItem) => void;
  onCommitRename: (item: ContextMenuItem, name: string) => Promise<void>;
  onCancelStub: (item: ContextMenuItem) => Promise<void>;
  onClearEditing: () => void;
}

interface InlineCtx {
  editingId: string | null;
  canEdit: boolean;
  isStub: (id: string) => boolean;
  beginStubEdit: (id: string) => void;
  commitRename: (item: ContextMenuItem, name: string) => Promise<void>;
  cancelStub: (item: ContextMenuItem) => Promise<void>;
  clearEditing: () => void;
  exitEdit: (id: string) => void;
}

const Ctx = createContext<InlineCtx | null>(null);
const useInline = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useInline outside TreeRows");
  return v;
};

function indexByParent(folders: KnowledgeFolder[]) {
  const map = new Map<string | null, KnowledgeFolder[]>();
  for (const f of folders.sort((a, b) => a.position - b.position)) {
    const arr = map.get(f.parentId) ?? [];
    arr.push(f);
    map.set(f.parentId, arr);
  }
  return map;
}
function indexByFolder(entries: KnowledgeEntry[]) {
  const map = new Map<string | null, KnowledgeEntry[]>();
  for (const e of entries.sort((a, b) => a.position - b.position)) {
    const arr = map.get(e.folderId) ?? [];
    arr.push(e);
    map.set(e.folderId, arr);
  }
  return map;
}

const pad = (depth: number) => ({ paddingLeft: 28 + depth * 15 });

/**
 * Folder/entry tree for one knowledge base. Right-click (or hover "⋯") opens
 * rename/move/delete/download; folder hover reveals +entry / +folder; renames
 * and fresh-create stubs edit inline. No drag-drop, by design.
 */
export function TreeRows({
  folders,
  entries,
  selectedEntryId,
  canEdit,
  editingNodeId,
  onSelect,
  onCreateFolder,
  onCreateEntry,
  onRename,
  onRequestMove,
  onDelete,
  onDownload,
  onCommitRename,
  onCancelStub,
  onClearEditing,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [stubIds, setStubIds] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    item: ContextMenuItem;
  } | null>(null);

  const childFolders = useMemo(() => indexByParent(folders), [folders]);
  const childEntries = useMemo(() => indexByFolder(entries), [entries]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openMenu = (e: MouseEvent, item: ContextMenuItem) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, item });
  };

  const dropStub = (id: string) =>
    setStubIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const inline: InlineCtx = useMemo(
    () => ({
      editingId: editingNodeId,
      canEdit,
      isStub: (id) => stubIds.has(id),
      beginStubEdit: (id) =>
        setStubIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id))),
      commitRename: async (item, name) => {
        await onCommitRename(item, name);
        dropStub(item.id);
      },
      cancelStub: async (item) => {
        await onCancelStub(item);
        dropStub(item.id);
      },
      clearEditing: onClearEditing,
      exitEdit: (id) => {
        dropStub(id);
        onClearEditing();
      },
    }),
    [editingNodeId, canEdit, stubIds, onCommitRename, onCancelStub, onClearEditing]
  );

  return (
    <Ctx.Provider value={inline}>
      <div className={styles.tree}>
        <Children
          parentId={null}
          depth={0}
          childFolders={childFolders}
          childEntries={childEntries}
          expanded={expanded}
          toggle={toggle}
          selectedEntryId={selectedEntryId}
          onSelect={onSelect}
          onCreateFolder={onCreateFolder}
          onCreateEntry={onCreateEntry}
          openMenu={openMenu}
        />
        {canEdit ? (
          <AddRow onCreateFolder={onCreateFolder} onCreateEntry={onCreateEntry} />
        ) : childFolders.size === 0 && childEntries.size === 0 ? (
          <p className={styles.treeEmpty}>Empty knowledge base</p>
        ) : null}
      </div>

      {menu ? (
        <TreeContextMenu
          x={menu.x}
          y={menu.y}
          item={menu.item}
          canEdit={canEdit}
          onRename={onRename}
          onMove={onRequestMove}
          onDelete={onDelete}
          onDownload={onDownload}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </Ctx.Provider>
  );
}

interface ChildrenProps {
  parentId: string | null;
  depth: number;
  childFolders: Map<string | null, KnowledgeFolder[]>;
  childEntries: Map<string | null, KnowledgeEntry[]>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  selectedEntryId: string | null;
  onSelect: (entryId: string) => void;
  onCreateFolder: (parentId: string | null, name: string) => Promise<string>;
  onCreateEntry: (folderId: string | null, title: string) => Promise<string>;
  openMenu: (e: MouseEvent, item: ContextMenuItem) => void;
}

function Children(props: ChildrenProps) {
  const { parentId, depth, childFolders, childEntries, expanded } = props;
  const folders = childFolders.get(parentId) ?? [];
  const entries = childEntries.get(parentId) ?? [];

  return (
    <>
      {folders.map((folder) => (
        <div key={folder.id}>
          <FolderRow {...props} folder={folder} isOpen={expanded.has(folder.id)} />
          {expanded.has(folder.id) ? (
            <Children {...props} parentId={folder.id} depth={depth + 1} />
          ) : null}
        </div>
      ))}
      {entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          depth={depth}
          isSelected={entry.id === props.selectedEntryId}
          onSelect={() => props.onSelect(entry.id)}
          openMenu={props.openMenu}
        />
      ))}
    </>
  );
}

function FolderRow({
  folder,
  depth,
  isOpen,
  toggle,
  onCreateFolder,
  onCreateEntry,
  openMenu,
}: ChildrenProps & { folder: KnowledgeFolder; isOpen: boolean }) {
  const inline = useInline();
  const item: ContextMenuItem = { type: "folder", id: folder.id, label: folder.name };
  const isEditing = inline.editingId === folder.id;
  const [busy, setBusy] = useState(false);

  const create = async (kind: "entry" | "folder") => {
    if (busy) return;
    setBusy(true);
    // ⚠ Reveal: creating inside a collapsed folder would hide the child.
    if (!isOpen) toggle(folder.id);
    try {
      if (kind === "folder") {
        // Auto inline-rename (controller sets editingNodeId); marked a stub
        // so Escape removes the empty placeholder.
        const id = await onCreateFolder(folder.id, "Untitled folder");
        inline.beginStubEdit(id);
      } else {
        await onCreateEntry(folder.id, "Untitled entry");
      }
    } catch {
      // Parent toasts.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(styles.treeRow, styles.treeRowGroup)}
      style={pad(depth)}
      onClick={isEditing ? undefined : () => toggle(folder.id)}
      onContextMenu={(e) => openMenu(e, item)}
    >
      <ChevronRight
        size={13}
        className={cn(styles.treeChevron, isOpen && styles.treeChevronOpen)}
      />
      {isOpen ? (
        <FolderOpen size={14} className="leaf" />
      ) : (
        <Folder size={14} className="leaf" />
      )}
      {isEditing ? (
        <RowEditor folder={folder} item={item} />
      ) : (
        <span className={styles.treeLabel}>{folder.name}</span>
      )}
      {!isEditing ? (
        <span className={styles.treeRowActions}>
          {inline.canEdit ? (
            <>
              <RowIconBtn title="New entry" disabled={busy} onClick={() => create("entry")}>
                <FilePlus size={13} />
              </RowIconBtn>
              <RowIconBtn title="New folder" disabled={busy} onClick={() => create("folder")}>
                <FolderPlus size={13} />
              </RowIconBtn>
            </>
          ) : null}
          <RowIconBtn title="More" onClick={(e) => openMenu(e, item)}>
            <MoreHorizontal size={13} />
          </RowIconBtn>
        </span>
      ) : null}
    </div>
  );
}

function EntryRow({
  entry,
  depth,
  isSelected,
  onSelect,
  openMenu,
}: {
  entry: KnowledgeEntry;
  depth: number;
  isSelected: boolean;
  onSelect: () => void;
  openMenu: (e: MouseEvent, item: ContextMenuItem) => void;
}) {
  const inline = useInline();
  const item: ContextMenuItem = { type: "entry", id: entry.id, label: entry.title };
  const isEditing = inline.editingId === entry.id;

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        styles.treeRow,
        styles.treeRowGroup,
        isSelected && styles.treeRowActive
      )}
      style={pad(depth)}
      onClick={isEditing ? undefined : onSelect}
      onContextMenu={(e) => openMenu(e, item)}
    >
      <span className={styles.treeChevron} />
      <FileText size={14} className="leaf" />
      {isEditing ? (
        <RowEditor entry={entry} item={item} />
      ) : (
        <span className={styles.treeLabel}>{entry.title}</span>
      )}
      {!isEditing ? (
        <span className={styles.treeRowActions}>
          <RowIconBtn title="More" onClick={(e) => openMenu(e, item)}>
            <MoreHorizontal size={13} />
          </RowIconBtn>
        </span>
      ) : null}
    </div>
  );
}

/** Inline rename input wired to the shared inline-edit context. */
function RowEditor({
  folder,
  entry,
  item,
}: {
  folder?: KnowledgeFolder;
  entry?: KnowledgeEntry;
  item: ContextMenuItem;
}) {
  const inline = useInline();
  const value = folder?.name ?? entry?.title ?? "";
  return (
    <InlineEditableRow
      value={value}
      selectAllOnMount
      maxLength={200}
      ariaLabel={folder ? "Folder name" : "Entry title"}
      className={styles.treeLabel}
      onCommit={async (next) => {
        await inline.commitRename(item, next);
        inline.clearEditing();
      }}
      onCancel={
        inline.isStub(item.id)
          ? async () => {
              await inline.cancelStub(item);
              inline.clearEditing();
            }
          : () => inline.clearEditing()
      }
      onExit={() => inline.exitEdit(item.id)}
    />
  );
}

/** Base-root create affordance: parentless folders/entries. Folder rows
 *  handle their own children on hover. */
function AddRow({
  onCreateFolder,
  onCreateEntry,
}: {
  onCreateFolder: (parentId: string | null, name: string) => Promise<string>;
  onCreateEntry: (folderId: string | null, title: string) => Promise<string>;
}) {
  const inline = useInline();
  const [busy, setBusy] = useState(false);
  const create = async (kind: "entry" | "folder") => {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === "folder") {
        const id = await onCreateFolder(null, "Untitled folder");
        inline.beginStubEdit(id);
      } else {
        await onCreateEntry(null, "Untitled entry");
      }
    } catch {
      // Parent toasts.
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.addRow}>
      <button
        type="button"
        className={styles.addBtn}
        disabled={busy}
        onClick={() => create("entry")}
      >
        <FilePlus size={13} /> New file
      </button>
      <button
        type="button"
        className={styles.addBtn}
        disabled={busy}
        onClick={() => create("folder")}
      >
        <FolderPlus size={13} /> New folder
      </button>
    </div>
  );
}

/** ⚠ Icon button rendered as a <span>: rows are <button>, no nesting. */
function RowIconBtn({
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
      className={cn(styles.treeActionBtn, disabled && styles.treeActionDisabled)}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick(e);
      }}
    >
      {children}
    </button>
  );
}
