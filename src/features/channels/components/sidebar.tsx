"use client";

/**
 * Channels — LEFT COLUMN: a quiet nav list, Favorites, Direct messages and
 * the channel tree, over the REAL channel list (`use-channels`).
 *
 * No workspace switcher — the app shell already owns workspace identity, so a
 * second name-and-chevron in this column was two claims to the same thing.
 *
 * ACTIVE threads nest one indent step under the channel they belong to
 * (the port's intent doc § Sidebar, deleted at the Phase 12 cutover —
 * INVARIANTS §5). ⚠ Only under the OPEN channel: `use-channel-threads`
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
 * for real. Nothing in this column is inert chrome except the furniture
 * explicitly marked hardcoded.
 *
 * 🔒 **THE HEADER'S SEARCH NO LONGER FILTERS THIS LIST — IT OPENS THE SEARCH
 * POPUP (Samuel, 2026-09-17:** *"right now, during search, it just filters by
 * channel name, and it like removes channel on the left sidebar. that doesnt
 * make sense, it should be a pop up like this."* … *"It's basically doing a text
 * search across the home space."*). The `matches` predicate, the three filtered
 * lists and `SIDEBAR_NO_MATCHES` are DELETED, not disarmed; the column shows
 * every channel the caller has, always, and the query is answered in a card
 * under the field by `@/features/search/components/search-popup` — the SAME
 * component /home's header pill hosts, at `scope="container"`.
 *
 * ⚠ FAVORITES IS REAL (Samuel, 2026-08-19), superseding the keep-hardcoded
 * ruling for THIS section only — the Assistant / Drafts / Saved-items nav rows
 * above it are still `fixtures.ts` furniture. Four properties, each of which a
 * redesign would lose quietly:
 *
 *  1. **A FAVOURITE IS A MOVE, NOT A SHORTCUT (Samuel, 2026-08-19 — this
 *     supersedes the SHORTCUT / Slack-semantics ruling of the same day).** A
 *     favourited channel renders HERE and NOWHERE ELSE; un-favouriting returns
 *     it to Channels or Direct messages. ONE channel is ONE row in this column,
 *     which is what keeps the unread dot and the selection ring unambiguous —
 *     the same channel seen twice was two places to look for one fact, and two
 *     rows to reconcile after every write.
 *     ⚠ A HOME SECTION EMPTIED BY THE MOVE still renders its header and its
 *     "none yet" line, exactly as it would with no channels at all: the rows
 *     are one section up, and the reader is looking at the column that holds
 *     them. No second wording — "they all moved" is not a fact worth a line.
 *  2. **SAME ROW ANATOMY *and the same thread nesting* as the sections below** —
 *     `ChannelBranch`, so a DM's favourite is its peer's face and a channel's is
 *     the hash tile, the unread dot rides along, and the OPEN channel's active
 *     threads nest under it here. Under move semantics this section IS the
 *     channel's home, so a favourited channel that lost its thread rows would
 *     have lost them from the sidebar entirely.
 *  3. **ORDERED BY NAME**, not by `myFavoritedAt` and not by the list's own
 *     recency. A shortcut list is used by POINTING, and alphabetical is the only
 *     order that never reorders under traffic. (The column stores WHEN anyway —
 *     see the migration; a boolean could not be turned into an order later.)
 *  4. **NO FAVOURITES → NO SECTION HEADER AT ALL.** Unlike the two sections
 *     below, which always say "No channels yet.", an empty Favorites section is
 *     not a fact worth a line: favouriting is optional organisation, and a
 *     header for a feature you have never used is noise in the one column that
 *     has to stay scannable. ⚠ **THE FILTER WAS THE EXCEPTION TO THIS AND THE
 *     EXCEPTION IS GONE (2026-09-17)** — no query empties a section any more, so
 *     an empty section has exactly one meaning again.
 */

import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { SearchField } from "@/shared/ui/search-field";
import { SearchPopup } from "@/features/search/components/search-popup";
import { apiSearchFetcher } from "@/features/search/search-client";
import type { SearchItem } from "@/features/search/contracts";
import { IconButton, NewPill, SectionHeader } from "./bits";
import { NavRow } from "./sidebar-rows";
import { ChannelBranch } from "./sidebar-branch";
import { HARDCODED_NAV_ROWS } from "./fixtures";
import {
  channelDisplayName,
  channelDisplayPeerPerson,
} from "../lib/channel-display";
import type { Channel, ChannelMember, ChannelThread } from "../types";

