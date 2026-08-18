/**
 * Channels v2 — LEFT COLUMN: a quiet nav list, Favorites, Direct messages and
 * the channel tree.
 *
 * No workspace switcher — the app shell already owns workspace identity, so a
 * second name-and-chevron in this column was two claims to the same thing. The
 * header keeps only the search affordance.
 *
 * ACTIVE and REQUESTED threads nest one indent step under the row they belong
 * to, derived from `mock-threads.ts › SIDEBAR_THREADS_BY_PARENT` — inactive
 * threads never appear here, they live only in the right panel's Threads tab.
 * The second glyph carries which of the two a row is (see `ThreadTreeRow`).
 *
 * SELECTION MIRRORS THE CENTER PANE: whatever the middle column is showing is
 * the row wearing `.raised-tab`. Open a thread that has a row here and the
 * THREAD row is selected while its channel goes back to resting; with no thread
 * open, the open channel is selected (MAPPING.md § Sidebar).
 */

import { Bot, Clock, CornerDownRight, Hash, Plus, Search } from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import {
  CountBadge,
  IconButton,
  IconTile,
  NewPill,
  SectionHeader,
} from "./bits";
import {
  CHANNEL_ROWS,
  DM_ROWS,
  FAVORITE_ROWS,
  NAV_ROWS,
  type ChannelRow,
} from "./mock-data";
import {
  SIDEBAR_THREADS_BY_PARENT,
  THREAD_TRANSCRIPTS,
  type MockThread,
} from "./mock-threads";

const DEPTH_PAD = ["pl-2", "pl-5"] as const;

/** Every thread that has a row in this tree — the set the selection rule asks
 *  about before it hands `.raised-tab` to a thread instead of its channel. */
const SIDEBAR_THREAD_IDS = new Set(
  Object.values(SIDEBAR_THREADS_BY_PARENT).flatMap((threads) =>
    threads.map((thread) => thread.id)
  )
);

export function ChannelsV2Sidebar({
  openThread,
  onOpenThread,
}: {
  openThread: string | null;
  onOpenThread: (id: string) => void;
}) {
  // A thread the tree cannot show (none today, but the fixture may grow one)
  // leaves the channel row selected rather than selecting nothing at all.
  const threadSelected = openThread !== null && SIDEBAR_THREAD_IDS.has(openThread);
  const rowProps = { openThread, onOpenThread, threadSelected };

  return (
    <aside
      aria-label="Channels"
      className="flex w-[260px] shrink-0 flex-col border-r border-border-default"
    >
      <div className="flex h-[52px] shrink-0 items-center px-3">
        <span className="flex-1" />
        <IconButton icon={Search} label="Search" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <nav className="flex flex-col gap-px px-2">
          {NAV_ROWS.map(({ id, label, icon: Icon, badge, isNew }) => (
            <Row key={id} label={label}>
              <IconTile>
                <Icon size={14} />
              </IconTile>
              <span className="truncate">{label}</span>
              {isNew && <NewPill />}
              {badge !== undefined && <CountBadge value={badge} />}
            </Row>
          ))}
        </nav>

        <SectionHeader title="Favorites" />
        <div className="flex flex-col gap-px px-2">
          {FAVORITE_ROWS.map((row) => (
            <TreeBranch key={row.id} row={row} {...rowProps} />
          ))}
        </div>

        <SectionHeader title="Direct messages" />
        <div className="flex flex-col gap-px px-2">
          {DM_ROWS.map((row) => (
            <TreeBranch key={row.id} row={row} {...rowProps} />
          ))}
        </div>

        <SectionHeader
          title="Channels"
          actions={<IconButton icon={Plus} label="Add channel" size={13} className="h-5 w-5" />}
        />
        <div className="flex flex-col gap-px px-2">
          {CHANNEL_ROWS.map((row) => (
            <TreeBranch key={row.id} row={row} {...rowProps} />
          ))}
        </div>
      </div>
    </aside>
  );
}

/** The shared row shell: fixed height, glyph gutter, trailing badge slot. */
function Row({
  label,
  active,
  indent = 0,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  indent?: 0 | 1;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-[36px] w-full items-center gap-2 rounded-[8px] pr-2 text-left text-small text-text-secondary transition-colors",
        DEPTH_PAD[indent],
        active
          ? "raised-tab font-medium text-text-primary"
          : "hover:bg-surface-raised-1 hover:text-text-primary"
      )}
    >
      {children}
    </button>
  );
}

/** One tree row plus the active and requested threads nested under it. */
function TreeBranch({
  row,
  openThread,
  onOpenThread,
  threadSelected,
}: {
  row: ChannelRow;
  openThread: string | null;
  onOpenThread: (id: string) => void;
  threadSelected: boolean;
}) {
  const threads = SIDEBAR_THREADS_BY_PARENT[row.id] ?? [];
  return (
    <>
      <ChannelTreeRow row={row} selected={Boolean(row.active) && !threadSelected} />
      {threads.map((thread) => (
        <ThreadTreeRow
          key={thread.id}
          thread={thread}
          selected={thread.id === openThread}
          onOpen={() => onOpenThread(thread.id)}
        />
      ))}
    </>
  );
}

function ChannelTreeRow({ row, selected }: { row: ChannelRow; selected: boolean }) {
  const { label, icon: Icon, emoji, badge, person, depth = 0 } = row;
  return (
    <Row label={label} active={selected} indent={depth}>
      {person ? (
        <Avatar
          person={person}
          size="xs"
          className="h-[26px] w-[26px] text-caption"
        />
      ) : (
        <IconTile>
          {emoji ? (
            <span aria-hidden>{emoji}</span>
          ) : Icon ? (
            <Icon size={14} />
          ) : (
            <Hash size={14} />
          )}
        </IconTile>
      )}
      <span className="truncate">{label}</span>
      {badge !== undefined && <CountBadge value={badge} />}
    </Row>
  );
}

/**
 * A nested thread row. Its two glyphs sit BARE on the sidebar surface — no
 * `IconTile` — because a tile is a button face, and a thread is a child of the
 * row above it, not a peer control: the elbow says "under this", the second
 * glyph says what state it is in. Only threads with a fixture transcript open;
 * the rest are inert, like every other control on this page.
 *
 * SECOND GLYPH IS THE STATUS: `Bot` = active, an agent is party to it and
 * working; `Clock` = requested, addressed and waiting on consent. `Clock` over
 * `CircleDashed` because at 13px a dashed ring's gaps fall under a pixel and it
 * mushes into a fuzzy dot beside the crisp `Bot` — and because it is the SAME
 * glyph the thread card's pending pill and the thread view's status strip use,
 * so one shape means "waiting on approval" across all three columns.
 */
function ThreadTreeRow({
  thread,
  selected,
  onOpen,
}: {
  thread: MockThread;
  selected: boolean;
  onOpen: () => void;
}) {
  const wired = thread.id in THREAD_TRANSCRIPTS;
  const StatusGlyph = thread.status === "requested" ? Clock : Bot;
  return (
    <Row
      label={thread.title}
      active={selected}
      indent={1}
      onClick={wired ? onOpen : undefined}
    >
      <span aria-hidden className="flex shrink-0 items-center gap-1 text-text-muted">
        <CornerDownRight size={13} />
        <StatusGlyph size={13} />
      </span>
      <span className="truncate">{thread.title}</span>
    </Row>
  );
}
