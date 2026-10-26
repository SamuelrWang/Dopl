"use client";

/** STAGING COPY of `src/features/knowledge/components/knowledge-v2/detail/base-header.tsx` — verbatim; imports point at staging copies (data layer = in-memory). */
import { Fragment, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, Settings, Trash2 } from "lucide-react";
import {
  OPEN_SCALE_ICON_ONLY,
  OpenScaleIconButton,
} from "@/shared/ui/open-scale-button";
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
 * One breadcrumb for the whole panel: `Knowledge › {base} › {folders…} ›
 * {file}`, keeping the `aria-label` "Knowledge base breadcrumb" that host tests
 * address it by. The base crumb selects the BASE, not its first file — the
 * resting face is the base.
 *
 * Download / settings / delete are `shared/ui/open-scale-button.tsx ›
 * OpenScaleIconButton`, not a file-private icon-button recipe.
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

  // The same flow as base-settings-form.tsx's danger-zone delete, by construction.
  async function handleDeleteBase() {
    setDeleting(true);
    try {
      await deleteBaseAndLeave(selection.base, workspaceId, queryClient, routing);
    } finally {
      setDeleting(false);
    }
  }

  const folders = selectedTree?.status === "ready" ? selectedTree.folders : [];
  const folderChain =
    selection.kind === "entry"
      ? folderChainOf(folders, selection.entry.folderId)
      : [];

  return (
    <div className={cn(styles.baseHead, "border-b border-border-default")}>
      <nav
        className={cn(styles.detailTopTitle, styles.crumbs)}
        aria-label="Knowledge base breadcrumb"
      >
        <button type="button" className={styles.crumbBtn} onClick={onGoHome}>
          Knowledge
        </button>
        <ChevronRight size={12} className={styles.crumbSep} />
        {selection.kind === "entry" ? (
          <>
            <button
              type="button"
              className={styles.crumbBtn}
              onClick={() => onSelectBaseRoot(selection.base)}
            >
              {selection.base.name}
            </button>
            {folderChain.map((f) => (
              <Fragment key={f.id}>
                <ChevronRight size={12} className={styles.crumbSep} />
                <button
                  type="button"
                  className={styles.crumbBtn}
                  onClick={() => onSelectFolder(selection.base, f.id)}
                >
                  {f.name}
                </button>
              </Fragment>
            ))}
            <ChevronRight size={12} className={styles.crumbSep} />
            <span className={styles.crumbCurrent}>{selection.entry.title}</span>
          </>
        ) : (
          <span className={styles.crumbCurrent}>{selection.base.name}</span>
        )}
      </nav>

      <div className={styles.headSpacer} />

      <div className={cn(appShell.lightScope, "hidden lg:block w-52")}>
        <KnowledgeSearch
          workspaceId={workspaceId}
          baseSlug={selection.base.slug}
          onSelectEntry={onSelectSearchEntry}
        />
      </div>

      <OpenScaleIconButton
        aria-label="Download knowledge base"
        title="Download this knowledge base"
        onClick={() => onExportBase(selection.base.id)}
      >
        <Download size={OPEN_SCALE_ICON_ONLY} />
      </OpenScaleIconButton>
      <OpenScaleIconButton
        aria-label="Knowledge base settings"
        title="Settings"
        onClick={onOpenSettings}
      >
        <Settings size={OPEN_SCALE_ICON_ONLY} />
      </OpenScaleIconButton>
      <OpenScaleIconButton
        className="hover:text-danger"
        aria-label="Delete knowledge base"
        title="Delete this knowledge base"
        disabled={deleting}
        onClick={() => setConfirmDeleteOpen(true)}
      >
        <Trash2 size={OPEN_SCALE_ICON_ONLY} />
      </OpenScaleIconButton>

      <DeleteBaseConfirm
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        baseName={selection.base.name}
        onConfirm={handleDeleteBase}
      />
    </div>
  );
}
