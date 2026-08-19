"use client";

/**
 * Channels v2 — LEFT COLUMN: a quiet nav list, Favorites, Direct messages and
 * the channel tree, over the REAL channel list (`use-channels`).
 *
 * No workspace switcher — the app shell already owns workspace identity, so a
 * second name-and-chevron in this column was two claims to the same thing.
 *
 * ACTIVE threads nest one indent step under the channel they belong to
 * (MAPPING.md § Sidebar). ⚠ Only under the OPEN channel: `use-channel-threads`
 * is a per-channel read and this phase adds no fetch paths, so the tree can
 * only nest what has been read. Nesting every channel at once is a
 * workspace-wide thread read that does not exist and would be a new endpoint,
 * not a new component.
 *
 * SELECTION MIRRORS THE CENTER PANE (rule changed 2026-08-17): whatever the
 * middle column is showing wears `.raised-tab`. With a thread open, the THREAD
 * row is selected and its channel drops back to resting; with no thread open,
 * the open channel is selected. A thread the tree does not show (outside the
 * 24h window, so it has no row) leaves its channel selected rather than
 * selecting nothing.
 *
 * INTERACTION COMPLETENESS (Samuel, 2026-08-18): the section chevrons COLLAPSE
 * for real and the header's search FILTERS the list. Nothing in this column is
 * inert chrome except the furniture explicitly marked hardcoded.
 */

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { SearchField } from "@/shared/ui/search-field";
import { IconButton, NewPill, SectionHeader } from "./bits";
import { ChannelRow, NavRow, SidebarRow, ThreadRow } from "./sidebar-rows";
import { IconTile } from "./bits";
import {
  HARDCODED_FAVORITE_ROWS,
  HARDCODED_NAV_ROWS,
  INBOX_NAV_ROW,
} from "./fixtures";
import {
  channelDisplayName,
  channelDisplayPeerPerson,
} from "../../lib/channel-display";
import type { Channel, ChannelMember, ChannelThread } from "../../types";

export interface ChannelsV2SidebarProps {
  rooms: Channel[];
  direct: Channel[];
  /** Threads of the OPEN channel, already windowed to the sidebar's rule
   *  (active in the last 24h OR requested — `view-model-requested.ts`). */
  threads: ChannelThread[];
  /** Thread ids the viewer has been asked about and has not answered. */
  requestedThreads: ReadonlySet<string>;
  members: ChannelMember[];
  currentUserId: string;
  selectedChannelId: string | null;
  openThreadId: string | null;
  onSelectChannel: (id: string) => void;
  onOpenThread: (id: string) => void;
  /** Pending consent requests — a REAL count, so the Inbox row gets a badge. */
  consentCount: number;
  /** The center pane is showing the inbox, so the Inbox row is the selected one. */
  inboxOpen: boolean;
  onOpenInbox: () => void;
  /** `member` or better — below it the server refuses a create (both `+` hide). */
  canCreate: boolean;
  /** The Channels section's `+` — opens `create-channel-dialog.tsx`. */
  onCreateChannel: () => void;
  /** The Direct messages section's `+` — opens `direct-message-dialog.tsx`. */
  onCreateDirect: () => void;
}

type SectionKey = "favorites" | "direct" | "rooms";

/** What a section says when the FILTER emptied it — distinct from what it says
 *  when the section is genuinely empty. ⚠ Exported for the test: a silent
 *  section and a section saying "nothing matches" look identical to a
 *  screenshot and are opposite facts. */
export const SIDEBAR_NO_MATCHES = "No matches.";

