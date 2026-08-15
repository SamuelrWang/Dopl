"use client";

import { ChevronRight } from "lucide-react";
import { SkeletonRow } from "@/shared/ui/skeleton";
import type { KnowledgeBase, KnowledgeEntry } from "../../../types";
import type { BaseTree as BaseTreeData } from "../types";
import type { TreeHandlers } from "../use-knowledge-v2-controller";
import { BaseTree } from "./base-tree";
import styles from "../knowledge-v2.module.css";

interface Props {
  /** The ONE base this pane is scoped to: always the route's base. */
  base: KnowledgeBase;
  /** `undefined` until the first load lands. */
  tree: BaseTreeData | undefined;
  selectedEntryId: string | null;
  canEdit: boolean;
  editingNodeId: string | null;
  treeHandlers: TreeHandlers;
  onSelectEntry: (base: KnowledgeBase, entry: KnowledgeEntry) => void;
  /** Back to the home grid (the "Knowledge" crumb). */
  onGoHome: () => void;
}

/**
 * BASE DETAIL list pane: a breadcrumb and the opened base's tree, always
 * expanded. Nothing else — search, scope pills and base-switching all live on
 * the home grid, so a one-base pane has nothing to filter or collapse.
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
      {/* A crumb, not a title: the base NAME is the detail pane's header.
          ⚠ Label must stay DISTINCT from the detail pane's breadcrumb, which
          is on screen at the same time — two navs both called "Breadcrumb" are
          ambiguous to a screen reader and to a test. */}
      <nav className={styles.paneCrumbs} aria-label="Knowledge base breadcrumb">
        <button type="button" className={styles.crumbBtn} onClick={onGoHome}>
          Knowledge
        </button>
        <ChevronRight size={12} className={styles.crumbSep} />
        <span className={styles.crumbCurrent}>{base.name}</span>
      </nav>

      <div className={styles.listBody}>
        {!tree || tree.status === "loading" ? (
          // Skeleton, not a "Loading…" line (docs/DESIGN-SYSTEM.md: no text
          // loaders). ⚠ Shimmer is aria-hidden, so the status role and sr-only
          // label must live on THIS wrapper or the announcement is lost.
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
