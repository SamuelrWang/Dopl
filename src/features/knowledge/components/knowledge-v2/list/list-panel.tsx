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
 * THE FOLDER RAIL — the opened base's tree, and nothing else (Samuel's ruling,
 * 2026-08-28: "left column: THIN collapsible folder tree").
 *
 * ⚠ IT LOST ITS BREADCRUMB, WHICH IS THE POINT. This pane used to carry a
 * `Knowledge › {base}` crumb while the detail pane beside it carried a SECOND
 * one — two navs, on screen together, that this file's own comment had to warn
 * a screen reader could not tell apart. The panel has ONE header now
 * (`../detail/base-header.tsx`) and it holds the ONE crumb; the rail holds the
 * tree.
 *
 * ⚠ COLLAPSE STATE IS LOCAL, and belongs here: nothing outside this column
 * renders differently for it, and lifting it would put a rail concern in the
 * view root that composes three faces. The MECHANIC — a strip, not a
 * disappearance, at 150ms, reduced-motion aware — is the module's
 * (`../knowledge-v2.module.css › .rail`), which is where the argument for it
 * is written down.
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
            // Skeleton, not a "Loading…" line (docs/DESIGN-SYSTEM.md: no text
            // loaders). ⚠ Shimmer is aria-hidden, so the status role and
            // sr-only label must live on THIS wrapper or the announcement is
            // lost.
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
