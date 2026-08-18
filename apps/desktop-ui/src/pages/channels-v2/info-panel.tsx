/**
 * Channels v2 — RIGHT COLUMN: the channel's tabs — Info (metadata, linked
 * threads, activity heatmap, roster), Threads (the thread cards that drive the
 * center pane) and Agents (`agents-tab.tsx`, my own running agents, each with a
 * way into the agent view). Links is a deliberate empty state.
 *
 * Local state: the active tab, the Active/Inactive thread filter, and the
 * Tags disclosure's open flag — each local because nothing else reads it. The
 * center pane's open thread, the open AGENT and the mentions READ-STATE are
 * NOT state here — all lifted to `index.tsx`, since this column sets them and
 * other surfaces read them (the Tags badge derives from the read-state the
 * clicks write).
 */

import { useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Hash,
  ListChecks,
  ListFilter,
  Tag,
  UserPlus,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { AvatarWithPresence } from "@/shared/ui/avatar-with-presence";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { cn } from "@/shared/lib/utils";
import {
  AgentChip,
  CountBadge,
  IconButton,
  PANEL_CARD,
  PanelHeading,
  PendingChip,
  RolePill,
  StatusPill,
} from "./bits";
import { AgentsTab } from "./agents-tab";
import { MentionsList } from "./mentions-list";
import {
  LINKED_THREADS,
  MEMBERS,
  MEMBER_COUNT,
  OFFLINE_MEMBERS,
  PEOPLE,
  THREAD_ACTIVITY,
  type MockMember,
} from "./mock-data";
import { MENTIONS, type MockMention } from "./mock-mentions";
import { THREADS, THREAD_TRANSCRIPTS, type MockThread } from "./mock-threads";

/** Files left this row on 2026-08-18 — where a channel's files land is still an
 *  open question, and an empty tab was answering it with "here". */
const TABS = [
  { key: "info", label: "Info" },
  { key: "threads", label: "Threads" },
  { key: "agents", label: "Agents" },
  { key: "links", label: "Links" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Heatmap shades, low → high. Opacity steps on the success token: the palette
 *  carries one green, so density is expressed as strength, not as hue. */
const ACTIVITY_SHADE = [
  "bg-success/10",
  "bg-success/25",
  "bg-success/45",
  "bg-success/70",
  "bg-success",
] as const;

export function ChannelsV2InfoPanel({
  openThread,
  onOpenThread,
  openAgent,
  onOpenAgent,
  readMentions,
  onOpenMention,
  onMarkAllMentionsRead,
}: {
  openThread: string | null;
  onOpenThread: (id: string) => void;
  /** The agent whose view is open — read only to mark its card "Viewing". The
   *  panel itself renders at page level, over this column. */
  openAgent: string | null;
  onOpenAgent: (id: string) => void;
  /** The Tags inbox's read-state — lifted, the badge derives from it. */
  readMentions: ReadonlySet<string>;
  onOpenMention: (mention: MockMention) => void;
  onMarkAllMentionsRead: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("info");

  return (
    <aside
      aria-label="Channel info"
      className="flex w-[340px] shrink-0 flex-col border-l border-border-default"
    >
      <div className="flex h-[56px] shrink-0 items-center border-b border-border-default px-3">
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={(next) => setTab(next)}
        />
      </div>

      {tab === "info" ? (
        <InfoTab
          readMentions={readMentions}
          onOpenMention={onOpenMention}
          onMarkAllMentionsRead={onMarkAllMentionsRead}
        />
      ) : tab === "threads" ? (
        <ThreadsTab openThread={openThread} onOpenThread={onOpenThread} />
      ) : tab === "agents" ? (
        <AgentsTab openAgent={openAgent} onOpenAgent={onOpenAgent} />
      ) : (
        <p className="px-4 py-8 text-center text-caption text-text-muted">
          No {TABS.find((t) => t.key === tab)?.label.toLowerCase()} in this channel yet.
        </p>
      )}
    </aside>
  );
}

/* ── Threads tab ─────────────────────────────────────────────────── */

const STATUS_FILTERS = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
] as const;

/**
 * The filter is TWO segments over THREE statuses, deliberately. A REQUESTED
 * thread files under Active: it is live work in formation — addressed, titled,
 * one agent already posting — and the Inactive segment means CLOSED, a thread
 * with nothing left to walk into. A third segment would split the live column
 * to no end, since the card already says "Requested" on its face.
 */
type ThreadFilter = (typeof STATUS_FILTERS)[number]["key"];

const IN_FILTER: Record<ThreadFilter, (t: MockThread) => boolean> = {
  active: (t) => t.status !== "inactive",
  inactive: (t) => t.status === "inactive",
};

/** "Diana Taylor" → "Diana T."; the viewer is always "you". */
function shortName(person: AvatarPerson): string {
  if (person.userId === PEOPLE.me.userId) return "you";
  const [first, last] = (person.displayName ?? "").split(" ");
  return last ? `${first} ${last.charAt(0)}.` : (first ?? "Member");
}

function ThreadsTab({
  openThread,
  onOpenThread,
}: {
  openThread: string | null;
  onOpenThread: (id: string) => void;
}) {
  const [status, setStatus] = useState<ThreadFilter>("active");
  const counts = {
    active: THREADS.filter(IN_FILTER.active).length,
    inactive: THREADS.filter(IN_FILTER.inactive).length,
  };
  const shown = THREADS.filter(IN_FILTER[status]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6">
      <div className="pb-3 pt-4">
        <SegmentedControl
          options={STATUS_FILTERS.map((f) => ({ ...f, count: counts[f.key] }))}
          value={status}
          onChange={setStatus}
        />
      </div>
      <div className="flex flex-col gap-2">
        {shown.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            viewing={thread.id === openThread}
            onOpen={() => onOpenThread(thread.id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One thread rectangle. Inactive threads are muted and their Open is inert —
 * a closed thread has nothing to walk into. Active threads without a fixture
 * transcript keep an enabled Open that does nothing, exactly like every other
 * control on this mock.
 *
 * A REQUESTED thread wears a caution-toned "Requested" chip, NOT the Info tab's
 * green `StatusPill`: green is a settled state and this one is waiting on its
 * addressees. The subline keeps the same verb-plus-time shape every card has and
 * appends the approval count, so the chip is the glanceable state and the line
 * is the detail.
 */
function ThreadCard({
  thread,
  viewing,
  onOpen,
}: {
  thread: MockThread;
  viewing: boolean;
  onOpen: () => void;
}) {
  const { id, title, participants, hasAgent, lastActivity, status } = thread;
  const inactive = status === "inactive";
  const requested = status === "requested";
  const wired = id in THREAD_TRANSCRIPTS && !inactive;
  const addressees = thread.addressees ?? [];
  const approved = addressees.filter((a) => a.approved).length;

  return (
    <div
      className={cn(
        PANEL_CARD,
        viewing && "border-border-highlight",
        inactive && "opacity-60"
      )}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
          {title}
        </span>
        {requested && <PendingChip label="Requested" />}
        <button
          type="button"
          disabled={inactive}
          aria-current={viewing ? "true" : undefined}
          onClick={wired ? onOpen : undefined}
          className="btn-light shrink-0 rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary"
        >
          {viewing ? "Viewing" : "Open"}
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <span className="flex shrink-0 -space-x-1.5">
          {participants.map((p) => (
            <Avatar
              key={p.userId}
              person={p}
              size="xs"
              className="h-[22px] w-[22px] text-micro"
            />
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-caption text-text-secondary">
          {participants.map(shortName).join(" · ")}
        </span>
        {hasAgent && <AgentChip />}
      </div>

      <span className="text-caption text-text-muted">
        {inactive ? "Closed" : requested ? "Requested" : "Updated"} {lastActivity}
        {requested && ` · ${approved} of ${addressees.length} agents approved`}
      </span>
    </div>
  );
}

/* ── Info tab ────────────────────────────────────────────────────── */

function InfoTab({
  readMentions,
  onOpenMention,
  onMarkAllMentionsRead,
}: {
  readMentions: ReadonlySet<string>;
  onOpenMention: (mention: MockMention) => void;
  onMarkAllMentionsRead: () => void;
}) {
  // The Tags disclosure is the ONE expandable row in Main info; its open state
  // is nobody else's business, so it stays here.
  const [tagsOpen, setTagsOpen] = useState(false);
  const unreadCount = MENTIONS.filter((m) => !readMentions.has(m.id)).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <PanelHeading title="Main info" />
      <div className="px-2">
        <MetaRow icon={UserRound} label="Creator">
          <Avatar
            person={PEOPLE.andrew}
            size="xs"
            className="h-[20px] w-[20px] text-micro"
          />
          <span className="text-body text-text-primary">Andrew M.</span>
        </MetaRow>
        <MetaRow icon={Calendar} label="Date of creation">
          <span className="text-body text-text-primary">28 May</span>
        </MetaRow>
        <MetaRow icon={CircleDot} label="Status">
          <StatusPill label="Active" />
        </MetaRow>
        {/* The mentions inbox — label kept "Tags" from the reference design.
            The count is LIVE UNREAD, not a total; the chevron flips open. */}
        <button
          type="button"
          onClick={() => setTagsOpen((open) => !open)}
          aria-expanded={tagsOpen}
          className="flex h-10 w-full items-center gap-2 rounded-[8px] px-2 text-left transition-colors hover:bg-surface-raised-1"
        >
          <Tag size={14} className="shrink-0 text-text-muted" />
          <span className="text-small text-text-secondary">Tags</span>
          <span className="flex-1" />
          <span
            className={cn(
              "text-body",
              unreadCount > 0
                ? "font-semibold text-link"
                : "text-text-primary"
            )}
          >
            {unreadCount}
          </span>
          {tagsOpen ? (
            <ChevronDown size={13} className="shrink-0 text-text-disabled" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-text-disabled" />
          )}
        </button>
        {tagsOpen && (
          <MentionsList
            readMentions={readMentions}
            onOpenMention={onOpenMention}
            onMarkAllRead={onMarkAllMentionsRead}
          />
        )}
        <MetaRow icon={ListChecks} label="Tasks" chevron>
          <span className="text-body text-text-primary">4</span>
        </MetaRow>
      </div>

      <PanelHeading title="Linked threads" />
      <div className="flex flex-col gap-px px-2">
        {LINKED_THREADS.map(({ label, badge }) => (
          <button
            key={label}
            type="button"
            className="flex h-[34px] w-full items-center gap-2 rounded-[8px] px-2 text-left text-small text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
          >
            <Hash size={14} className="shrink-0 text-text-muted" />
            <span className="truncate">{label}</span>
            {badge !== undefined && <CountBadge value={badge} />}
          </button>
        ))}
      </div>

      <PanelHeading title="Thread activity" />
      <div
        role="img"
        aria-label="Thread activity over the last 24 slices"
        className="flex flex-wrap gap-1 px-3.5 pt-1"
      >
        {THREAD_ACTIVITY.map((level, i) => (
          <span
            key={i}
            className={cn("h-3.5 w-3.5 rounded-[4px]", ACTIVITY_SHADE[level])}
          />
        ))}
      </div>

      <PanelHeading
        title="Members"
        trailing={
          <>
            <span className="text-caption text-text-muted">{MEMBER_COUNT}</span>
            <span className="flex-1" />
            <IconButton icon={UserPlus} label="Add member" size={14} className="h-6 w-6" />
            <IconButton icon={ListFilter} label="Filter members" size={14} className="h-6 w-6" />
          </>
        }
      />
      <div className="flex flex-col gap-px px-2">
        {MEMBERS.map((member) => (
          <MemberRow key={member.person.userId} member={member} />
        ))}
        <p className="px-2 pb-1 pt-3 text-label font-semibold uppercase tracking-wide text-text-muted">
          Offline
        </p>
        {OFFLINE_MEMBERS.map((member) => (
          <MemberRow key={member.person.userId} member={member} />
        ))}
      </div>
    </div>
  );
}

function MetaRow({
  icon: Icon,
  label,
  chevron,
  children,
}: {
  icon: LucideIcon;
  label: string;
  chevron?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-10 items-center gap-2 rounded-[8px] px-2">
      <Icon size={14} className="shrink-0 text-text-muted" />
      <span className="text-small text-text-secondary">{label}</span>
      <span className="flex-1" />
      <span className="flex items-center gap-1.5">{children}</span>
      {chevron && <ChevronRight size={13} className="shrink-0 text-text-disabled" />}
    </div>
  );
}

function MemberRow({ member }: { member: MockMember }) {
  const { person, name, role, tone, toneLabel, online } = member;
  return (
    <div
      className={cn(
        "flex h-[46px] items-center gap-2.5 rounded-[8px] px-2",
        !online && "opacity-60"
      )}
    >
      <AvatarWithPresence person={person} online={online} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-text-primary">
          {name}
        </span>
        <span className="truncate text-caption text-text-muted">{role}</span>
      </span>
      <RolePill tone={tone} label={toneLabel} />
    </div>
  );
}
