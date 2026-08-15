"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Pencil,
} from "lucide-react";
import { DESCRIPTION_MAX } from "@/config";
import { cn } from "@/shared/lib/utils";
import { SectionBox } from "@/shared/ui/section-box";
import type { KnowledgeEntry, KnowledgeFolder } from "../../../types";
import type { BaseTree } from "../types";
import {
  useContentDescriptions,
  type ContentNodeType,
} from "./use-content-descriptions";

interface Props {
  /** Selected base's tree, reused from the controller (no extra fetch). */
  tree: BaseTree | undefined;
  baseId: string;
  workspaceId: string;
  /** Owners/editors may edit descriptions; viewers are read-only. */
  canEdit: boolean;
  /** Refresh the base's tree after a description save. */
  onTreeRefresh: (baseId: string) => void;
}

function byPosition<T extends { position: number }>(a: T, b: T): number {
  return a.position - b.position;
}

/**
 * Base overview "Contents" tree: every folder + entry with an inline-editable
 * short description (folders → `description`, entries → `excerpt`). These are
 * the same summaries agents read in MCP get_tree / list_dir.
 */
export function OverviewContents({
  tree,
  baseId,
  workspaceId,
  canEdit,
  onTreeRefresh,
}: Props) {
  const ready = tree?.status === "ready";
  const folders = useMemo(() => (ready ? tree!.folders : []), [ready, tree]);
  const entries = useMemo(() => (ready ? tree!.entries : []), [ready, tree]);

  const { resolve, save, savingId } = useContentDescriptions({
    baseId,
    workspaceId,
    folders,
    entries,
    onTreeRefresh,
  });

  // ⚠ Track COLLAPSED folders, not expanded ones, so folders default open —
  // including any streaming in after an async tree load.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const childFolders = useMemo(() => {
    const map = new Map<string | null, KnowledgeFolder[]>();
    for (const f of [...folders].sort(byPosition)) {
      const arr = map.get(f.parentId) ?? [];
      arr.push(f);
      map.set(f.parentId, arr);
    }
    return map;
  }, [folders]);
  const childEntries = useMemo(() => {
    const map = new Map<string | null, KnowledgeEntry[]>();
    for (const e of [...entries].sort(byPosition)) {
      const arr = map.get(e.folderId) ?? [];
      arr.push(e);
      map.set(e.folderId, arr);
    }
    return map;
  }, [entries]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const meta = ready
    ? `${folders.length} ${folders.length === 1 ? "folder" : "folders"} · ${entries.length} ${entries.length === 1 ? "file" : "files"}`
    : undefined;

  function renderRows(parentId: string | null, depth: number): ReactNode[] {
    const rows: ReactNode[] = [];
    for (const f of childFolders.get(parentId) ?? []) {
      const open = !collapsed.has(f.id);
      const desc = resolve(f.id, f.description);
      rows.push(
        <ContentRow
          key={`f-${f.id}`}
          type="folder"
          id={f.id}
          name={f.name}
          description={desc}
          depth={depth}
          canEdit={canEdit}
          isEditing={editingId === f.id}
          isSaving={savingId === f.id}
          folderOpen={open}
          onToggle={() => toggle(f.id)}
          onBeginEdit={() => setEditingId(f.id)}
          onCommit={async (value) => {
            setEditingId(null);
            await save("folder", f.id, desc, value);
          }}
          onCancel={() => setEditingId(null)}
        />
      );
      if (open) rows.push(...renderRows(f.id, depth + 1));
    }
    for (const e of childEntries.get(parentId) ?? []) {
      const desc = resolve(e.id, e.excerpt);
      rows.push(
        <ContentRow
          key={`e-${e.id}`}
          type="entry"
          id={e.id}
          name={e.title}
          description={desc}
          depth={depth}
          canEdit={canEdit}
          isEditing={editingId === e.id}
          isSaving={savingId === e.id}
          onBeginEdit={() => setEditingId(e.id)}
          onCommit={async (value) => {
            setEditingId(null);
            await save("entry", e.id, desc, value);
          }}
          onCancel={() => setEditingId(null)}
        />
      );
    }
    return rows;
  }

  const isEmpty = ready && folders.length === 0 && entries.length === 0;

  return (
    <SectionBox label="Contents" meta={meta}>
      <div className="px-1.5 py-1.5">
        {tree?.status === "loading" || tree === undefined ? (
          <p className="px-3 py-2 text-caption text-text-muted">Loading contents…</p>
        ) : tree.status === "error" ? (
          <p className="px-3 py-2 text-caption text-text-muted">
            Couldn&apos;t load the contents.
          </p>
        ) : isEmpty ? (
          <p className="px-3 py-2 text-caption text-text-muted">
            No folders or files yet.
          </p>
        ) : (
          renderRows(null, 0)
        )}
      </div>
    </SectionBox>
  );
}