export interface ChannelsSidebarProps {
  /** THE CONTAINER THE SEARCH POPUP RUNS IN — `scope="container"` is this id. */
  workspaceId: string;
  rooms: Channel[];
  direct: Channel[];
  /** Threads of the OPEN channel, already windowed to the sidebar's rule
   *  (active in the last 24h OR requested — `view-model-requested.ts`). */
  threads: ChannelThread[];
  members: ChannelMember[];
  currentUserId: string;
  selectedChannelId: string | null;
  openThreadId: string | null;
  onSelectChannel: (id: string) => void;
  onOpenThread: (id: string) => void;
  /** `member` or better — below it the server refuses a create (both `+` hide). */
  canCreate: boolean;
  /** The Channels section's `+` — opens `create-channel-dialog.tsx`. */
  onCreateChannel: () => void;
  /** The Direct messages section's `+` — opens `direct-message-dialog.tsx`. */
  onCreateDirect: () => void;
  /** A search-popup row was taken. ⚠ THE HOST OPENS IT: this tree is router-free
   *  by construction (`channels-core.tsx`), so "go to the Knowledge page" cannot
   *  be decided here. Channel, thread and message rows are answered by the core
   *  itself through the selection it already owns. */
  onSearchNavigate: (item: SearchItem) => void;
}

type SectionKey = "favorites" | "direct" | "rooms";

/**
 * 🔒 **`SIDEBAR_NO_MATCHES` IS DELETED (2026-09-17).** It was what a section said
 * when the FILTER emptied it, and there is no filter: the header's field opens
 * the search popup now. **Do not re-mint it** — a section can only be empty for
 * one reason again, and each already has its own sentence for that.
 */

