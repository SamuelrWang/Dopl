"use client";

import { Fragment, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Database,
  Download,
  Settings,
  Trash2,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import { Toolbar } from "@/shared/editor/doc-editor-toolbar";
import { toast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/utils";
import { DeleteBaseConfirm } from "../../delete-base-confirm";
import { KnowledgeSearch } from "../../knowledge-search";
import { KnowledgeApiError, deleteBase } from "../../../client/api";
import { evictDeletedBase } from "../../../client/hooks";
import type {
  KnowledgeBase,
  KnowledgeBaseStats,
  KnowledgeEntry,
  KnowledgeFolder,
} from "../../../types";
import type { BaseTree, KbTeamRef, Selection } from "../types";
import type { KnowledgeRouting } from "../routing";
import { BaseOverview } from "./base-overview";
import { EntryView } from "./entry-view";
import { viewModel } from "./view-model";
import appShell from "@/shared/layout/app-shell/app-shell.module.css";
import styles from "../knowledge-v2.module.css";

/** App-wide icon-button recipe (chats/skills list panes): 28px, hover-raised. */
const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

interface Props {
  selection: Selection | null;
  workspaceId: string;
  /** Selected base's tree, for the breadcrumb folder chain. */
  selectedTree?: BaseTree;
  /** Controller-owned fetch: FULL body, not the tree's stripped copy. */
  openEntry: KnowledgeEntry | null;
  openEntryStatus: "idle" | "loading" | "success" | "error";
  refetchOpenEntry: () => void;
  /** Admin-only: kbId → teams granted, surfaced in the base overview. */
  kbTeams?: Record<string, KbTeamRef[]>;
  /** Per-base counters from the list response; overview reads `storageBytes`
   *  from it. Absent = unknown, no bar. */
  baseStats?: Record<string, KnowledgeBaseStats>;
  /** Per-base storage cap in bytes, same response. */
  kbStorageLimit?: number | null;
  canEditBase: boolean;
  onTreeRefresh: (baseId: string) => void;
  /** Re-pull the base list after a name/description save. */
  onBaseSaved: () => void;
  onSelectSearchEntry: (entryId: string, baseId: string) => void;
  /** Jump to the first entry in a folder; null = the base itself. */
  onCrumbSelect: (base: KnowledgeBase, folderId: string | null) => void;
  /** Zip the whole base. */
  onExportBase: (baseId: string) => void;
  onOpenSettings: () => void;
  /** Router bindings; the toolbar delete leaves this base's URL behind
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
 * Right detail pane. With an entry selected, a slim header band hosts the
 * rich-text toolbar: DocEditor publishes its live instance up via `onEditor`
 * and its own floating pill is suppressed. Body = the entry's editor (DocPane
 * owns its title) or the base overview.
 */
export function DetailPanel({
  selection,
  workspaceId,
  selectedTree,
  openEntry,
  openEntryStatus,
  refetchOpenEntry,
  kbTeams,
  baseStats,
  kbStorageLimit,
  canEditBase,
  onTreeRefresh,
  onBaseSaved,
  onSelectSearchEntry,
  onCrumbSelect,
  onExportBase,
  onOpenSettings,
  routing,
}: Props) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Published by EntryView's DocEditor; drives the header-band toolbar. Null
  // while a base is selected or a body is still loading.
  const [entryEditor, setEntryEditor] = useState<Editor | null>(null);
  const queryClient = useQueryClient();

  // ⚠ Must mirror base-settings-form.tsx's danger-zone delete: same
  // `deleteBase` call, then navigate to the base-less knowledge root so the
  // view drops to an empty selection and the list is re-pulled.
  async function handleDeleteBase() {
    if (!selection) return;
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

  if (!selection) {
    return (
      <div className={styles.detailPane}>
        <div className={styles.detailEmpty}>
          <Database size={40} strokeWidth={1.4} />
          <p>Select a knowledge base or file to see its overview.</p>
        </div>
      </div>
    );
  }

  const vm = viewModel(selection);
  const folders =
    selectedTree?.status === "ready" ? selectedTree.folders : [];
  const folderChain =
    selection.kind === "entry"
      ? folderChainOf(folders, selection.entry.folderId)
      : [];

  return (
    <div className={styles.detailPane}>
      <div className={styles.detailTop}>
        <span className={styles.detailTopTitle}>
          {selection.kind === "entry" ? (
            <nav className={styles.crumbs} aria-label="Breadcrumb">
              <button
                type="button"
                className={styles.crumbBtn}
                onClick={() => onCrumbSelect(selection.base, null)}
              >
                {selection.base.name}
              </button>
              {folderChain.map((f) => (
                <Fragment key={f.id}>
                  <ChevronRight size={12} className={styles.crumbSep} />
                  <button
                    type="button"
                    className={styles.crumbBtn}
                    onClick={() => onCrumbSelect(selection.base, f.id)}
                  >
                    {f.name}
                  </button>
                </Fragment>
              ))}
              <ChevronRight size={12} className={styles.crumbSep} />
              <span className={styles.crumbCurrent}>{selection.entry.title}</span>
            </nav>
          ) : (
            <span>{vm.title}</span>
          )}
        </span>
        <div className={styles.headSpacer} />
        <div className={cn(appShell.lightScope, "hidden lg:block w-52")}>
          <KnowledgeSearch
            workspaceId={workspaceId}
            baseSlug={selection.base.slug}
            onSelectEntry={onSelectSearchEntry}
          />
        </div>
        <button
          className={ICON_BTN}
          type="button"
          aria-label="Download knowledge base"
          title="Download this knowledge base"
          onClick={() => onExportBase(selection.base.id)}
        >
          <Download size={16} />
        </button>
        <button
          className={ICON_BTN}
          type="button"
          aria-label="Knowledge base settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings size={16} />
        </button>
        <span className={styles.divider} />
        <button
          className={cn(ICON_BTN, "hover:text-danger")}
          type="button"
          aria-label="Delete knowledge base"
          title="Delete this knowledge base"
          disabled={deleting}
          onClick={() => setConfirmDeleteOpen(true)}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {selection.kind === "entry" && (
        // Rich-text toolbar band (entries only). Always above the scroll
        // body so formatting stays reachable in long documents; empty until
        // the editor mounts, keeping height stable.
        <div className={styles.detailToolbarBand}>
          {entryEditor && <Toolbar editor={entryEditor} variant="header" />}
        </div>
      )}

      <div className={styles.detailBody}>
        {selection.kind === "entry" ? (
          // DocPane renders the editable title itself.
          <EntryView
            key={selection.entry.id}
            base={selection.base}
            fullEntry={openEntry}
            status={openEntryStatus}
            workspaceId={workspaceId}
            onEditor={setEntryEditor}
            onTreeRefresh={onTreeRefresh}
            onFocusRefetch={() => {
              refetchOpenEntry();
              onTreeRefresh(selection.base.id);
            }}
          />
        ) : (
          <BaseOverview
            key={selection.base.id}
            base={selection.base}
            vm={vm}
            workspaceId={workspaceId}
            canEdit={canEditBase}
            onSaved={onBaseSaved}
            teams={kbTeams?.[selection.base.id]}
            storageBytes={baseStats?.[selection.base.id]?.storageBytes ?? null}
            storageLimit={kbStorageLimit ?? null}
            tree={selectedTree}
            onTreeRefresh={onTreeRefresh}
          />
        )}
      </div>

      <DeleteBaseConfirm
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        baseName={selection.base.name}
        onConfirm={handleDeleteBase}
      />
    </div>
  );
}