interface RowProps {
  type: ContentNodeType;
  id: string;
  name: string;
  description: string | null;
  depth: number;
  canEdit: boolean;
  isEditing: boolean;
  isSaving: boolean;
  folderOpen?: boolean;
  onToggle?: () => void;
  onBeginEdit: () => void;
  onCommit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}

function ContentRow({
  type,
  name,
  description,
  depth,
  canEdit,
  isEditing,
  isSaving,
  folderOpen,
  onToggle,
  onBeginEdit,
  onCommit,
  onCancel,
}: RowProps) {
  const isFolder = type === "folder";
  return (
    <div
      className="group flex items-start gap-2 rounded-md py-1 pr-2 transition-colors hover:bg-surface-raised-1"
      style={{ paddingLeft: 10 + depth * 16 }}
    >
      {isFolder ? (
        <button
          type="button"
          aria-label={folderOpen ? "Collapse folder" : "Expand folder"}
          className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center text-text-muted hover:text-text-secondary"
          onClick={onToggle}
        >
          <ChevronRight
            size={13}
            className={cn(
              "transition-transform",
              folderOpen && "rotate-90"
            )}
          />
        </button>
      ) : (
        <span className="h-4 w-4 flex-none" />
      )}

      {isFolder ? (
        folderOpen ? (
          <FolderOpen size={14} className="mt-0.5 flex-none text-text-muted" />
        ) : (
          <Folder size={14} className="mt-0.5 flex-none text-text-muted" />
        )
      ) : (
        <FileText size={14} className="mt-0.5 flex-none text-text-muted" />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-small text-text-primary">{name}</span>
          {canEdit && !isEditing ? (
            <button
              type="button"
              aria-label="Edit description"
              title="Edit description"
              className="flex-none text-text-muted opacity-0 transition-opacity hover:text-text-secondary group-hover:opacity-100"
              onClick={onBeginEdit}
            >
              <Pencil size={11} />
            </button>
          ) : null}
        </div>

        {isEditing ? (
          <DescriptionField
            value={description ?? ""}
            saving={isSaving}
            onCommit={onCommit}
            onCancel={onCancel}
          />
        ) : description ? (
          <button
            type="button"
            disabled={!canEdit}
            className={cn(
              "truncate text-left text-caption text-text-secondary",
              canEdit && "cursor-text hover:text-text-primary",
              !canEdit && "cursor-default"
            )}
            onClick={canEdit ? onBeginEdit : undefined}
          >
            {description}
          </button>
        ) : canEdit ? (
          <button
            type="button"
            className="w-fit text-left text-caption italic text-text-muted opacity-0 transition-opacity hover:text-text-secondary group-hover:opacity-100"
            onClick={onBeginEdit}
          >
            Add description
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** In-place editor for a folder description / entry excerpt. */
function DescriptionField({
  value,
  saving,
  onCommit,
  onCancel,
}: {
  value: string;
  saving: boolean;
  onCommit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const settledRef = useRef(false);
  const cancelledRef = useRef(false);
  const composingRef = useRef(false);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    void onCommit(draft);
  };
  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // ⚠ IME guard: skip Enter while composing (matches InlineEditableRow).
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelledRef.current = true;
      inputRef.current?.blur();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      disabled={saving}
      maxLength={DESCRIPTION_MAX}
      aria-label="Description"
      placeholder="Short summary agents see in the tree"
      className={cn(
        "concave-field w-full rounded-md px-2 py-1 text-caption text-text-primary",
        "placeholder:text-text-muted focus:outline-none disabled:opacity-60"
      )}
      onChange={(e) => setDraft(e.target.value)}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (cancelledRef.current) cancel();
        else commit();
      }}
    />
  );
}
