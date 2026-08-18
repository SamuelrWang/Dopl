/**
 * Channels v2 — STATIC FIXTURE DATA for the design-review page.
 *
 * Nothing here is fetched, cached or written. This page exists so the new
 * three-column channels layout can be reviewed live without waiting on the
 * data layer; the shipping page is `#/pages/channels`, which is untouched.
 * If this design is adopted, none of this file survives the port.
 */

import {
  Bookmark,
  FileText,
  FolderTree,
  Hash,
  Inbox,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { AvatarPerson } from "@/shared/ui/avatar";

function person(id: string, displayName: string): AvatarPerson {
  return { userId: id, email: null, displayName, avatarUrl: null };
}

export const PEOPLE = {
  andrew: person("u-andrew", "Andrew Miller"),
  diana: person("u-diana", "Diana Taylor"),
  daniel: person("u-daniel", "Daniel Anderson"),
  emily: person("u-emily", "Emily Davis"),
  william: person("u-william", "William Johnson"),
  sophia: person("u-sophia", "Sophia Wilson"),
  /** The viewer. Messages authored by this person render right-aligned. */
  me: person("u-me", "Samuel Wang"),
} as const;

/* ── Sidebar ─────────────────────────────────────────────────────── */

export interface NavRow {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  isNew?: boolean;
}

export const NAV_ROWS: NavRow[] = [
  { id: "assistant", label: "Assistant", icon: Sparkles, isNew: true },
  { id: "drafts", label: "Drafts", icon: FileText },
  { id: "saved", label: "Saved items", icon: Bookmark },
  { id: "inbox", label: "Inbox", icon: Inbox, badge: 8 },
];

/** One row of the channel tree. `depth` is the indent step. ACTIVE threads are
 *  nested under these rows by id — see `mock-threads.ts › parentId`. */
export interface ChannelRow {
  id: string;
  label: string;
  icon?: LucideIcon;
  emoji?: string;
  depth?: 0 | 1;
  badge?: number;
  active?: boolean;
  person?: AvatarPerson;
}

export const FAVORITE_ROWS: ChannelRow[] = [
  { id: "fav-sophia", label: "Sophia Wilson", person: PEOPLE.sophia, badge: 2 },
  { id: "fav-frontend", label: "Front-end", icon: Hash, badge: 4 },
];

/** Own section between Favorites and Channels — people, not nav. */
export const DM_ROWS: ChannelRow[] = [
  { id: "dm-sophia", label: "Sophia Wilson", person: PEOPLE.sophia, badge: 2 },
  { id: "dm-diana", label: "Diana Taylor", person: PEOPLE.diana },
  { id: "dm-daniel", label: "Daniel Anderson", person: PEOPLE.daniel },
];

export const CHANNEL_ROWS: ChannelRow[] = [
  { id: "general", label: "General", emoji: "📣", badge: 1 },
  { id: "frontend", label: "Front-end", icon: Hash, badge: 4 },
  { id: "website", label: "Website", icon: FolderTree, active: true },
  { id: "v3", label: "v3.0", emoji: "🚀", depth: 1 },
  { id: "v2", label: "v2.0 - actual version", icon: Hash },
  { id: "strategy", label: "Strategy", icon: Hash },
  { id: "events", label: "Events", emoji: "🗓️" },
  { id: "announcements", label: "Announcements", icon: Hash },
  { id: "uiux", label: "UI/UX", icon: Hash, badge: 2 },
];

export const CHANNEL_TITLE = "Website";

/* ── Transcript ──────────────────────────────────────────────────── */

/** A run of message body text. `mention` renders it as an accent chip;
 *  `self` marks a mention OF THE VIEWER, which additionally gets a soft tint —
 *  the rows the Tags inbox (mock-mentions.ts) points at. */
export interface BodySpan {
  text: string;
  mention?: boolean;
  self?: boolean;
}

export interface Reaction {
  emoji: string;
  count: number;
}

/**
 * Which side of the transcript a message hangs on. `me` is the viewer and
 * anything the viewer's agent posts; `peer` is every other member and their
 * agents (MAPPING.md § Message alignment) — an agent NEVER gets a third column.
 */
export type MessageSide = "peer" | "me";

export interface MockMessage {
  id: string;
  /** Identity the message is attributed to — an agent posts under its operator. */
  author: AvatarPerson;
  /** Short display form used in the transcript ("Diana T."). */
  authorLabel: string;
  time: string;
  side: MessageSide;
  /** Display claim only: renders the "Agent" chip beside the author name. */
  agent?: boolean;
  /** Each entry is one paragraph, split into plain/mention spans. */
  paragraphs: BodySpan[][];
  attachment?: { title: string; host: string };
  /**
   * The POSTED artifact of a "New agent thread" send: the card the request
   * lands in the channel transcript as. It carries only the thread id and a
   * body preview — title, addressees and their approval state are read live off
   * `mock-threads.ts › THREADS`, so the card and the thread cannot disagree.
   */
  threadCard?: { threadId: string; preview: string };
  reactions?: Reaction[];
  /** First message is mid-scroll in the reference — no avatar gutter header. */
  continuation?: boolean;
}

export const CHANNEL_MESSAGES: MockMessage[] = [
  {
    id: "m1",
    author: PEOPLE.andrew,
    authorLabel: "Andrew M.",
    time: "2d ago",
    side: "peer",
    continuation: true,
    paragraphs: [
      [
        {
          text:
            "Hey team, I wanted to discuss the custom UI-kit we're developing for the site redesign. We need to finalize some components and make key design decisions to ensure consistency across the board. Let's make sure we cover colors, typography, buttons, and any other essential UI elements.",
        },
      ],
      [
        { text: "@UX/UI", mention: true },
        { text: " " },
        { text: "@Sophia", mention: true },
      ],
    ],
    reactions: [{ emoji: "👌", count: 2 }],
  },
  {
    id: "m2",
    author: PEOPLE.diana,
    authorLabel: "Diana T.",
    time: "2d ago",
    side: "peer",
    paragraphs: [
      [
        {
          text:
            "I have already prepared all styles and components according to our standards during the design phase, so the UI kit is 90% complete. All that remains is to add some states to the interactive elements and prepare the Lottie files for animations.",
        },
      ],
      [
        { text: "@Emily D.", mention: true },
        { text: ", please take a look and let me know if you have any questions." },
      ],
    ],
    attachment: { title: "Dopl website v3.0", host: "www.figma.com" },
    reactions: [{ emoji: "❤️", count: 1 }],
  },
  {
    id: "m3",
    author: PEOPLE.daniel,
    authorLabel: "Daniel A.",
    time: "3h ago",
    side: "peer",
    paragraphs: [
      [
        { text: "Okay, keep me updated. " },
        { text: "@Diana T.", mention: true },
        { text: " I also wanted to remind you to keep the layers organized. " },
        { text: "@Samuel W.", mention: true, self: true },
        { text: " can you confirm the button specs are final before Thursday?" },
      ],
    ],
  },
  {
    id: "m4",
    author: PEOPLE.me,
    authorLabel: "You",
    time: "3h ago",
    side: "me",
    paragraphs: [[{ text: "On it — I'll push the states today 💪" }]],
    reactions: [{ emoji: "👍", count: 2 }],
  },
  {
    id: "m5",
    author: PEOPLE.me,
    authorLabel: "You",
    time: "1h ago",
    side: "me",
    agent: true,
    paragraphs: [
      [
        {
          text:
            "Moved the state work into its own thread — \"UI-kit design\" — so the detail stays out of the channel. Diana is on it there too.",
        },
      ],
    ],
  },
  {
    // Sent from the composer's "New agent thread" panel minutes ago. The body
    // is the CARD; the message carries no paragraphs of its own, because the
    // request body is the card's preview line.
    id: "m6",
    author: PEOPLE.me,
    authorLabel: "You",
    time: "12m ago",
    side: "me",
    paragraphs: [],
    threadCard: {
      threadId: "qa-sweep",
      preview:
        "Sweep the v3 screens for spacing and token drift before the freeze.",
    },
  },
  {
    id: "m7",
    author: PEOPLE.diana,
    authorLabel: "Diana T.",
    time: "8m ago",
    side: "peer",
    paragraphs: [
      [
        { text: "@Samuel W.", mention: true, self: true },
        {
          text:
            " the updated kit review page is ready for your pass — flagging it before the freeze so nothing lands after.",
        },
      ],
    ],
  },
];

/* ── Threads ─────────────────────────────────────────────────────── */

// Thread fixtures live in `mock-threads.ts` — they outgrew this file when
// `parentId` and the sidebar's nested rows landed (2026-08-17).

/** Rows of the @-mention autocomplete floating over the composer. */
export const MENTION_SUGGESTIONS: Array<{
  person: AvatarPerson;
  name: string;
  selected?: boolean;
}> = [
  { person: PEOPLE.diana, name: "Diana Taylor", selected: true },
  { person: PEOPLE.daniel, name: "Daniel Anderson" },
];

/* ── Info panel ──────────────────────────────────────────────────── */

export const LINKED_THREADS: Array<{ label: string; badge?: number }> = [
  { label: "Front-end", badge: 4 },
  { label: "UI-kit design standards" },
];

/**
 * Thread-activity heatmap, one entry per recent slice, `0`–`4` = how busy.
 * Hand-authored so the strip reads like real traffic (a quiet start, a spike
 * around the design handoff, a tail) rather than noise.
 */
export const THREAD_ACTIVITY: number[] = [
  1, 0, 2, 1, 3, 2, 1, 0, 2, 3, 4, 4, 3, 2, 4, 3, 1, 2, 0, 1, 3, 4, 2, 1,
];

export type RoleTone = "design" | "management" | "development";

export interface MockMember {
  person: AvatarPerson;
  name: string;
  role: string;
  tone: RoleTone;
  toneLabel: string;
  online: boolean;
}

export const MEMBERS: MockMember[] = [
  {
    person: PEOPLE.diana,
    name: "Diana Taylor",
    role: "Product designer",
    tone: "design",
    toneLabel: "Design",
    online: true,
  },
  {
    person: PEOPLE.daniel,
    name: "Daniel Anderson",
    role: "Art director",
    tone: "design",
    toneLabel: "Design",
    online: true,
  },
  {
    person: PEOPLE.andrew,
    name: "Andrew Miller",
    role: "Product owner",
    tone: "management",
    toneLabel: "Management",
    online: true,
  },
  {
    person: PEOPLE.william,
    name: "William Johnson",
    role: "UX/UI designer",
    tone: "design",
    toneLabel: "Design",
    online: true,
  },
  {
    person: PEOPLE.emily,
    name: "Emily Davis",
    role: "Front-end dev",
    tone: "development",
    toneLabel: "Development",
    online: true,
  },
];

export const OFFLINE_MEMBERS: MockMember[] = [
  {
    person: PEOPLE.sophia,
    name: "Sophia Wilson",
    role: "Content strategist",
    tone: "management",
    toneLabel: "Management",
    online: false,
  },
];

export const MEMBER_COUNT = 9;

/** "Diana Taylor" → "Diana's agent". THE label form for an addressed agent —
 *  the composer's pills and a posted thread card's pills both read it. */
export function agentLabel(person: AvatarPerson): string {
  return `${(person.displayName ?? "Member").split(" ")[0]}'s agent`;
}

/**
 * The agents a request can be addressed to: one per OTHER online member,
 * DERIVED from `MEMBERS` so the composer's pills and the roster can never
 * disagree. The viewer is not in the list — you do not address your own agent.
 */
export const AGENT_TARGETS: Array<{ id: string; label: string }> = MEMBERS.map(
  (member) => ({
    id: member.person.userId,
    label: agentLabel(member.person),
  })
);
