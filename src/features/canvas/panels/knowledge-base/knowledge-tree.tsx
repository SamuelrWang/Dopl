"use client";

import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";
import { InlineEditableRow } from "@/shared/ui/inline-editable-row";

// ── Tree builder ─────────────────────────────────────────────────────

export interface TreeNode {
  kind: "folder" | "entry";
  id: string;
  name: string;
  /** For folders, sub-children. For entries, undefined. */
  children?: TreeNode[];
  /** Reference to the original row for action callbacks. */
  folder?: KnowledgeFolder;
  entry?: KnowledgeEntry;
}

export function buildTree(
  folders: KnowledgeFolder[],
  entries: KnowledgeEntry[]
): { rootChildren: TreeNode[] } {
  const folderMap = new Map<string, TreeNode>();
  for (const f of folders) {
    folderMap.set(f.id, {
      kind: "folder",
      id: f.id,
      name: f.name,
      children: [],
      folder: f,
    });
  }
  const rootChildren: TreeNode[] = [];
  for (const f of folders) {
    const node = folderMap.get(f.id)!;
    if (f.parentId && folderMap.has(f.parentId)) {
      folderMap.get(f.parentId)!.children!.push(node);
    } else {
      rootChildren.push(node);
    }
  }
  for (const e of entries) {
    const node: TreeNode = {
      kind: "entry",
      id: e.id,
      name: e.title,
      entry: e,
    };
    if (e.folderId && folderMap.has(e.folderId)) {
      folderMap.get(e.folderId)!.children!.push(node);
    } else {
      rootChildren.push(node);
    }
  }
  // Sort: folders first, then entries; within each, by position then name.
  function sort(arr: TreeNode[]) {
    arr.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      const posA = a.folder?.position ?? a.entry?.position ?? 0;
      const posB = b.folder?.position ?? b.entry?.position ?? 0;
      if (posA !== posB) return posA - posB;
      return a.name.localeCompare(b.name);
    });
    for (const n of arr) if (n.children) sort(n.children);
  }
  sort(rootChildren);
  return { rootChildren };
}

export interface TreeNodesProps {
  nodes: TreeNode[];
  expanded: Set<string>;
  selectedEntryId: string | null;
  onToggle: (id: string) => void;
  onSelectEntry: (id: string) => void;
  onAddEntry: (folderId: string | null) => void;
  onAddFolder: (parentId: string | null) => void;
  onDeleteEntry: (entry: KnowledgeEntry) => void;
  onDeleteFolder: (folder: KnowledgeFolder) => void;
  /** Node currently in inline-edit mode (set by add-then-rename flow). */
  editing: { kind: "folder" | "entry"; id: string } | null;
  onCommitRename: (
    kind: "folder" | "entry",
    id: string,
    next: string
  ) => Promise<void>;
  onCancelStub: (kind: "folder" | "entry", id: string) => Promise<void>;
  /** Audit A-005 — gates the in-row "+ entry" / "delete" affordances.
   *  Read-only members render labels only. */
  canEdit: boolean;
  /** Pointer-down hook for dragging an entry row out of the tree into a
   *  node block's Read zone (file chip). */
  onFileDragStart: (e: React.PointerEvent, node: TreeNode) => void;
  depth: number;
}

export function TreeNodes(props: TreeNodesProps) {
  return (
    <>
      {props.nodes.map((node) =>
        node.kind === "folder" ? (
          <FolderRow key={node.id} node={node} {...props} />
        ) : (
          <EntryRow key={node.id} node={node} {...props} />
        )
      )}
    </>
  );
}

