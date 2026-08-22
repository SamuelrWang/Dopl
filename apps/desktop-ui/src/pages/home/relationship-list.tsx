import { useMemo, useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { HomeChannel } from "./mock";

type Filter = "all" | "needs-you" | "links";

/**
 * Home's left pane — the RELATIONSHIP list. Deliberately not the workspace
 * channels tree: one flat list of people, filterable, no sections to manage.
 */
export function RelationshipList({
  channels,
  selectedId,
  onSelect,
  query,
}: {
  channels: HomeChannel[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Lives in the page header's search bar, beside New link. */
  query: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const needsYou = channels.filter((c) => c.status === "needs-you").length;
  const pending = channels.filter((c) => c.status === "pending").length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((c) => {
      if (filter === "needs-you" && c.status !== "needs-you") return false;
      if (filter === "links" && c.status !== "pending") return false;
      if (!q) return true;
      return (c.name + " " + c.context).toLowerCase().includes(q);
    });
  }, [channels, filter, query]);

  return (
    <div className="flex w-[290px] shrink-0 flex-col">
      <div className="flex flex-col gap-2.5 px-4 pt-1 pb-2.5">
        <SegmentedControl<Filter>
          options={[
            { key: "all", label: "All" },
            { key: "needs-you", label: "Needs you", count: needsYou },
            { key: "links", label: "Links", count: pending },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {visible.map((c) => (
          <RelationshipRow
            key={c.id}
            channel={c}
            selected={c.id === selectedId}
            onSelect={() => onSelect(c.id)}
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
  channel,
  selected,
  onSelect,
}: {
  channel: HomeChannel;
  selected: boolean;
  onSelect: () => void;
}) {
  const pending = channel.status === "pending";
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
        person={{
          userId: channel.id,
          email: channel.email,
          displayName: channel.name,
          avatarUrl: null,
        }}
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
            {channel.name}
          </span>
          <span className="shrink-0 text-micro text-text-muted">
            {channel.lastTime}
          </span>
        </span>
        <span className="block truncate text-caption text-text-muted">
          {channel.context}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {channel.status === "needs-you" && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
          )}
          {pending && (
            <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 text-micro font-medium text-text-secondary">
              Link out
            </span>
          )}
          <span
            className={cn(
              "truncate text-caption",
              channel.status === "needs-you"
                ? "font-medium text-text-secondary"
                : "text-text-muted"
            )}
          >
            {channel.lastLine}
          </span>
        </span>
      </span>
    </button>
  );
}
