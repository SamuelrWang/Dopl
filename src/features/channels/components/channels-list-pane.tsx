"use client";

import { Hash, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { Channel } from "../types";

export type ChannelTab = "active" | "archived";

interface Props {
  channels: Channel[];
  tab: ChannelTab;
  onTabChange: (tab: ChannelTab) => void;
  query: string;
  onQueryChange: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canCreate: boolean;
  onCreate: () => void;
}

/**
 * Left master pane: title + count header with the create action, a
 * concave search well, the Active | Archived switcher, and the channel
 * rows (selected indicator bar, unread dot, member + activity meta).
 */
export function ChannelsListPane({
  channels,
  tab,
  onTabChange,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  canCreate,
  onCreate,
}: Props) {
  const q = query.trim().toLowerCase();
  const visible = channels.filter(
    (c) =>
      q === "" ||
      c.name.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q) ||
      c.topic.toLowerCase().includes(q)
  );

  return (
    <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
      <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
        <h1 className="text-title font-semibold tracking-tight text-text-primary">
          Channels
        </h1>
        <span className="text-caption text-text-muted">{channels.length}</span>
        <span className="flex-1" />
        {canCreate && (
          <button
            type="button"
            onClick={onCreate}
            aria-label="New channel"
            title="New channel"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
          >
            <Plus size={16} />
          </button>
        )}
      </div>

      <div className="mx-3.5 mb-3">
        <SearchField
          value={query}
          onChange={onQueryChange}
          placeholder="Search channels"
        />
      </div>

      <SegmentedControl
        options={[
          { key: "active" as const, label: "Active" },
          { key: "archived" as const, label: "Archived" },
        ]}
        value={tab}
        onChange={onTabChange}
        className="mx-3.5 mb-3"
      />

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-default pb-4">
        {visible.length === 0 ? (
          <p className="px-4 py-2.5 text-caption leading-relaxed text-text-muted">
            {q
              ? "No channels match."
              : tab === "archived"
                ? "No archived channels."
                : "No channels yet."}
          </p>
        ) : (
          visible.map((c) => (
            <ChannelRow
              key={c.id}
              channel={c}
              selected={c.id === selectedId}
              onSelect={() => onSelect(c.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ChannelRow({
  channel: c,
  selected,
  onSelect,
}: {
  channel: Channel;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors",
        selected ? "bg-surface-raised-3" : "hover:bg-surface-raised-1"
      )}
    >
      {selected && (
        <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-[3px] bg-text-primary" />
      )}
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-inset text-text-secondary">
        <Hash size={12} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 truncate text-body text-text-primary",
              c.unread ? "font-semibold" : "font-medium"
            )}
          >
            {c.name}
          </span>
          {c.unread && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary" />
          )}
          <span className="flex-1" />
          <span className="shrink-0 text-micro text-text-muted">
            {c.lastMessageAt ? formatRelativeTime(c.lastMessageAt) : ""}
          </span>
        </span>
        <span className="block truncate text-caption text-text-secondary">
          {c.visibility === "public" ? "Public" : "Private"} ·{" "}
          {c.memberCount} {c.memberCount === 1 ? "member" : "members"}
          {c.topic ? ` · ${c.topic}` : ""}
        </span>
      </span>
    </button>
  );
}
