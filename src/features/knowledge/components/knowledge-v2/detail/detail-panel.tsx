"use client";

import { Fragment, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  Database,
  Download,
  Settings,
  Trash2,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Toolbar } from "@/shared/editor/doc-editor-toolbar";
import { toast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/utils";
import { KnowledgeSearch } from "../../knowledge-search";
import { KnowledgeApiError, deleteBase } from "../../../client/api";
import type { KnowledgeBase, KnowledgeEntry, KnowledgeFolder } from "../../../types";
import type { BaseTree, KbTeamRef, Selection } from "../types";
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
  /** Tree of the selected base — for the breadcrumb folder chain. */
  selectedTree?: BaseTree;
  /** Full body of the open entry (controller-owned fetch). */
  openEntry: KnowledgeEntry | null;
  openEntryStatus: "idle" | "loading" | "success" | "error";
  refetchOpenEntry: () => void;
  /** Admin-only: kbId → teams granted, surfaced in the base overview. */
  kbTeams?: Record<string, KbTeamRef[]>;
  /** Whether the current user may edit the selected base's name/description. */
  canEditBase: boolean;
  /** Refresh a base's tree after an entry save. */
  onTreeRefresh: (baseId: string) => void;
  /** Re-pull the SSR base list after a base name/description save. */
  onBaseSaved: () => void;
  /** Open a content-search hit (entry within a base). */
  onSelectSearchEntry: (entryId: string, baseId: string) => void;
  /** Breadcrumb navigation: jump to the first entry in a folder (null = base). */
  onCrumbSelect: (base: KnowledgeBase, folderId: string | null) => void;
  /** Download the whole base as a zip. */
  onExportBase: (baseId: string) => void;
  /** Open the base settings modal for the selected base. */
  onOpenSettings: () => void;
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
 * Right detail pane. Shared chrome (breadcrumb top bar, title); when an entry
 * is selected a slim header band hosts the rich-text formatting toolbar (the
 * DocEditor publishes its live instance up via `onEditor`, and its own
 * floating pill is suppressed). The body is the file's real editor for an
 * entry (DocPane owns its own title), or the base overview when a whole
 * knowledge base is selected.
 */
export function DetailPanel({
  selection,
  workspaceId,
  selectedTree,
  openEntry,
  openEntryStatus,
  refetchOpenEntry,
  kbTeams,
  canEditBase,
  onTreeRefresh,
  onBaseSaved,
  onSelectSearchEntry,
  onCrumbSelect,
  onExportBase,
  onOpenSettings,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Live editor instance for the currently open entry, published by
  // EntryView's DocEditor. Drives the header-band formatting toolbar;
  // null while a base is selected or a file body is still loading.
  const [entryEditor, setEntryEditor] = useState<Editor | null>(null);

  // Mirrors the settings form's danger-zone delete (base-settings-form.tsx):
  // same `deleteBase` call, then navigate to the base-less knowledge root so
  // the view remounts with an empty selection and refresh re-pulls the list.
  async function handleDeleteBase() {
    if (!selection) return;
    const base = selection.base;
    setDeleting(true);
    try {
      await deleteBase(base.id, workspaceId);
      toast({ title: `"${base.name}" deleted` });
      const workspaceSegment = pathname.split("/").filter(Boolean)[0] ?? "";
      router.replace(`/${workspaceSegment}/knowledge`);
      router.refresh();
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
        // Slim header band where the dead tabs used to be — hosts the
        // rich-text toolbar (entries only). Always visible above the scroll
        // body, so formatting stays reachable in long documents. Empty until
        // the editor mounts, keeping its height stable.
        <div className={styles.detailToolbarBand}>
          {entryEditor && <Toolbar editor={entryEditor} variant="header" />}
        </div>
      )}

      <div className={styles.detailBody}>
        {selection.kind === "entry" ? (
          // DocPane renders the (editable) title itself — no static title here.
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
            tree={selectedTree}
            onTreeRefresh={onTreeRefresh}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete knowledge base?"
        description={`“${selection.base.name}” and all its folders + entries will move to trash. You can restore it from the trash modal until it's purged.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDeleteBase}
      />
    </div>
  );
}
