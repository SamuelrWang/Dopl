"use client";

import { useState } from "react";
import { Hash, MessageSquarePlus, Plus, ShieldQuestion } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { Avatar } from "@/shared/ui/avatar";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { channelDisplayAvatarPerson, channelDisplayName } from "../lib/channel-display";
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
  /** Open the new-direct-message picker. */
  onCreateDirect: () => void;
  /** Channels with a pending consent decision — flagged with an amber pip. */
  consentChannelIds: Set<string>;
}

/**
 * Left master pane: title + count header with the create menu, a concave
 * search well, the Active | Archived switcher, and the channel rows split into
 * a "Direct messages" section (1:1 threads, rendered with the peer's avatar +
 * name) and the regular channels section.
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
  onCreateDirect,
  consentChannelIds,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const visible = channels.filter(
    (c) =>
      q === "" ||
      c.name.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q) ||
      c.topic.toLowerCase().includes(q) ||
      channelDisplayName(c).toLowerCase().includes(q)
  );

  const directs = visible.filter((c) => c.isDirect);
  const normals = visible.filter((c) => !c.isDirect);

  return (
    <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
      <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
        <h1 className="text-title font-semibold tracking-tight text-text-primary">
          Channels
        </h1>
        <span className="text-caption text-text-muted">{channels.length}</span>
        <span className="flex-1" />
        {canCreate && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="New"
              title="New"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
            >
              <Plus size={16} />
            </button>
            <Popover
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              align="right"
              className="min-w-[200px]"
            >
              <MenuItem
                icon={<Hash size={14} />}
                onSelect={() => {
                  setMenuOpen(false);
                  onCreate();
                }}
              >
                New channel
              </MenuItem>
              <MenuItem
                icon={<MessageSquarePlus size={14} />}
                onSelect={() => {
                  setMenuOpen(false);
                  onCreateDirect();
                }}
              >
                New direct message
              </MenuItem>
            </Popover>
          </div>
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
          <>
            {directs.length > 0 && (
              <>
                <SectionLabel>Direct messages</SectionLabel>
                {directs.map((c) => (
                  <DirectRow
                    key={c.id}
                    channel={c}
                    selected={c.id === selectedId}
                    hasConsent={consentChannelIds.has(c.id)}
                    onSelect={() => onSelect(c.id)}
                  />
                ))}
              </>
            )}
            {normals.length > 0 && (
              <>
                {directs.length > 0 && <SectionLabel>Channels</SectionLabel>}
                {normals.map((c) => (
                  <ChannelRow
                    key={c.id}
                    channel={c}
                    selected={c.id === selectedId}
                    hasConsent={consentChannelIds.has(c.id)}
                    onSelect={() => onSelect(c.id)}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3.5 pb-1 pt-2.5 text-label font-semibold uppercase tracking-wide text-text-secondary">
      {children}
    </p>
  );
}

function ChannelRow({
  channel: c,
  selected,
  hasConsent,
  onSelect,
}: {
  channel: Channel;
  selected: boolean;
  hasConsent: boolean;
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
          {hasConsent && (
            <span
              role="img"
              aria-label="Pending approval"
              className="flex shrink-0 items-center text-warning"
            >
              <ShieldQuestion size={13} aria-hidden />
            </span>
          )}
          <span className="flex-1" />
          <span className="shrink-0 text-micro text-text-muted">
            {c.lastMessageAt ? formatChannelTimestamp(c.lastMessageAt) : ""}
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

function DirectRow({
  channel: c,
  selected,
  hasConsent,
  onSelect,
}: {
  channel: Channel;
  selected: boolean;
  hasConsent: boolean;
  onSelect: () => void;
}) {
  const peer = channelDisplayAvatarPerson(c);
  const name = channelDisplayName(c);
  const person = peer
    ? {
        userId: peer.userId,
        email: null,
        displayName: peer.displayName,
        avatarUrl: peer.avatarUrl,
      }
    : { userId: c.id, email: null, displayName: name, avatarUrl: null };

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
      <Avatar person={person} size="xs" />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={cn(
            "min-w-0 truncate text-body text-text-primary",
            c.unread ? "font-semibold" : "font-medium"
          )}
        >
          {name}
        </span>
        {c.unread && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary" />
        )}
        {hasConsent && (
          <span
            role="img"
            aria-label="Pending approval"
            className="flex shrink-0 items-center text-warning"
          >
            <ShieldQuestion size={13} aria-hidden />
          </span>
        )}
        <span className="flex-1" />
        <span className="shrink-0 text-micro text-text-muted">
          {c.lastMessageAt ? formatChannelTimestamp(c.lastMessageAt) : ""}
        </span>
      </span>
    </button>
  );
}
