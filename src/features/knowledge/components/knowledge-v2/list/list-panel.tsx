"use client";

import { ChevronDown, ListFilter, Plus, Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SegmentedControl } from "@/shared/ui/segmented-control";
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
  /** Display names for foreign base owners, keyed by user id. */
  ownerNames?: Record<string, string>;
  currentUserId: string;
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
  ownerNames,
  currentUserId,
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

      <SegmentedControl
        options={FILTERS}
        value={filter}
        onChange={onFilterChange}
        className="mx-3.5 mb-3"
      />

      <div className={styles.listBody}>
        {bases.length === 0 ? (
          <p className={styles.treeEmpty} style={{ padding: "10px 18px" }}>
            No knowledge bases match.
          </p>
        ) : (
          groupBases(bases, filter, currentUserId).map(({ label, items }) => (
            <div key={label ?? "own"}>
              {label && <p className={styles.listSection}>{label}</p>}
              {items.map((base) => (
                <KbRow
                  key={base.id}
                  base={base}
                  ownerName={
                    base.createdBy && base.createdBy !== currentUserId
                      ? (ownerNames?.[base.createdBy] ?? "Another member")
                      : null
                  }
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
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * On the All filter, other members' bases sit under a trailing
 * "Shared with me" section (mirrors the chats list). Other filters
 * render one unlabeled group.
 */
function groupBases(
  bases: KnowledgeBase[],
  filter: Filter,
  currentUserId: string
): Array<{ label: string | null; items: KnowledgeBase[] }> {
  if (filter !== "all") return [{ label: null, items: bases }];
  const own = bases.filter(
    (b) => b.createdBy === null || b.createdBy === currentUserId
  );
  const shared = bases.filter(
    (b) => b.createdBy !== null && b.createdBy !== currentUserId
  );
  const groups: Array<{ label: string | null; items: KnowledgeBase[] }> = [];
  if (own.length > 0) groups.push({ label: null, items: own });
  if (shared.length > 0) groups.push({ label: "Shared with me", items: shared });
  return groups;
}