export function ChannelsV2Sidebar({
  rooms,
  direct,
  threads,
  requestedThreads,
  members,
  currentUserId,
  selectedChannelId,
  openThreadId,
  onSelectChannel,
  onOpenThread,
  consentCount,
  inboxOpen,
  onOpenInbox,
  canCreate,
  onCreateChannel,
  onCreateDirect,
}: ChannelsV2SidebarProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionKey>>(
    () => new Set()
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const toggle = (key: SectionKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const name = (c: Channel) => channelDisplayName(c, members, currentUserId);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return () => true;
    return (c: Channel) => name(c).toLowerCase().includes(needle);
    // `name` closes over `members`/`currentUserId`, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, members, currentUserId]);

  // A thread the tree cannot show leaves the channel row selected rather than
  // selecting nothing at all. ⚠ The INBOX outranks both: selection mirrors the
  // center pane, and with the inbox open the pane is showing neither.
  const threadSelected =
    openThreadId !== null && threads.some((t) => t.id === openThreadId);

  // Filtered ONCE, per section, and read by both the rows and the empty line —
  // two `.filter()` calls would let the guard and the list disagree.
  const directShown = direct.filter(matches);
  const roomsShown = rooms.filter(matches);

  const branch = (channel: Channel) => (
    <ChannelBranch
      key={channel.id}
      channel={channel}
      label={name(channel)}
      person={channelDisplayPeerPerson(channel, members, currentUserId)}
      selected={channel.id === selectedChannelId && !threadSelected && !inboxOpen}
      threads={channel.id === selectedChannelId ? threads : []}
      requestedThreads={requestedThreads}
      openThreadId={inboxOpen ? null : openThreadId}
      onSelectChannel={onSelectChannel}
      onOpenThread={onOpenThread}
    />
  );

  return (
    <aside
      aria-label="Channels"
      className="flex w-[260px] shrink-0 flex-col border-r border-border-default"
    >
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-3">
        {searchOpen ? (
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Filter channels"
            size="sm"
            className="min-w-0 flex-1"
          />
        ) : (
          <span className="flex-1" />
        )}
        <IconButton
          icon={Search}
          label="Search"
          active={searchOpen}
          onClick={() => {
            setSearchOpen((open) => !open);
            setQuery("");
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <nav className="flex flex-col gap-px px-2">
          {HARDCODED_NAV_ROWS.map(({ id, label, icon, isNew }) => (
            // HARDCODED — no backing data yet (Samuel 2026-08-18). Assistant,
            // Drafts and Saved items have no store of any kind; they keep the
            // mock's UI and are wired later as their own work.
            <NavRow
              key={id}
              label={label}
              icon={icon}
              trailing={isNew ? <NewPill /> : undefined}
            />
          ))}
          {/* WIRED: the consent inbox lives in this row (MAPPING.md § Q&A,
              second round), its badge is the real pending count, and since
              Phase 8 the row OPENS the inbox — the center column lists every
              request waiting on this viewer as a launch panel. */}
          <NavRow
            label={INBOX_NAV_ROW.label}
            icon={INBOX_NAV_ROW.icon}
            badge={consentCount > 0 ? consentCount : undefined}
            active={inboxOpen}
            onClick={onOpenInbox}
          />
        </nav>

        <SectionHeader
          title="Favorites"
          open={!collapsed.has("favorites")}
          onToggle={() => toggle("favorites")}
        />
        {!collapsed.has("favorites") && (
          <div className="flex flex-col gap-px px-2">
            {/* HARDCODED — no backing data yet (Samuel 2026-08-18). Favourites
                are a client-side preference with no column and no local store. */}
            {HARDCODED_FAVORITE_ROWS.map(({ id, label, icon: Icon }) => (
              <SidebarRow key={id} label={label}>
                <IconTile>
                  <Icon size={14} />
                </IconTile>
                <span className="truncate">{label}</span>
              </SidebarRow>
            ))}
          </div>
        )}

        <SectionHeader
          title="Direct messages"
          open={!collapsed.has("direct")}
          onToggle={() => toggle("direct")}
          actions={
            canCreate ? (
              <IconButton
                icon={Plus}
                label="New direct message"
                size={13}
                className="h-5 w-5"
                onClick={onCreateDirect}
              />
            ) : undefined
          }
        />
        {!collapsed.has("direct") && (
          <div className="flex flex-col gap-px px-2">
            {directShown.map(branch)}
            {/* ⚠ THE GUARD READS THE FILTERED LIST, NOT THE RAW ONE. Reading
                `direct.length` meant a query that matched nothing rendered
                NEITHER rows nor an empty line — a section that looked broken
                rather than one that had answered. The two absences are also
                different facts and are worded differently: "none exist" is not
                "none match what you typed". */}
            {directShown.length === 0 && (
              <EmptyRow
                label={
                  direct.length === 0
                    ? "No direct messages yet."
                    : SIDEBAR_NO_MATCHES
                }
              />
            )}
          </div>
        )}

        <SectionHeader
          title="Channels"
          open={!collapsed.has("rooms")}
          onToggle={() => toggle("rooms")}
          actions={
            // WIRED at the cutover (wiring plan Phase 12): the old page's
            // create dialog is the SAME dialog, re-hosted here — this `+` was
            // the entry point the plan named for it.
            canCreate ? (
              <IconButton
                icon={Plus}
                label="Add channel"
                size={13}
                className="h-5 w-5"
                onClick={onCreateChannel}
              />
            ) : undefined
          }
        />
        {!collapsed.has("rooms") && (
          <div className="flex flex-col gap-px px-2">
            {roomsShown.map(branch)}
            {roomsShown.length === 0 && (
              <EmptyRow
                label={
                  rooms.length === 0 ? "No channels yet." : SIDEBAR_NO_MATCHES
                }
              />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

/** One tree row plus the active threads nested under it. */
function ChannelBranch({
  channel,
  label,
  person,
  selected,
  threads,
  requestedThreads,
  openThreadId,
  onSelectChannel,
  onOpenThread,
}: {
  channel: Channel;
  label: string;
  person: ReturnType<typeof channelDisplayPeerPerson>;
  selected: boolean;
  threads: ChannelThread[];
  requestedThreads: ReadonlySet<string>;
  openThreadId: string | null;
  onSelectChannel: (id: string) => void;
  onOpenThread: (id: string) => void;
}) {
  return (
    <>
      <ChannelRow
        label={label}
        person={person}
        selected={selected}
        unread={channel.unread}
        onSelect={() => onSelectChannel(channel.id)}
      />
      {threads.map((thread) => (
        <ThreadRow
          key={thread.id}
          thread={thread}
          selected={thread.id === openThreadId}
          requested={requestedThreads.has(thread.id)}
          onOpen={() => onOpenThread(thread.id)}
        />
      ))}
    </>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <p className="px-2 py-1.5 text-caption text-text-muted">{label}</p>;
}
