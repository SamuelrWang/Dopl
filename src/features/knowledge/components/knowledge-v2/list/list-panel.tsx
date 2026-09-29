"use client";

import { SkeletonRow } from "@/shared/ui/skeleton";
import type { KnowledgeBase, KnowledgeEntry } from "../../../types";
import type { BaseTree as BaseTreeData } from "../types";
import type { TreeHandlers } from "../use-knowledge-v2-controller";
import { BaseTree } from "./base-tree";
import styles from "../knowledge-v2.module.css";

interface Props {
  /** The ONE base this rail is scoped to: always the route's base. */
  base: KnowledgeBase;
  /** `undefined` until the first load lands. */
  tree: BaseTreeData | undefined;
  selectedEntryId: string | null;
  canEdit: boolean;
  editingNodeId: string | null;
  treeHandlers: TreeHandlers;
  onSelectEntry: (base: KnowledgeBase, entry: KnowledgeEntry) => void;
}

/**
 * The folder rail — the opened base's tree and nothing else (Samuel's ruling,
 * 2026-08-28: "left column: THIN folder tree").
 *
 * It carries no breadcrumb: the panel has ONE header
 * (`../detail/base-header.tsx`) holding the one crumb; the rail holds the tree.
 *
 * 🔒 NO COLLAPSE TOGGLE (Samuel, 2026-09-29: "remove the toggle for hiding
 * it"). The rail's WIDTH is the operator's instead — the drag bar beside it
 * (`./rail-resize-handle.tsx`), which the shell mounts between this column and
 * the detail pane. The width itself is `../knowledge-v2.module.css › .rail`.
 */
export function ListPanel({
  base,
  tree,
  selectedEntryId,
  canEdit,
  editingNodeId,
  treeHandlers,
  onSelectEntry,
}: Props) {
  return (
    <div className={styles.rail}>
      <h2 className={styles.railHead}>Files</h2>

      <div className={styles.railBody}>
        {!tree || tree.status === "loading" ? (
          // skeleton, not a "Loading…" line (docs/DESIGN-SYSTEM.md). The
          // shimmer is aria-hidden, so the status role and sr-only label must
          // live on THIS wrapper or the announcement is lost.
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
