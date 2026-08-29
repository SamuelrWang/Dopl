"use client";

import { Fragment, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, Settings, Trash2 } from "lucide-react";
import {
  OPEN_SCALE_ICON_ONLY,
  OpenScaleIconButton,
} from "@/shared/ui/open-scale-button";
import { toast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/utils";
import { DeleteBaseConfirm } from "../../delete-base-confirm";
import { KnowledgeSearch } from "../../knowledge-search";
import { KnowledgeApiError, deleteBase } from "../../../client/api";
import { evictDeletedBase } from "../../../client/hooks";
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
 * THE PANEL'S ONE HEADER — it spans the whole opened-base panel, above BOTH
 * columns (Samuel's ruling, 2026-08-28).
 *
 * ⚠ ONE BREADCRUMB, WHERE THERE WERE TWO. The rail carried `Knowledge › {base}`
 * and the detail pane carried `{base} › {folder} › {file}`, side by side, and
 * both files' comments were about keeping the two navs distinguishable. One
 * panel has one address: `Knowledge › {base} › {folders…} › {file}`, and it
 * keeps the rail's `aria-label` ("Knowledge base breadcrumb") because that is
 * the surviving nav's name and what every host test addresses it by.
 *
 * ⚠ THE BASE CRUMB GOES TO THE BASE, NOT TO ITS FIRST FILE (behaviour change,
 * and it is the ruling's). It used to call the crumb handler with a `null`
 * folder, which selects `entries[0]` — so the only way back to the base's own
 * page was to leave the base and re-open it. The resting face IS the base now,
 * so the crumb that names the base selects it.
 *
 * ⚠ THE CONTROLS ARE GLOBAL COMPONENTS. Download / settings / delete were a
 * file-private `ICON_BTN` string (a bare 28px hover tint); they are
 * `shared/ui/open-scale-button.tsx › OpenScaleIconButton` — the KB card Open
 * button's face at 1:1 — and the vertical hairline that fenced delete off from
 * settings is gone (`../knowledge-v2.module.css › .divider`, deleted).
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

  // ⚠ Must mirror base-settings-form.tsx's danger-zone delete: same
  // `deleteBase` call, then navigate to the base-less knowledge root so the
  // view drops to an empty selection and the list is re-pulled.
  async function handleDeleteBase() {
    const base = selection.base;
    setDeleting(true);
    try {
      await deleteBase(base.id, workspaceId);
      toast({ title: `"${base.name}" deleted` });
      evictDeletedBase(queryClient, workspaceId, base.id);
      routing.goToBase(null, "replace");
      routing.refreshServerData();
    } catch (err) {
      const msg =
        err instanceof KnowledgeApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't delete";
      toast({ title: "Couldn't delete", description: msg });
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
