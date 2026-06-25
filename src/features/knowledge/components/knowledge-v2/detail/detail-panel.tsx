"use client";

import { Fragment, useState } from "react";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  MoreHorizontal,
  Pin,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { KnowledgeSearch } from "../../knowledge-search";
import type { KnowledgeBase, KnowledgeEntry, KnowledgeFolder } from "../../../types";
import type { BaseTree, KbTeamRef, Selection } from "../types";
import { BaseOverview } from "./base-overview";
import { EntryView } from "./entry-view";
import { viewModel } from "./view-model";
import appShell from "@/shared/layout/app-shell/app-shell.module.css";
import styles from "../knowledge-v2.module.css";

const TABS = ["Overview", "Messages", "Attachments"] as const;
type Tab = (typeof TABS)[number];

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
  /** Refresh a base's tree after an entry save. */
  onTreeRefresh: (baseId: string) => void;
  /** Open a content-search hit (entry within a base). */
  onSelectSearchEntry: (entryId: string, baseId: string) => void;
  /** Breadcrumb navigation: jump to the first entry in a folder (null = base). */
  onCrumbSelect: (base: KnowledgeBase, folderId: string | null) => void;
  /** Download the whole base as a zip. */
  onExportBase: (baseId: string) => void;
  /** Open the base settings modal for the selected base. */
  onOpenSettings: () => void;
  onClose: () => void;
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
 * Right detail pane. Shared chrome (top bar, tabs, title); the body is the
 * file's real editor when an entry is selected (DocPane owns its own title),
 * or the base overview when a whole knowledge base is selected.
 */
export function DetailPanel({
  selection,
  workspaceId,
  selectedTree,
  openEntry,
  openEntryStatus,
  refetchOpenEntry,
  kbTeams,
  onTreeRefresh,
  onSelectSearchEntry,
  onCrumbSelect,
  onExportBase,
  onOpenSettings,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("Overview");

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
        <button className={styles.iconBtn} type="button" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
        <span className={styles.divider} />
        <button className={styles.iconBtn} type="button" aria-label="Previous">
          <ChevronLeft size={18} />
        </button>
        <button className={styles.iconBtn} type="button" aria-label="Next">
          <ChevronRight size={18} />
        </button>
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
          className={styles.iconBtn}
          type="button"
          aria-label="Download knowledge base"
          title="Download this knowledge base"
          onClick={() => onExportBase(selection.base.id)}
        >
          <Download size={17} />
        </button>
        <button
          className={styles.iconBtn}
          type="button"
          aria-label="Knowledge base settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings size={17} />
        </button>
        <span className={styles.divider} />
        <button className={cn(styles.iconBtn, styles.iconBtnActive)} type="button" aria-label="Pin">
          <Pin size={17} />
        </button>
        <button className={styles.iconBtn} type="button" aria-label="Archive">
          <Archive size={17} />
        </button>
        <button className={styles.iconBtn} type="button" aria-label="More">
          <MoreHorizontal size={17} />
        </button>
        <button className={cn(styles.iconBtn, styles.iconBtnRed)} type="button" aria-label="Delete">
          <Trash2 size={17} />
        </button>
      </div>

      <div className={styles.detailTabs}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={cn(styles.detailTab, tab === t && styles.detailTabActive)}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <button className={styles.detailTab} type="button">
          <Plus size={14} /> New
        </button>
      </div>

      <div className={styles.detailBody}>
        {selection.kind === "entry" ? (
          // DocPane renders the (editable) title itself — no static title here.
          <EntryView
            key={selection.entry.id}
            base={selection.base}
            metaEntry={selection.entry}
            fullEntry={openEntry}
            status={openEntryStatus}
            workspaceId={workspaceId}
            onTreeRefresh={onTreeRefresh}
            onFocusRefetch={() => {
              refetchOpenEntry();
              onTreeRefresh(selection.base.id);
            }}
          />
        ) : (
          <>
            <div className={styles.docTitle}>{vm.title}</div>
            <BaseOverview vm={vm} teams={kbTeams?.[selection.base.id]} />
          </>
        )}
      </div>
    </div>
  );
}
