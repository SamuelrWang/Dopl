"use client";

import {
  ChevronDown,
  Database,
  ListFilter,
  Plus,
  Search,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { KnowledgeBase, KnowledgeEntry } from "../../../types";
import type { BaseTree, ListFilter as Filter } from "../types";
import type { TreeHandlers } from "../use-knowledge-v2-controller";
import { KbRow } from "./kb-row";
import styles from "../knowledge-v2.module.css";

const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "private", label: "Private" },
  { key: "team", label: "Team" },
  { key: "workspace", label: "Shared" },
];

interface Props {
  bases: KnowledgeBase[];
  query: string;
  onQueryChange: (q: string) => void;
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  selectedBaseId: string | null;
  selectedEntryId: string | null;
  expanded: Set<string>;
  trees: Record<string, BaseTree>;
  canEdit: (baseId: string) => boolean;
  editingNodeId: string | null;
  treeHandlers: TreeHandlers;
  onSelectBase: (base: KnowledgeBase) => void;
  onToggleExpand: (base: KnowledgeBase) => void;
  onSelectEntry: (base: KnowledgeBase, entry: KnowledgeEntry) => void;
  onCreate: () => void;
}

/**
 * Middle list pane: "Knowledge" header, search, scope filter tabs, and the
 * scrollable list of knowledge bases (each expandable to its file tree).
 */
export function ListPanel({
  bases,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  selectedBaseId,
  selectedEntryId,
  expanded,
  trees,
  canEdit,
  editingNodeId,
  treeHandlers,
  onSelectBase,
  onToggleExpand,
  onSelectEntry,
  onCreate,
}: Props) {
  return (
    <div className={styles.listPane}>
      <div className={styles.listHead}>
        <button type="button" className={styles.listTitle}>
          Knowledge
          <ChevronDown size={16} />
        </button>
        <div className={styles.headSpacer} />
        <button type="button" className={styles.iconBtn} aria-label="Filter">
          <ListFilter size={17} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="New knowledge base"
          onClick={onCreate}
        >
          <Plus size={18} />
        </button>
      </div>

      <div className={cn("concave-field", styles.search)}>
        <Search size={15} />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search"
          spellCheck={false}
        />
      </div>

      <div className={cn("concave-track", styles.tabs)}>
        <span
          className={cn("raised-tab", styles.tabThumb)}
          style={{
            transform: `translateX(calc(${Math.max(
              0,
              FILTERS.findIndex((f) => f.key === filter)
            )} * (100% + 4px)))`,
          }}
        />
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={cn(styles.tab, filter === key && styles.tabActive)}
            onClick={() => onFilterChange(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.listBody}>
        <div className={styles.sectionLabel}>
          <Database size={13} />
          Knowledge bases
        </div>

        {bases.length === 0 ? (
          <p className={styles.treeEmpty} style={{ padding: "10px 18px" }}>
            No knowledge bases match.
          </p>
        ) : (
          bases.map((base) => (
            <KbRow
              key={base.id}
              base={base}
              selected={selectedBaseId === base.id}
              expanded={expanded.has(base.id)}
              tree={trees[base.id]}
              selectedEntryId={selectedEntryId}
              canEdit={canEdit(base.id)}
              editingNodeId={editingNodeId}
              handlers={treeHandlers}
              onSelectBase={onSelectBase}
              onToggleExpand={onToggleExpand}
              onSelectEntry={onSelectEntry}
            />
          ))
        )}
      </div>
    </div>
  );
}
