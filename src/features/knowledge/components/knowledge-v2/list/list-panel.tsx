"use client";

import { ChevronRight } from "lucide-react";
import { SkeletonRow } from "@/shared/ui/skeleton";
import type { KnowledgeBase, KnowledgeEntry } from "../../../types";
import type { BaseTree as BaseTreeData } from "../types";
import type { TreeHandlers } from "../use-knowledge-v2-controller";
import { BaseTree } from "./base-tree";
import styles from "../knowledge-v2.module.css";

interface Props {
  /** The ONE base this pane is scoped to — the route's base, always. */
  base: KnowledgeBase;
  /** That base's tree; `undefined` until the first load lands. */
  tree: BaseTreeData | undefined;
  selectedEntryId: string | null;
  canEdit: boolean;
  editingNodeId: string | null;
  treeHandlers: TreeHandlers;
  onSelectEntry: (base: KnowledgeBase, entry: KnowledgeEntry) => void;
  /** Back to the home grid — the "Knowledge" crumb. */
  onGoHome: () => void;
}

/**
 * BASE DETAIL list pane: a breadcrumb and the opened base's folder/file tree,
 * always expanded. Nothing else.
 *
 * It used to list EVERY base as a row that expanded into its own tree, with a
 * search field and the scope pills above them. All three moved to the home
 * grid, which is where a choice between bases is now made — a pane scoped to
 * one base has no list to filter, no scope to switch, and no second base to
 * collapse this one in favour of. What is left is the crumb back out.
 */
export function ListPanel({
  base,
  tree,
  selectedEntryId,
  canEdit,
  editingNodeId,
  treeHandlers,
  onSelectEntry,
  onGoHome,
}: Props) {
  return (
    <div className={styles.listPane}>
      {/* A crumb, not a title: the base's NAME is the detail pane's header,
          and repeating it here as an <h1> would make the pane look like a
          page of its own. */}
      {/* Distinct label from the DETAIL pane's breadcrumb (the entry's
          folder path), which is on screen at the same time — two navs both
          called "Breadcrumb" are ambiguous to a screen reader and to a test. */}
      <nav className={styles.paneCrumbs} aria-label="Knowledge base breadcrumb">
        <button type="button" className={styles.crumbBtn} onClick={onGoHome}>
          Knowledge
        </button>
        <ChevronRight size={12} className={styles.crumbSep} />
        <span className={styles.crumbCurrent}>{base.name}</span>
      </nav>

      <div className={styles.listBody}>
        {!tree || tree.status === "loading" ? (
          // A skeleton, not the "Loading…" line the old expandable base row
          // used: opening a card is now THE way into this pane, so that text
          // would flash on every visit (docs/DESIGN-SYSTEM.md — no text
          // loaders). The shimmer is aria-hidden, so the status role and the
          // sr-only label belong to this wrapper or the announcement is lost.
          <div role="status" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading knowledge base</span>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} leading="square" />
            ))}
          </div>
        ) : tree.status === "error" ? (
          <p className={styles.treeEmpty}>Couldn’t load this base</p>
        ) : (
          <BaseTree
            base={base}
            tree={tree}
            selectedEntryId={selectedEntryId}
            canEdit={canEdit}
            editingNodeId={editingNodeId}
            handlers={treeHandlers}
            onSelectEntry={onSelectEntry}
          />
        )}
      </div>
    </div>
  );
}