export function ChannelsSidebar({
  workspaceId,
  rooms,
  direct,
  threads,
  members,
  currentUserId,
  selectedChannelId,
  openThreadId,
  onSelectChannel,
  onOpenThread,
  canCreate,
  onCreateChannel,
  onCreateDirect,
  onSearchNavigate,
}: ChannelsSidebarProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionKey>>(
    () => new Set()
  );
  // ⚠ PER CHANNEL, ABSENT = OPEN — the same idiom as the section headers above,
  // and for the same reason: a channel this session has never seen needs no
  // entry, so "default expanded" costs nothing to represent. Session-local
  // (Samuel, 2026-08-20): a collapse is glance management, not a preference.
  const [threadsCollapsed, setThreadsCollapsed] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const toggle = (key: SectionKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleThreads = (channelId: string) =>
    setThreadsCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });

  const name = (c: Channel) => channelDisplayName(c, members, currentUserId);

  // A thread the tree cannot show leaves the channel row selected rather than
  // selecting nothing at all. ⚠ THE INBOX USED TO OUTRANK BOTH and is deleted
  // (Samuel, 2026-08-25): the center pane can no longer be showing neither, so
  // there is no third state for this selection to mirror.
  const threadSelected =
    openThreadId !== null && threads.some((t) => t.id === openThreadId);

  // ⚠ `!= null`, NOT `!== null`: an older deployed server has no `favorited_at`
  // column to send, so the field arrives `undefined` and a strict compare would
  // read every channel as favourited (INVARIANTS §5, §13's ship order).
  const isFavorite = (c: Channel) => c.myFavoritedAt != null;
  // FAVORITES — a partition of the SAME two lists, never a third read: DMs and
  // channels both, ordered by name (see the docblock). `localeCompare` rather
  // than `<`, so accented and non-ASCII names sort where a reader expects.
  const favorites = [...direct, ...rooms].filter(isFavorite);
  // A MOVE, so each home list is what did NOT move. ⚠ **AND THESE ARE THE LISTS
  // THE SECTIONS RENDER — there is no second, narrowed set since 2026-09-17**
  // (the `matches` predicate and the three `*Shown` lists went with the filter).
  const directHome = direct.filter((c) => !isFavorite(c));
  const roomsHome = rooms.filter((c) => !isFavorite(c));
  const favoritesSorted = [...favorites].sort((a, b) =>
    name(a).localeCompare(name(b))
  );

  const branch = (channel: Channel) => (
    <ChannelBranch
      key={channel.id}
      channel={channel}
      label={name(channel)}
      person={channelDisplayPeerPerson(channel, members, currentUserId)}
      selected={channel.id === selectedChannelId && !threadSelected}
      threads={channel.id === selectedChannelId ? threads : []}
      openThreadId={openThreadId}
      collapsed={threadsCollapsed.has(channel.id)}
      onToggleThreads={toggleThreads}
      onSelectChannel={onSelectChannel}
      onOpenThread={onOpenThread}
    />
  );

  return (
    <aside
      aria-label="Channels"
      className="flex w-[260px] shrink-0 flex-col border-r border-border-default"
    >
      {/* ⚠ `relative` IS WHAT ANCHORS THE POPUP, exactly as `.search-expand`'s
          own `position: relative` anchors /home's — the card is a child of the
          field's row and lands on its edges with a plain `left-0 right-0`. */}
      <div className="relative flex h-[52px] shrink-0 items-center gap-2 px-3">
        {searchOpen ? (
          <SearchField
            value={query}
            onChange={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            autoFocus
            /* ⚠ **NOT "Filter channels" ANY MORE** — it filters nothing; it
                searches the workspace. */
            placeholder="Search"
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
        {searchOpen && (
          <SearchPopup
            query={query}
            focused={searchFocused}
            scope="container"
            containerId={workspaceId}
            onNavigate={onSearchNavigate}
            onClose={() => {
              setQuery("");
              setSearchFocused(false);
            }}
            onQueryChange={setQuery}
            /* ⚠ **THE REAL ENDPOINT SINCE 2026-09-17**, when `feat/search-api`
               merged — `GET /api/search?scope=container&container=<id>`, which
               is the ONE thing this host passes that /home's does not. The
               fixture table it opened on is test and dev data now. */
            fetcher={apiSearchFetcher}
            /* ⚠ **THE PIN ONLY — THE WIDTH IS THE CARD'S OWN SINCE 2026-09-17**
               (`search-popup.tsx › SEARCH_CARD_W`, 280px). This read
               `!w-[420px]`, which is a second declaration of a width the card
               states for itself; the card came down a step and this copy would
               have kept the old one. The column is 260px and the card is
               slightly wider, so it stays pinned to the column's LEFT edge and
               opens into the page rather than off-screen. */
            className="!right-auto left-3"
          />
        )}
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
          {/* ⚠ THE INBOX ROW STOOD HERE AND IS DELETED (Samuel, 2026-08-25). It
              was the ONLY wired row in this nav — its badge counted the pending
              outbound drafts and clicking it took the center column over with
              `inbox-pane.tsx`. Both are gone: the outbound review is the work
              stream's own card now (`agent-stream.tsx › SentToChannelBox`), and
              a solo /home channel — which never had this nav at all — can reach
              it. Do not re-add a row for a pane that does not exist. */}
        </nav>

        {/* ⚠ THE WHOLE SECTION IS ABSENT WITH NO FAVOURITES — header included.
            The guard reads the UNFILTERED list, which is what keeps the header
            standing (and saying "No matches.") when a query emptied a section
            that does have rows. */}
        {favorites.length > 0 && (
          <>
            <SectionHeader
              title="Favorites"
              open={!collapsed.has("favorites")}
              onToggle={() => toggle("favorites")}
            />
            {!collapsed.has("favorites") && (
              <div className="flex flex-col gap-px px-2">
                {/* THE SAME `branch` THE SECTIONS BELOW RENDER, threads and all.
                    It was a bare `ChannelRow` while a favourite was a shortcut
                    and the tree below still held the channel; with the MOVE
                    (2026-08-19) this section is the channel's only row, so
                    dropping the nesting here would drop the open channel's
                    threads out of the column altogether. */}
                {favoritesSorted.map(branch)}
              </div>
            )}
          </>
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
            {directHome.map(branch)}
            {/* ⚠ THE WORDING READS `directHome`, NOT `direct`: with everything
                favourited the section has nothing to show, and "none yet" is the
                honest line for it. ⚠ **ITS `SIDEBAR_NO_MATCHES` TWIN IS DELETED
                (2026-09-17)** — no query can empty this section any more. */}
            {directHome.length === 0 && (
              <EmptyRow label="No direct messages yet." />
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
            {roomsHome.map(branch)}
            {roomsHome.length === 0 && <EmptyRow label="No channels yet." />}
          </div>
        )}
      </div>
    </aside>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <p className="px-2 py-1.5 text-caption text-text-muted">{label}</p>;
}
