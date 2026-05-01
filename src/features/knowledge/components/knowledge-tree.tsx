"use client";

/**
 * Folder/entry tree for a single knowledge base, with drag-drop reparenting.
 *
 * Tree is built in render from flat `folders` / `entries` arrays —
 * folders nest via `parent_id`, entries attach via `folder_id`. Expand
 * state is per-folder, persisted in localStorage keyed by base id.
 *
 * Drag-drop:
 *   - Folders + entries are draggable.
 *   - Folders + the base root are droppable.
 *   - Drop ID encoding: `folder:<uuid>` for folders, `entry:<uuid>`
 *     for entries, `root` for the base-root drop zone.
 *
 * Cycle prevention is enforced server-side (Item 2 returns 409
 * `KNOWLEDGE_FOLDER_CYCLE`). The UI surfaces it as a toast.
 */

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type {
  KnowledgeEntry,
  KnowledgeFolder,
} from "../types";
import { TreeContextMenu, type ContextMenuItem } from "./tree-context-menu";

interface Props {
  baseId: string;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  selectedEntryId: string | null;
  onSelect: (entryId: string) => void;
  onCreateFolder: (parentId: string | null, name: string) => Promise<void>;
  onCreateEntry: (folderId: string | null, title: string) => Promise<void>;
  onMoveFolder: (folderId: string, newParentId: string | null) => Promise<void>;
  onMoveEntry: (entryId: string, newFolderId: string | null) => Promise<void>;
  /** Context-menu actions — opened by right-click or "More" button. */
  onRename: (item: ContextMenuItem) => void;
  onRequestMove: (item: ContextMenuItem) => void;
  onDelete: (item: ContextMenuItem) => void;
}

interface DragItem {
  type: "folder" | "entry";
  id: string;
  label: string;
}

export function KnowledgeTree({
  baseId,
  folders,
  entries,
  selectedEntryId,
  onSelect,
  onCreateFolder,
  onCreateEntry,
  onMoveFolder,
  onMoveEntry,
  onRename,
  onRequestMove,
  onDelete,
}: Props) {
  const [expanded, setExpanded] = useExpandedFolders(baseId);
  const [active, setActive] = useState<DragItem | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    item: ContextMenuItem;
  } | null>(null);

  // Index for cheap lookups during rendering / drag handling.
  const childFolders = useMemo(() => indexByParent(folders), [folders]);
  const childEntries = useMemo(() => indexByFolder(entries), [entries]);

  function openMenu(e: React.MouseEvent, item: ContextMenuItem) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, item });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDragStart(event: DragStartEvent) {
    const idStr = String(event.active.id);
    if (idStr.startsWith("folder:")) {
      const id = idStr.slice("folder:".length);
      const folder = folders.find((f) => f.id === id);
      if (folder) setActive({ type: "folder", id, label: folder.name });
    } else if (idStr.startsWith("entry:")) {
      const id = idStr.slice("entry:".length);
      const entry = entries.find((e) => e.id === id);
      if (entry) setActive({ type: "entry", id, label: entry.title });
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActive(null);
    if (!event.over) return;
    const activeIdStr = String(event.active.id);
    const overIdStr = String(event.over.id);

    // Decode the target. `root` means base root; otherwise it's a folder id.
    const newParent: string | null =
      overIdStr === "root"
        ? null
        : overIdStr.startsWith("folder:")
          ? overIdStr.slice("folder:".length)
          : null;
    if (overIdStr !== "root" && !overIdStr.startsWith("folder:")) return;

    if (activeIdStr.startsWith("folder:")) {
      const id = activeIdStr.slice("folder:".length);
      if (id === newParent) return; // no-op self drop
      await onMoveFolder(id, newParent);
    } else if (activeIdStr.startsWith("entry:")) {
      const id = activeIdStr.slice("entry:".length);
      await onMoveEntry(id, newParent);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <RootDropZone>
        <FolderChildren
          parentId={null}
          depth={0}
          folders={childFolders.get(null) ?? []}
          entries={childEntries.get(null) ?? []}
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
      </RootDropZone>

      <DragOverlay>
        {active ? (
          <div className="flex items-center gap-2 rounded-md bg-[oklch(0.16_0_0)] border border-white/[0.15] px-2 py-1 text-xs text-text-primary shadow-2xl">
            {active.type === "folder" ? (
              <Folder size={12} className="text-text-secondary/70" />
            ) : (
              <FileText size={12} className="text-violet-300" />
            )}
            <span className="truncate max-w-[200px]">{active.label}</span>
          </div>
        ) : null}
      </DragOverlay>

      {menu ? (
        <TreeContextMenu
          x={menu.x}
          y={menu.y}
          item={menu.item}
          onRename={onRename}
          onMove={onRequestMove}
          onDelete={onDelete}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </DndContext>
  );
}

// ── Root drop zone ──────────────────────────────────────────────────

function RootDropZone({ children }: { children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id: "root" });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-1 min-h-0 overflow-y-auto py-2 transition-colors",
        isOver && "bg-violet-500/[0.04]"
      )}
    >
      {children}
    </div>
  );
}

