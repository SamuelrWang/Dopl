"use client";

import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  OPEN_SCALE_ICON_ONLY,
  OpenScaleIconButton,
} from "@/shared/ui/open-scale-button";
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
 * 2026-08-28: "left column: THIN collapsible folder tree").
 *
 * It carries no breadcrumb: the panel has ONE header
 * (`../detail/base-header.tsx`) holding the one crumb; the rail holds the tree.
 *
 * Collapse state is local — nothing outside this column renders differently for
 * it. The mechanic (a strip, not a disappearance, 150ms, reduced-motion aware)
 * is the module's (`../knowledge-v2.module.css › .rail`).
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
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={cn(styles.rail, collapsed && styles.railCollapsed)}
    >
      <OpenScaleIconButton
        className={styles.railToggle}
        aria-label={collapsed ? "Show files" : "Hide files"}
        title={collapsed ? "Show files" : "Hide files"}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((prev) => !prev)}
      >
        {collapsed ? (
          <PanelLeftOpen size={OPEN_SCALE_ICON_ONLY} />
        ) : (
          <PanelLeftClose size={OPEN_SCALE_ICON_ONLY} />
        )}
      </OpenScaleIconButton>

      <div className={styles.railInner}>
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
    </div>
  );
}