function FolderRow({ node, ...props }: { node: TreeNode } & TreeNodesProps) {
  const isOpen = props.expanded.has(node.id);
  const padding = 8 + props.depth * 12;
  const isEditing =
    props.editing?.kind === "folder" && props.editing.id === node.id;
  return (
    <div className="px-1">
      <div
        className="group flex items-center gap-1 rounded text-[12px] text-text-secondary transition-colors hover:bg-surface-raised-2"
        style={{ paddingLeft: padding }}
      >
        {isEditing ? (
          <div className="flex flex-1 items-center gap-1 py-1">
            <ChevronRight size={11} className="shrink-0 text-text-muted" />
            <Folder size={12} className="shrink-0 text-text-tertiary" />
            <InlineEditableRow
              value={node.name}
              selectAllOnMount
              maxLength={200}
              ariaLabel="Folder name"
              onCommit={(next) =>
                props.onCommitRename("folder", node.id, next)
              }
              onCancel={() => props.onCancelStub("folder", node.id)}
              className="flex-1"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => props.onToggle(node.id)}
            className="flex flex-1 items-center gap-1 py-1 text-left"
          >
            {isOpen ? (
              <ChevronDown size={11} className="shrink-0 text-text-muted" />
            ) : (
              <ChevronRight size={11} className="shrink-0 text-text-muted" />
            )}
            {isOpen ? (
              <FolderOpen size={12} className="shrink-0 text-text-tertiary" />
            ) : (
              <Folder size={12} className="shrink-0 text-text-tertiary" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
        )}
        {!isEditing && props.canEdit && (
          <div className="hidden shrink-0 items-center gap-0.5 pr-1 group-hover:flex">
            <IconButton
              label="New entry"
              onClick={(e) => {
                e.stopPropagation();
                props.onAddEntry(node.id);
              }}
            >
              <Plus size={10} />
            </IconButton>
            <IconButton
              label="Delete folder"
              onClick={(e) => {
                e.stopPropagation();
                if (node.folder) props.onDeleteFolder(node.folder);
              }}
            >
              <Trash2 size={10} />
            </IconButton>
          </div>
        )}
      </div>
      {isOpen && node.children && node.children.length > 0 && (
        <TreeNodes {...props} nodes={node.children} depth={props.depth + 1} />
      )}
    </div>
  );
}

function EntryRow({ node, ...props }: { node: TreeNode } & TreeNodesProps) {
  const padding = 22 + props.depth * 12;
  const active = props.selectedEntryId === node.id;
  const isEditing =
    props.editing?.kind === "entry" && props.editing.id === node.id;
  return (
    <div className="px-1">
      <div
        className={`group flex items-center gap-1 rounded text-[11.5px] transition-colors ${
          active
            ? "bg-surface-selected text-text-primary"
            : "text-text-tertiary hover:bg-surface-raised-1 hover:text-text-secondary"
        }`}
        style={{ paddingLeft: padding }}
      >
        {isEditing ? (
          <div className="flex flex-1 items-center gap-1.5 py-1">
            <FileText size={10} className="shrink-0 text-text-muted" />
            <InlineEditableRow
              value={node.name}
              selectAllOnMount
              maxLength={300}
              ariaLabel="Entry title"
              onCommit={(next) =>
                props.onCommitRename("entry", node.id, next)
              }
              onCancel={() => props.onCancelStub("entry", node.id)}
              className="flex-1"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => props.onSelectEntry(node.id)}
            onPointerDown={(e) => props.onFileDragStart(e, node)}
            className="flex flex-1 items-center gap-1.5 py-1 text-left"
          >
            <FileText size={10} className="shrink-0 text-text-muted" />
            <span className="truncate">{node.name}</span>
          </button>
        )}
        {!isEditing && props.canEdit && (
          <div className="hidden shrink-0 items-center gap-0.5 pr-1 group-hover:flex">
            <IconButton
              label="Delete entry"
              onClick={(e) => {
                e.stopPropagation();
                if (node.entry) props.onDeleteEntry(node.entry);
              }}
            >
              <Trash2 size={10} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-surface-raised-3 hover:text-text-secondary"
    >
      {children}
    </button>
  );
}