// ── Folder children (recursive) ─────────────────────────────────────

interface FolderChildrenProps {
  parentId: string | null;
  depth: number;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  childFolders: Map<string | null, KnowledgeFolder[]>;
  childEntries: Map<string | null, KnowledgeEntry[]>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  selectedEntryId: string | null;
  onSelect: (entryId: string) => void;
  onCreateFolder: (parentId: string | null, name: string) => Promise<void>;
  onCreateEntry: (folderId: string | null, title: string) => Promise<void>;
  openMenu: (e: React.MouseEvent, item: ContextMenuItem) => void;
}

function FolderChildren(props: FolderChildrenProps) {
  const {
    parentId,
    depth,
    folders,
    entries,
    childFolders,
    childEntries,
    expanded,
    toggle,
    selectedEntryId,
    onSelect,
    onCreateFolder,
    onCreateEntry,
    openMenu,
  } = props;

  return (
    <>
      {folders.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          depth={depth}
          isOpen={expanded.has(folder.id)}
          onToggle={() => toggle(folder.id)}
          onCreateFolder={onCreateFolder}
          onCreateEntry={onCreateEntry}
          openMenu={openMenu}
        >
          {expanded.has(folder.id) ? (
            <FolderChildren
              parentId={folder.id}
              depth={depth + 1}
              folders={childFolders.get(folder.id) ?? []}
              entries={childEntries.get(folder.id) ?? []}
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
          ) : null}
        </FolderRow>
      ))}
      {entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          depth={depth}
          isSelected={entry.id === selectedEntryId}
          onSelect={() => onSelect(entry.id)}
          openMenu={openMenu}
        />
      ))}
      {/* Inline "new folder/entry" affordance at this level. */}
      <AddRowAffordance
        depth={depth}
        parentFolderId={parentId}
        onCreateFolder={onCreateFolder}
        onCreateEntry={onCreateEntry}
      />
    </>
  );
}

// ── Folder row ──────────────────────────────────────────────────────

interface FolderRowProps {
  folder: KnowledgeFolder;
  depth: number;
  isOpen: boolean;
  onToggle: () => void;
  onCreateFolder: (parentId: string, name: string) => Promise<void>;
  onCreateEntry: (folderId: string, title: string) => Promise<void>;
  openMenu: (e: React.MouseEvent, item: ContextMenuItem) => void;
  children?: React.ReactNode;
}

