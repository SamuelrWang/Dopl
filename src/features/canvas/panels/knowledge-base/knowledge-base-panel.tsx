"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { KnowledgeBasePanelData } from "../../types";
import { useRefChipDrag } from "../../use-ref-chip-drag";
import { useCanvasScope } from "../../canvas-store";
import { useKnowledgeTree } from "@/features/knowledge/client/hooks";
import { useKnowledgeRealtime } from "@/features/knowledge/client/realtime";
import {
  createEntry,
  createFolder,
  deleteEntry,
  deleteFolder,
  updateBase,
  updateEntry,
  updateFolder,
} from "@/features/knowledge/client/api";
import type {
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/toast";
import { useMyAccessContext } from "@/features/members/hooks/use-my-access";
import { meetsLevel } from "@/features/teams/access-levels";
import { VisibilityPill } from "@/shared/ui/visibility-pill";
import { buildTree, TreeNodes } from "./knowledge-tree";
import { EntryEditor } from "./entry-editor";

interface Props {
  panel: KnowledgeBasePanelData;
  /** Rendered inline inside a node block's Read zone (docked KB ref)
   *  rather than as a free canvas panel. Hides canvas-panel chrome that
   *  makes no sense there: the cluster-attachment banner, the file-tree
   *  expand button, and the agent toggle (the synthetic panel object a
   *  dock ref builds carries no trustworthy agentWriteEnabled). */
  embedded?: boolean;
}

export function KnowledgeBasePanelBody({ panel, embedded = false }: Props) {
  const beginRefDrag = useRefChipDrag();
  const scope = useCanvasScope();
  const { data, status, error, refetch } = useKnowledgeTree(
    panel.knowledgeBaseId,
    scope?.workspaceId
  );
  useKnowledgeRealtime(scope?.workspaceId, refetch);
  // Audit A-005 / A-013: hide write affordances from read-only members.
  // Falls open to true while the access fetch is loading.
  const access = useMyAccessContext();
  const accessLevel = access.resolve("knowledge_base", panel.knowledgeBaseId);
  const canEdit = accessLevel == null ? true : meetsLevel(accessLevel, "edit");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["__root__"]));
  // On the canvas the tree is an on-demand drawer: closed by default,
  // opened via the header chevron, and auto-collapsed when the user
  // clicks off the panel (see the pointerdown effect below).
  const [treeOpen, setTreeOpen] = useState(false);
  const panelRootRef = useRef<HTMLDivElement>(null);
  const [agentToggling, setAgentToggling] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(panel.agentWriteEnabled);
  /**
   * Inline create-then-rename state. When the user hits "+", we create
   * the row server-side with a default name ("Untitled folder" /
   * "Untitled entry") and stash its id here. The matching tree row
   * renders <InlineEditableRow> instead of the static label, with the
   * default name pre-selected so typing replaces it. Commit issues the
   * rename; Escape on an untouched stub deletes it.
   */
  const [editing, setEditing] = useState<
    { kind: "folder" | "entry"; id: string } | null
  >(null);

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

  // Auto-collapse the tree when the user clicks anywhere outside this
  // panel (off onto the canvas or another panel) so panels stay compact.
  // Capture phase so the canvas's own pointer handlers — which
  // stopPropagation while panning/dragging — can't swallow the outside
  // click before we see it. Only listens while the tree is open.
  useEffect(() => {
    if (!treeOpen || embedded) return;
    function handlePointerDown(e: PointerEvent) {
      const root = panelRootRef.current;
      if (root && !root.contains(e.target as Node)) {
        setTreeOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [treeOpen, embedded]);

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
    try {
      const folder = await createFolder(panel.knowledgeBaseId, {
        parentId,
        name: "Untitled folder",
        position: 0,
      });
      refetch();
      if (parentId) {
        setExpanded((prev) => new Set(prev).add(parentId));
      }
      setEditing({ kind: "folder", id: folder.id });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create folder");
    }
  }

  async function handleAddEntry(folderId: string | null) {
    try {
      const entry = await createEntry(panel.knowledgeBaseId, {
        folderId,
        title: "Untitled entry",
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
      setEditing({ kind: "entry", id: entry.id });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create entry");
    }
  }

  async function handleCommitRename(
    kind: "folder" | "entry",
    id: string,
    next: string
  ) {
    try {
      if (kind === "folder") {
        await updateFolder(id, { name: next });
      } else {
        await updateEntry(id, { title: next });
      }
      refetch();
      setEditing(null);
    } catch (err) {
      // Audit A-007: surface the failure so the user knows their typed
      // name reverted. Re-throw so InlineEditableRow rolls back to the
      // original value and stays in edit mode for retry.
      toast({
        title: "Couldn't rename",
        description: err instanceof Error ? err.message : "Unknown error",
      });
      throw err;
    }
  }

  async function handleCancelStub(kind: "folder" | "entry", id: string) {
    // Delete the just-created stub on Escape so the user isn't left with
    // an "Untitled folder" they didn't actually want.
    try {
      if (kind === "folder") {
        await deleteFolder(id);
      } else {
        await deleteEntry(id);
        if (selectedEntryId === id) setSelectedEntryId(null);
      }
      refetch();
      setEditing(null);
    } catch (err) {
      // Audit A-004: stub delete failure was silently swallowed,
      // leaving "Untitled folder/entry" rows stuck in the tree.
      // Surface so the user knows + clear the editing state regardless
      // (they pressed Escape, they don't want to keep typing).
      toast({
        title: "Couldn't remove the unsaved row",
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setEditing(null);
      throw err;
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
    <div ref={panelRootRef} className="flex h-full w-full flex-col">
      {/* Sub-header: KB metadata */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        {!embedded && (
          <button
            type="button"
            onClick={() => setTreeOpen((v) => !v)}
            aria-label={treeOpen ? "Collapse file tree" : "Expand file tree"}
            title={treeOpen ? "Collapse file tree" : "Expand file tree"}
            className="mr-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-surface-raised-2 hover:text-text-secondary"
          >
            {treeOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-text-primary">
              {data?.base.name ?? panel.name}
            </h2>
            {/* Audit B10: visibility pill on the canvas KB panel
             * header for parity with the full-page detail. The owner
             * can promote-to-public from the full-page settings; the
             * canvas panel is read-only on visibility. */}
            {data?.base.visibility && (
              <VisibilityPill visibility={data.base.visibility} />
            )}
            {!embedded && (
              <button
                type="button"
                onClick={handleAgentToggle}
                disabled={agentToggling}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors ${
                  agentEnabled
                    ? "border-agent-on/20 bg-agent-on/10 text-agent-on/90 hover:bg-agent-on/15"
                    : "border-border-default bg-surface-raised-1 text-text-muted hover:text-text-tertiary"
                }`}
              >
                <Bot size={9} />
                {agentEnabled ? "Agent: on" : "Agent: off"}
              </button>
            )}
          </div>
          {(data?.base.description ?? panel.description) && (
            <p className="mt-0.5 truncate text-[11px] text-text-muted">
              {data?.base.description ?? panel.description}
            </p>
          )}
        </div>
      </div>

      {status === "error" && (
        <div className="border-b border-border-subtle bg-red-500/5 px-4 py-2 text-[11px] text-red-400">
          {error?.message || "Failed to load this knowledge base"}
        </div>
      )}

      {/* Two-column body */}
      <div className="flex flex-1 min-h-0">
        {/* Tree */}
        <div
          className={`shrink-0 overflow-y-auto border-r border-border-subtle py-2 transition-[width] duration-150 ${
            treeOpen ? "w-[210px]" : "w-0 border-r-0 overflow-hidden"
          }`}
          aria-hidden={!treeOpen}
        >
          {status === "loading" && !data && <TreePaneSkeleton />}
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
              editing={editing}
              onCommitRename={handleCommitRename}
              onCancelStub={handleCancelStub}
              canEdit={canEdit}
              onFileDragStart={(e, node) =>
                beginRefDrag(e, {
                  kind: "file",
                  kbId: panel.knowledgeBaseId,
                  entryId: node.id,
                  name: node.name,
                })
              }
              depth={0}
            />
          )}
          {canEdit && (
            <div className="mt-2 flex flex-col gap-1 border-t border-border-subtle px-2 pt-2">
              <button
                type="button"
                onClick={() => handleAddEntry(null)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-surface-raised-1 hover:text-text-secondary"
              >
                <Plus size={10} />
                Add entry
              </button>
              <button
                type="button"
                onClick={() => handleAddFolder(null)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11px] text-text-tertiary transition-colors hover:bg-surface-raised-1 hover:text-text-secondary"
              >
                <Plus size={10} />
                Add folder
              </button>
            </div>
          )}
        </div>

        {/* Editor pane */}
        <div className="flex-1 min-w-0">
          {selectedEntryId ? (
            <EntryEditor
              entryId={selectedEntryId}
              workspaceId={scope?.workspaceId}
              key={selectedEntryId}
              onSaved={refetch}
              canEdit={canEdit}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-text-muted">
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

function TreePaneSkeleton() {
  return (
    <div className="space-y-1.5 px-3 py-1" aria-label="Loading entries">
      {[
        "w-32",
        "w-24 ml-3",
        "w-28 ml-3",
        "w-20",
        "w-36 ml-3",
        "w-24",
      ].map((w, i) => (
        <Skeleton key={i} className={`h-3 ${w} bg-surface-raised-2`} />
      ))}
    </div>
  );
}
