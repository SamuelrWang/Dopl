"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type { KnowledgeBasePanelData } from "../../types";
import { useCanvasScope } from "../../canvas-store";
import { ClusterAttachmentBanner } from "../cluster-attachment-banner";
import { useKnowledgeTree } from "@/features/knowledge/client/hooks";
import { useKnowledgeRealtime } from "@/features/knowledge/client/realtime";
import {
  KnowledgeApiError,
  createEntry,
  createFolder,
  deleteEntry,
  deleteFolder,
  fetchEntry,
  updateBase,
  updateEntry,
} from "@/features/knowledge/client/api";
import type {
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";

interface Props {
  panel: KnowledgeBasePanelData;
}

export function KnowledgeBasePanelBody({ panel }: Props) {
  const scope = useCanvasScope();
  const { data, status, error, refetch } = useKnowledgeTree(
    panel.knowledgeBaseId,
    scope?.workspaceId
  );
  useKnowledgeRealtime(scope?.workspaceId, refetch);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["__root__"]));
  const [agentToggling, setAgentToggling] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(panel.agentWriteEnabled);

  useEffect(() => {
    setAgentEnabled(panel.agentWriteEnabled);
  }, [panel.agentWriteEnabled]);

  // Auto-select the first entry when the tree loads, so the right pane
  // doesn't sit empty.
  useEffect(() => {
    if (selectedEntryId) return;
    if (data && data.entries.length > 0) {
      setSelectedEntryId(data.entries[0].id);
    }
  }, [data, selectedEntryId]);

  const tree = useMemo(() => buildTree(data?.folders ?? [], data?.entries ?? []), [data]);

  function toggleFolder(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAddFolder(parentId: string | null) {
    const name = window.prompt("Folder name");
    if (!name || !name.trim()) return;
    try {
      await createFolder(panel.knowledgeBaseId, {
        parentId,
        name: name.trim(),
        position: 0,
      });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create folder");
    }
  }

  async function handleAddEntry(folderId: string | null) {
    const title = window.prompt("Entry title");
    if (!title || !title.trim()) return;
    try {
      const entry = await createEntry(panel.knowledgeBaseId, {
        folderId,
        title: title.trim(),
        excerpt: null,
        body: "",
        entryType: "note",
        position: 0,
      });
      refetch();
      setSelectedEntryId(entry.id);
      if (folderId) {
        setExpanded((prev) => new Set(prev).add(folderId));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create entry");
    }
  }

  async function handleDeleteEntry(entry: KnowledgeEntry) {
    if (!confirm(`Delete entry "${entry.title}"?`)) return;
    try {
      await deleteEntry(entry.id);
      if (selectedEntryId === entry.id) setSelectedEntryId(null);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleDeleteFolder(folder: KnowledgeFolder) {
    if (!confirm(`Delete folder "${folder.name}" and its contents?`)) return;
    try {
      await deleteFolder(folder.id);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleAgentToggle() {
    setAgentToggling(true);
    const next = !agentEnabled;
    setAgentEnabled(next);
    try {
      await updateBase(panel.knowledgeBaseId, { agentWriteEnabled: next });
    } catch (err) {
      setAgentEnabled(!next);
      alert(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setAgentToggling(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <ClusterAttachmentBanner panelId={panel.id} />
      {/* Sub-header: KB metadata */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-white/90">
              {data?.base.name ?? panel.name}
            </h2>
            <button
              type="button"
              onClick={handleAgentToggle}
              disabled={agentToggling}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors ${
                agentEnabled
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300/90 hover:bg-emerald-400/15"
                  : "border-white/[0.08] bg-white/[0.02] text-white/40 hover:text-white/65"
              }`}
            >
              <Bot size={9} />
              {agentEnabled ? "Agent: on" : "Agent: off"}
            </button>
          </div>
          {(data?.base.description ?? panel.description) && (
            <p className="mt-0.5 truncate text-[11px] text-white/45">
              {data?.base.description ?? panel.description}
            </p>
          )}
        </div>
      </div>

      {status === "error" && (
        <div className="border-b border-white/[0.06] bg-red-500/5 px-4 py-2 text-[11px] text-red-400">
          {error?.message || "Failed to load this knowledge base"}
        </div>
      )}

      {/* Two-column body */}
      <div className="flex flex-1 min-h-0">
        {/* Tree */}
        <div className="w-[210px] shrink-0 overflow-y-auto border-r border-white/[0.06] py-2">
          {status === "loading" && !data && (
            <div className="px-3 text-[11px] text-white/40">Loading…</div>
          )}
          {data && (
            <TreeNodes
              nodes={tree.rootChildren}
              expanded={expanded}
              selectedEntryId={selectedEntryId}
              onToggle={toggleFolder}
              onSelectEntry={(id) => setSelectedEntryId(id)}
              onAddEntry={handleAddEntry}
              onAddFolder={handleAddFolder}
              onDeleteEntry={handleDeleteEntry}
              onDeleteFolder={handleDeleteFolder}
              depth={0}
            />
          )}
          <div className="mt-2 flex flex-col gap-1 border-t border-white/[0.04] px-2 pt-2">
            <button
              type="button"
              onClick={() => handleAddEntry(null)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11px] text-white/50 transition-colors hover:bg-white/[0.03] hover:text-white/85"
            >
              <Plus size={10} />
              Add entry
            </button>
            <button
              type="button"
              onClick={() => handleAddFolder(null)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11px] text-white/50 transition-colors hover:bg-white/[0.03] hover:text-white/85"
            >
              <Plus size={10} />
              Add folder
            </button>
          </div>
        </div>

        {/* Editor pane */}
        <div className="flex-1 min-w-0">
          {selectedEntryId ? (
            <EntryEditor
              entryId={selectedEntryId}
              workspaceId={scope?.workspaceId}
              key={selectedEntryId}
              onSaved={refetch}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-white/40">
              {data && data.entries.length === 0
                ? "No entries yet — add one"
                : "Select an entry"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tree builder ─────────────────────────────────────────────────────

interface TreeNode {
  kind: "folder" | "entry";
  id: string;
  name: string;
  /** For folders, sub-children. For entries, undefined. */
  children?: TreeNode[];
  /** Reference to the original row for action callbacks. */
  folder?: KnowledgeFolder;
  entry?: KnowledgeEntry;
}

function buildTree(
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

interface TreeNodesProps {
  nodes: TreeNode[];
  expanded: Set<string>;
  selectedEntryId: string | null;
  onToggle: (id: string) => void;
  onSelectEntry: (id: string) => void;
  onAddEntry: (folderId: string | null) => void;
  onAddFolder: (parentId: string | null) => void;
  onDeleteEntry: (entry: KnowledgeEntry) => void;
  onDeleteFolder: (folder: KnowledgeFolder) => void;
  depth: number;
}

function TreeNodes(props: TreeNodesProps) {
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
  return (
    <div className="px-1">
      <div
        className="group flex items-center gap-1 rounded text-[12px] text-white/80 transition-colors hover:bg-white/[0.04]"
        style={{ paddingLeft: padding }}
      >
        <button
          type="button"
          onClick={() => props.onToggle(node.id)}
          className="flex flex-1 items-center gap-1 py-1 text-left"
        >
          {isOpen ? (
            <ChevronDown size={11} className="shrink-0 text-white/45" />
          ) : (
            <ChevronRight size={11} className="shrink-0 text-white/45" />
          )}
          {isOpen ? (
            <FolderOpen size={12} className="shrink-0 text-white/55" />
          ) : (
            <Folder size={12} className="shrink-0 text-white/55" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
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
  return (
    <div className="px-1">
      <div
        className={`group flex items-center gap-1 rounded text-[11.5px] transition-colors ${
          active
            ? "bg-white/[0.06] text-white/95"
            : "text-white/60 hover:bg-white/[0.03] hover:text-white/85"
        }`}
        style={{ paddingLeft: padding }}
      >
        <button
          type="button"
          onClick={() => props.onSelectEntry(node.id)}
          className="flex flex-1 items-center gap-1.5 py-1 text-left"
        >
          <FileText size={10} className="shrink-0 text-white/40" />
          <span className="truncate">{node.name}</span>
        </button>
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
      className="flex h-5 w-5 items-center justify-center rounded text-white/45 hover:bg-white/[0.06] hover:text-white/85"
    >
      {children}
    </button>
  );
}

// ── Entry editor ─────────────────────────────────────────────────────
//
// Concurrency model — never silently overwrite the user's editor:
//
//  - Every PATCH is sent with the entry's `expectedUpdatedAt` so the
//    server returns 412 if a parallel writer beat us.
//  - On 412, we fetch the server's current entry into a local conflict
//    snapshot. The editor's content stays exactly as the user typed
//    it. A banner offers explicit resolution: "Save mine, overwrite"
//    or "Discard mine, reload".
//  - On unmount with unsaved edits AND no pending conflict, we fire
//    one final PATCH with the same precondition so closing the panel
//    via X / drag / undo doesn't drop dirty content. While in
//    conflict we deliberately skip the unmount flush — silent
//    background saves while the user is mid-resolution would
//    overwrite whatever choice they were about to make.

interface EntryEditorConflict {
  serverTitle: string;
  serverBody: string;
  serverUpdatedAt: string;
}

function EntryEditor({
  entryId,
  workspaceId,
  onSaved,
}: {
  entryId: string;
  workspaceId: string | undefined;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<EntryEditorConflict | null>(null);

  // Latest values + flags mirrored into refs so the unmount-flush
  // sees fresh data even when React state inside cleanup is stale.
  const latestRef = useRef({ title, body });
  useEffect(() => {
    latestRef.current = { title, body };
  });
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const conflictRef = useRef<EntryEditorConflict | null>(null);
  conflictRef.current = conflict;
  const expectedUpdatedAtRef = useRef<string | null>(null);
  const lastSavedRef = useRef<{ title: string; body: string } | null>(null);

  // Initial load + entry switch (the parent re-keys EntryEditor by
  // selectedEntryId, so this effect runs once per mount).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEntry(entryId, workspaceId)
      .then((e) => {
        if (cancelled) return;
        setTitle(e.title);
        setBody(e.body);
        setDirty(false);
        setConflict(null);
        expectedUpdatedAtRef.current = e.updatedAt;
        lastSavedRef.current = { title: e.title, body: e.body };
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorText(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entryId, workspaceId]);

  // Unmount flush — fire a final PATCH if dirty AND not in conflict.
  // Empty-deps intentionally so the cleanup captures the initial
  // entryId/workspaceId snapshot. Refs supply fresh title/body/flags.
  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return;
      if (conflictRef.current !== null) return;
      const last = lastSavedRef.current;
      const latest = latestRef.current;
      if (last && last.title === latest.title && last.body === latest.body) {
        return;
      }
      const expectedUpdatedAt = expectedUpdatedAtRef.current;
      if (!expectedUpdatedAt) return;
      updateEntry(
        entryId,
        { title: latest.title, body: latest.body },
        workspaceId,
        expectedUpdatedAt
      ).catch((err: unknown) => {
        // 412 here means a parallel writer beat us during the unmount
        // window; without an editor to surface a banner we drop the
        // edit. Other errors are also dropped (no UI to retry into).
        if (err instanceof KnowledgeApiError && err.status === 412) {
          console.warn(
            "[knowledge-panel] unmount autosave dropped (412 stale)",
            { entryId }
          );
          return;
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enterConflict(): Promise<boolean> {
    try {
      const fresh = await fetchEntry(entryId, workspaceId);
      setConflict({
        serverTitle: fresh.title,
        serverBody: fresh.body,
        serverUpdatedAt: fresh.updatedAt,
      });
      return true;
    } catch (err) {
      setErrorText(
        err instanceof Error
          ? err.message
          : "Couldn't load the latest server version"
      );
      return false;
    }
  }

  async function handleSave() {
    if (!dirty || conflict || !expectedUpdatedAtRef.current) return;
    setSaving(true);
    setErrorText(null);
    try {
      const updated = await updateEntry(
        entryId,
        { title, body },
        workspaceId,
        expectedUpdatedAtRef.current
      );
      expectedUpdatedAtRef.current = updated.updatedAt;
      lastSavedRef.current = { title, body };
      setDirty(false);
      onSaved();
    } catch (err) {
      if (err instanceof KnowledgeApiError && err.status === 412) {
        await enterConflict();
        return;
      }
      setErrorText(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleKeepMine() {
    if (!conflict) return;
    setSaving(true);
    setErrorText(null);
    try {
      const updated = await updateEntry(
        entryId,
        { title, body },
        workspaceId,
        conflict.serverUpdatedAt
      );
      expectedUpdatedAtRef.current = updated.updatedAt;
      lastSavedRef.current = { title, body };
      setDirty(false);
      setConflict(null);
      onSaved();
    } catch (err) {
      if (err instanceof KnowledgeApiError && err.status === 412) {
        await enterConflict();
        return;
      }
      setErrorText(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function handleDiscardMine() {
    if (!conflict) return;
    setTitle(conflict.serverTitle);
    setBody(conflict.serverBody);
    expectedUpdatedAtRef.current = conflict.serverUpdatedAt;
    lastSavedRef.current = {
      title: conflict.serverTitle,
      body: conflict.serverBody,
    };
    setDirty(false);
    setConflict(null);
    setErrorText(null);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-white/40">
        Loading…
      </div>
    );
  }

  if (errorText && !expectedUpdatedAtRef.current) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-red-400">
        {errorText}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2 text-[11px] leading-relaxed text-amber-100/90"
        >
          <span className="min-w-0 flex-1">
            <strong className="font-semibold">Edited elsewhere.</strong> The
            server has a newer version — your edits are kept until you choose.
          </span>
          <button
            type="button"
            onClick={handleDiscardMine}
            disabled={saving}
            className="rounded border border-white/[0.1] bg-white/[0.02] px-2 py-0.5 text-[10px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white/95 disabled:opacity-40"
          >
            Discard mine
          </button>
          <button
            type="button"
            onClick={handleKeepMine}
            disabled={saving}
            className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-100/95 transition-colors hover:bg-amber-400/15 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save mine"}
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2">
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          className="flex-1 bg-transparent text-sm font-semibold text-white/95 placeholder:text-white/30 focus:outline-none"
          placeholder="Untitled"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving || conflict !== null}
          className="inline-flex items-center gap-1 rounded-md border border-white/[0.18] bg-white/[0.06] px-2 py-1 text-[11px] text-white/85 transition-colors hover:bg-white/[0.1] disabled:opacity-40"
        >
          <Save size={10} />
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </div>
      {errorText && (
        <div className="border-b border-white/[0.06] bg-red-500/5 px-4 py-1 text-[10px] text-red-400">
          {errorText}
        </div>
      )}
      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setDirty(true);
        }}
        className="flex-1 min-h-0 resize-none bg-transparent px-4 py-3 font-mono text-[12px] leading-relaxed text-white/85 placeholder:text-white/25 focus:outline-none"
        placeholder="Write markdown here…"
      />
    </div>
  );
}
