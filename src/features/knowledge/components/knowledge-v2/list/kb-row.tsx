"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { KB_SCOPE_LABEL, kbScope } from "../../../scope";
import type { KnowledgeBase, KnowledgeEntry } from "../../../types";
import type { BaseTree as BaseTreeData } from "../types";
import type { TreeHandlers } from "../use-knowledge-v2-controller";
import { shortWhen } from "../utils";
import { BaseTree } from "./base-tree";
import styles from "../knowledge-v2.module.css";

interface Props {
  base: KnowledgeBase;
  selected: boolean;
  expanded: boolean;
  tree: BaseTreeData | undefined;
  selectedEntryId: string | null;
  canEdit: boolean;
  editingNodeId: string | null;
  handlers: TreeHandlers;
  onSelectBase: (base: KnowledgeBase) => void;
  onToggleExpand: (base: KnowledgeBase) => void;
  onSelectEntry: (base: KnowledgeBase, entry: KnowledgeEntry) => void;
}

/**
 * One knowledge base in the list pane. The disclosure chevron toggles the
 * inline folder/file tree (lazy-loaded); clicking the body selects the base
 * so the detail pane shows its overview. The expanded tree is the v2
 * `TreeRows` (CRUD + context menu, no drag-drop) via base-tree.tsx.
 */
export function KbRow({
  base,
  selected,
  expanded,
  tree,
  selectedEntryId,
  canEdit,
  editingNodeId,
  handlers,
  onSelectBase,
  onToggleExpand,
  onSelectEntry,
}: Props) {
  const sub = base.description || `${KB_SCOPE_LABEL[kbScope(base)]} knowledge base`;

  return (
    <div className={styles.kbItem}>
      <div className={cn(styles.kbRow, selected && styles.kbRowActive)}>
        <button
          type="button"
          aria-label={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          className={cn(styles.disclosure, expanded && styles.disclosureOpen)}
          onClick={() => onToggleExpand(base)}
        >
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          className={styles.rowBtn}
          onClick={() => onSelectBase(base)}
        >
          <span className={styles.rowMain}>
            <span className={styles.rowTopline}>
              <span className={styles.rowTitle}>{base.name}</span>
              <span className={styles.rowTime}>{shortWhen(base.updatedAt)}</span>
            </span>
            <span className={styles.rowSub}>
              <span className={styles.rowSubText}>{sub}</span>
            </span>
          </span>
        </button>
      </div>

      {expanded ? (
        <div className={styles.tree}>
          {!tree || tree.status === "loading" ? (
            <p className={styles.treeLoading}>Loading…</p>
          ) : tree.status === "error" ? (
            <p className={styles.treeEmpty}>Couldn’t load this base</p>
          ) : (
            <BaseTree
              base={base}
              tree={tree}
              selectedEntryId={selectedEntryId}
              canEdit={canEdit}
              editingNodeId={editingNodeId}
              handlers={handlers}
              onSelectEntry={onSelectEntry}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
