"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Settings, Trash2 } from "lucide-react";
import { Breadcrumb, type BreadcrumbItem } from "@/shared/ui/breadcrumb";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { cn } from "@/shared/lib/utils";
import { DeleteBaseConfirm } from "../../delete-base-confirm";
import { KnowledgeSearch } from "../../knowledge-search";
import { deleteBaseAndLeave } from "../../delete-base";
import type { KnowledgeBase, KnowledgeFolder } from "../../../types";
import type { BaseTree, Selection } from "../types";
import type { KnowledgeRouting } from "../routing";
import appShell from "@/shared/layout/app-shell/app-shell.module.css";
import styles from "../knowledge-v2.module.css";

interface Props {
  selection: Selection;
  workspaceId: string;
  /** Selected base's tree, for the breadcrumb folder chain. */
  selectedTree?: BaseTree;
  /** Leave this base — the `Knowledge` crumb. */
  onGoHome: () => void;
  /** Back to the base ITSELF: the info face, not its first file. */
  onSelectBaseRoot: (base: KnowledgeBase) => void;
  /** Jump to the first entry in a folder. */
  onSelectFolder: (base: KnowledgeBase, folderId: string) => void;
  onSelectSearchEntry: (entryId: string, baseId: string) => void;
  /** Zip the whole base. */
  onExportBase: (baseId: string) => void;
  onOpenSettings: () => void;
  /** Router bindings; the delete control leaves this base's URL behind
   *  (../routing.ts). */
  routing: KnowledgeRouting;
}

/** Root → leaf folder chain for an entry, from the flat folder list. */
function folderChainOf(
  folders: KnowledgeFolder[],
  folderId: string | null
): KnowledgeFolder[] {
  const chain: KnowledgeFolder[] = [];
  const visited = new Set<string>();
  let current = folderId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const folder = folders.find((f) => f.id === current);
    if (!folder) break;
    chain.unshift(folder);
    current = folder.parentId;
  }
  return chain;
}

/**
 * The panel's one header, spanning both columns of the opened base (ruling
 * 2026-08-28).
 *
 * One breadcrumb for the whole panel (`shared/ui/breadcrumb.tsx`): `Knowledge ›
 * {base} › {folders…} › {file}`, keeping the `aria-label` "Knowledge base
 * breadcrumb" that host tests address it by. The base crumb selects the BASE, not
 * its first file — the resting face is the base.
 *
 * Download / settings / delete are naked glyphs (`shared/ui/naked-icon-button.ts`).
 */
export function BaseHeader({
  selection,
  workspaceId,
  selectedTree,
  onGoHome,
  onSelectBaseRoot,
  onSelectFolder,
  onSelectSearchEntry,
  onExportBase,
  onOpenSettings,
  routing,
}: Props) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();

  // The same flow as base-settings-general.tsx's danger-zone delete, by construction.
  async function handleDeleteBase() {
    setDeleting(true);
    try {
      await deleteBaseAndLeave(selection.base, workspaceId, queryClient, routing);
    } finally {
      setDeleting(false);
    }
  }

  const folders = selectedTree?.status === "ready" ? selectedTree.folders : [];
  const { base } = selection;
  const crumbs: BreadcrumbItem[] = [
    { key: "knowledge", label: "Knowledge", onSelect: onGoHome },
    selection.kind === "entry"
      ? { key: base.id, label: base.name, onSelect: () => onSelectBaseRoot(base) }
      : { key: base.id, label: base.name },
    ...(selection.kind === "entry"
      ? [
          ...folderChainOf(folders, selection.entry.folderId).map((f) => ({
            key: f.id,
            label: f.name,
            onSelect: () => onSelectFolder(base, f.id),
          })),
          { key: selection.entry.id, label: selection.entry.title || "Untitled" },
        ]
      : []),
  ];

  return (
    <div className={cn(styles.baseHead, "border-b border-border-default")}>
      <Breadcrumb
        items={crumbs}
        ariaLabel="Knowledge base breadcrumb"
        className="text-title"
      />

      <div className={styles.headSpacer} />

      <div className={cn(appShell.lightScope, "mr-1 hidden w-52 lg:block")}>
        <KnowledgeSearch
          workspaceId={workspaceId}
          baseSlug={base.slug}
          onSelectEntry={onSelectSearchEntry}
        />
      </div>

      <button
        type="button"
        className={NAKED_ICON_BUTTON}
        aria-label="Download knowledge base"
        title="Download this knowledge base"
        onClick={() => onExportBase(base.id)}
      >
        <Download size={NAKED_ICON} />
      </button>
      <button
        type="button"
        className={NAKED_ICON_BUTTON}
        aria-label="Knowledge base settings"
        title="Settings"
        onClick={onOpenSettings}
      >
        <Settings size={NAKED_ICON} />
      </button>
      <button
        type="button"
        className={cn(NAKED_ICON_BUTTON, "hover:text-danger disabled:opacity-50")}
        aria-label="Delete knowledge base"
        title="Delete this knowledge base"
        disabled={deleting}
        onClick={() => setConfirmDeleteOpen(true)}
      >
        <Trash2 size={NAKED_ICON} />
      </button>

      <DeleteBaseConfirm
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        baseName={base.name}
        onConfirm={handleDeleteBase}
      />
    </div>
  );
}
