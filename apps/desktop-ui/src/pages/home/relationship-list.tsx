import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { peerLabel, type HomeFilter, type HomeRow } from "./home-rows";

/**
 * Home's left pane — the RELATIONSHIP list. Deliberately not the workspace
 * channels tree: one flat list of people, filterable, no sections to manage.
 *
 * ⚠ IT RENDERS `rows`, IT DOES NOT FILTER THEM. The page owns the filter state
 * and the filtered set, because the RECORD PANE resolves its selection from the
 * same set — filtering privately here let the pane fall back to a row the list
 * was no longer showing, so typing into search left a stranger's card open.
 */
export function RelationshipList({
  rows,
  linkCount,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
}: {
  /** Already filtered — the page's `visibleRows`. */
  rows: HomeRow[];
  /** Counted over ALL rows, so the tab's badge does not shrink as you type. */
  linkCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: HomeFilter;
  onFilterChange: (filter: HomeFilter) => void;
}) {
  const visible = rows;

  return (
    <div className="flex w-[290px] shrink-0 flex-col">
      <div className="flex flex-col gap-2.5 px-4 pb-2.5 pt-1">
        <SegmentedControl<HomeFilter>
          options={[
            { key: "all", label: "All" },
            { key: "links", label: "Links", count: linkCount },
          ]}
          value={filter}
          onChange={onFilterChange}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {visible.map((row) => (
          <RelationshipRow
            key={row.id}
            row={row}
            selected={row.id === selectedId}
            onSelect={() => onSelect(row.id)}
          />
        ))}
        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-caption text-text-muted">
            No matches
          </p>
        )}
      </div>
    </div>
  );
}

function RelationshipRow({
  row,
  selected,
  onSelect,
}: {
  row: HomeRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const pending = row.kind === "link";
  const name =
    row.kind === "relationship" ? peerLabel(row.relationship) : (row.link.label ?? "Link");
  const subline =
    row.kind === "relationship"
      ? (row.relationship.peer.email ?? "")
      : row.link.url;
  const lastLine =
    row.kind === "relationship"
      ? (row.relationship.lastMessagePreview ?? "No messages yet")
      : "Not yet claimed";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2.5 rounded-[10px] border px-2.5 py-2.5 text-left transition-colors",
        // On the inset base panel the selected row is a RAISED white card —
        // same layer language as the floating record beside it.
        selected
          ? "kanban-card border-border-default bg-bg-elevated"
          : "border-transparent hover:bg-surface-raised-2"
      )}
    >
      <Avatar
        person={
          row.kind === "relationship"
            ? {
                userId: row.relationship.peer.userId,
                email: row.relationship.peer.email,
                displayName: row.relationship.peer.displayName,
                avatarUrl: row.relationship.peer.avatarUrl,
              }
            : { userId: row.id, email: null, displayName: name, avatarUrl: null }
        }
        size="sm"
        className={cn(pending && "opacity-55")}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-body font-medium",
              pending ? "text-text-secondary" : "text-text-primary"
            )}
          >
            {name}
          </span>
          <span className="shrink-0 text-micro text-text-muted">
            {formatChannelTimestamp(row.at)}
          </span>
        </span>
        <span className="block truncate text-caption text-text-muted">
          {subline}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {pending && (
            <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 text-micro font-medium text-text-secondary">
              Link out
            </span>
          )}
          <span className="truncate text-caption text-text-muted">{lastLine}</span>
        </span>
      </span>
    </button>
  );
}