function FolderRow({
  folder,
  depth,
  isOpen,
  onToggle,
  onCreateFolder,
  onCreateEntry,
  openMenu,
  children,
}: FolderRowProps) {
  const ctxItem: ContextMenuItem = {
    type: "folder",
    id: folder.id,
    label: folder.name,
  };
  const dragId = `folder:${folder.id}`;
  const drag = useDraggable({ id: dragId });
  const drop = useDroppable({ id: dragId });

  const dragStyle: React.CSSProperties = drag.transform
    ? {
        transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`,
        opacity: 0.4,
      }
    : {};

  return (
    <>
      <div
        ref={(node) => {
          drag.setNodeRef(node);
          drop.setNodeRef(node);
        }}
        style={{ ...dragStyle, paddingLeft: `${8 + depth * 16}px` }}
        className={cn(
          "group flex items-center gap-1.5 pr-2 py-1 text-xs transition-colors cursor-pointer",
          drop.isOver
            ? "bg-violet-500/[0.08] text-text-primary"
            : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary"
        )}
        onContextMenu={(e) => openMenu(e, ctxItem)}
        {...drag.listeners}
        {...drag.attributes}
      >
        <button
          type="button"
          aria-label={isOpen ? "Collapse folder" : "Expand folder"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="shrink-0 w-4 h-4 rounded flex items-center justify-center hover:bg-white/[0.06]"
        >
          {isOpen ? (
            <ChevronDown size={11} className="text-text-secondary/70" />
          ) : (
            <ChevronRight size={11} className="text-text-secondary/70" />
          )}
        </button>
        {isOpen ? (
          <FolderOpen size={12} className="shrink-0 text-text-secondary/70" />
        ) : (
          <Folder size={12} className="shrink-0 text-text-secondary/70" />
        )}
        <span className="truncate flex-1">{folder.name}</span>
        <FolderRowActions
          folderId={folder.id}
          onCreateFolder={onCreateFolder}
          onCreateEntry={onCreateEntry}
          onMore={(e) => openMenu(e, ctxItem)}
        />
      </div>
      {children}
    </>
  );
}

function FolderRowActions({
  folderId,
  onCreateFolder,
  onCreateEntry,
  onMore,
}: {
  folderId: string;
  onCreateFolder: (parentId: string, name: string) => Promise<void>;
  onCreateEntry: (folderId: string, title: string) => Promise<void>;
  onMore: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
      <button
        type="button"
        title="New entry"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={async (e) => {
          e.stopPropagation();
          const title = window.prompt("Entry title");
          if (title?.trim()) await onCreateEntry(folderId, title.trim());
        }}
        className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/[0.06]"
      >
        <Plus size={10} className="text-text-secondary/70" />
      </button>
      <button
        type="button"
        title="New folder"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={async (e) => {
          e.stopPropagation();
          const name = window.prompt("Folder name");
          if (name?.trim()) await onCreateFolder(folderId, name.trim());
        }}
        className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/[0.06]"
      >
        <Folder size={10} className="text-text-secondary/70" />
      </button>
      <button
        type="button"
        title="More"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onMore(e);
        }}
        className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/[0.06]"
      >
        <MoreHorizontal size={10} className="text-text-secondary/70" />
      </button>
    </div>
  );
}

// ── Entry row ───────────────────────────────────────────────────────

interface EntryRowProps {
  entry: KnowledgeEntry;
  depth: number;
  isSelected: boolean;
  onSelect: () => void;
  openMenu: (e: React.MouseEvent, item: ContextMenuItem) => void;
}

function EntryRow({ entry, depth, isSelected, onSelect, openMenu }: EntryRowProps) {
  const { setNodeRef, listeners, attributes, transform } = useDraggable({
    id: `entry:${entry.id}`,
  });
  const dragStyle: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: 0.4,
      }
    : {};
  const ctxItem: ContextMenuItem = {
    type: "entry",
    id: entry.id,
    label: entry.title,
  };

  return (
    <div
      ref={setNodeRef}
      style={{ ...dragStyle, paddingLeft: `${8 + depth * 16 + 16}px` }}
      className={cn(
        "group flex items-center gap-2 pr-2 py-1 text-xs transition-colors cursor-pointer",
        isSelected
          ? "bg-white/[0.06] text-text-primary"
          : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary"
      )}
      onClick={onSelect}
      onContextMenu={(e) => openMenu(e, ctxItem)}
      {...listeners}
      {...attributes}
    >
      <FileText
        size={12}
        className={cn(
          "shrink-0",
          isSelected ? "text-violet-300" : "text-text-secondary/60"
        )}
      />
      <span className="truncate flex-1">{entry.title}</span>
      <button
        type="button"
        aria-label="More"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          openMenu(e, ctxItem);
        }}
        className="shrink-0 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] transition-opacity cursor-pointer"
      >
        <MoreHorizontal size={10} className="text-text-secondary/70" />
      </button>
    </div>
  );
}

// ── Inline "new ..." affordance ─────────────────────────────────────

function AddRowAffordance({
  depth,
  parentFolderId,
  onCreateFolder,
  onCreateEntry,
}: {
  depth: number;
  parentFolderId: string | null;
  onCreateFolder: (parentId: string | null, name: string) => Promise<void>;
  onCreateEntry: (folderId: string | null, title: string) => Promise<void>;
}) {
  // Only show at root level — folder rows have their own "+" buttons.
  if (depth > 0) return null;
  return (
    <div className="flex items-center gap-1 px-2 py-1.5">
      <button
        type="button"
        onClick={async () => {
          const title = window.prompt("Entry title");
          if (title?.trim()) await onCreateEntry(parentFolderId, title.trim());
        }}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-text-secondary/70 hover:text-text-primary hover:bg-white/[0.04] cursor-pointer"
      >
        <Plus size={10} />
        New entry
      </button>
      <button
        type="button"
        onClick={async () => {
          const name = window.prompt("Folder name");
          if (name?.trim()) await onCreateFolder(parentFolderId, name.trim());
        }}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-text-secondary/70 hover:text-text-primary hover:bg-white/[0.04] cursor-pointer"
      >
        <Folder size={10} />
        New folder
      </button>
    </div>
  );
}

// ── State / utilities ───────────────────────────────────────────────

/**
 * Per-base expand/collapse state, persisted to localStorage so the
 * tree shape survives reloads.
 *
 * Hydration is two-phase to avoid a server/client mismatch:
 *   - Initial render: empty Set (matches SSR output where window is
 *     undefined; otherwise React would warn about a different tree
 *     between server and client on hydration).
 *   - After mount: load from localStorage and bump state.
 */
function useExpandedFolders(
  baseId: string
): [Set<string>, React.Dispatch<React.SetStateAction<Set<string>>>] {
  const storageKey = `kb-tree:${baseId}:expanded`;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Hydrate from localStorage after mount. The setState-in-effect
  // lint rule is suppressed here because this IS the canonical
  // pattern for syncing hydration-unsafe storage with React state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (arr.length > 0) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setExpanded(new Set(arr));
        }
      }
    } catch {
      // Ignore parse errors — start fresh.
    }
  }, [storageKey]);

  // Persist on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...expanded]));
    } catch {
      // Quota exceeded or storage disabled — ignore.
    }
  }, [expanded, storageKey]);

  return [expanded, setExpanded];
}

function indexByParent(
  folders: KnowledgeFolder[]
): Map<string | null, KnowledgeFolder[]> {
  const map = new Map<string | null, KnowledgeFolder[]>();
  for (const f of folders) {
    const arr = map.get(f.parentId) ?? [];
    arr.push(f);
    map.set(f.parentId, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }
  return map;
}

function indexByFolder(
  entries: KnowledgeEntry[]
): Map<string | null, KnowledgeEntry[]> {
  const map = new Map<string | null, KnowledgeEntry[]>();
  for (const e of entries) {
    const arr = map.get(e.folderId) ?? [];
    arr.push(e);
    map.set(e.folderId, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  }
  return map;
}
