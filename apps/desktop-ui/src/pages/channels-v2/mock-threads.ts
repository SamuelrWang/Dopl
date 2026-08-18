/**
 * Channels v2 — THREAD fixtures, split out of `mock-data.ts` (2026-08-17).
 *
 * They left that file when `parentId` and a fourth active thread pushed it
 * toward the 500-line cap. This is the ONE source for threads: the right
 * panel's cards, the sidebar's nested rows and the center pane's thread view
 * all read `THREADS` — nothing hand-copies a row.
 */

import { PEOPLE, type MockMessage } from "./mock-data";
import type { AvatarPerson } from "@/shared/ui/avatar";

/**
 * `requested` is a MOCK-SIDE status: a thread that has been asked for and is
 * waiting on its addressees' consent. The shipping model has no such task
 * status — there it is an open thread whose `channel_consent_requests` rows are
 * still `pending` (INVARIANTS §6). See MAPPING.md § New agent thread.
 */
export type ThreadStatus = "active" | "requested" | "inactive";

/**
 * One addressed agent on a REQUESTED thread, plus its member's decision.
 *
 * The boolean is a DISPLAY SIMPLIFICATION: consent is a server-side row with a
 * TTL, re-derived at consume time (INVARIANTS §6), not a latch. Only meaningful
 * while `status === "requested"` — an active thread's addressees have all
 * approved and an inactive one's are settled history, so neither carries the
 * field.
 */
export interface ThreadAddressee {
  member: AvatarPerson;
  approved: boolean;
}

export interface MockThread {
  id: string;
  title: string;
  /**
   * The SIDEBAR ROW this thread hangs under — a `CHANNEL_ROWS` / `DM_ROWS` /
   * `FAVORITE_ROWS` id. ACTIVE and REQUESTED threads are rendered there
   * (MAPPING.md § Sidebar); at port time this is the thread's `channel_id`, and
   * a channel that appears twice in the tree (favorite + list) would nest under
   * both.
   */
  parentId: string;
  /**
   * The people party to the thread; rendered as overlapping avatars. Two for an
   * active or inactive thread — one requester + one target (INVARIANTS §5). A
   * REQUESTED thread lists the requester plus EVERY addressee, because the
   * fan-out into one thread per addressee has not happened yet.
   */
  participants: AvatarPerson[];
  /** An agent of one of the participants is party to it → "Agent" chip. */
  hasAgent?: boolean;
  /** Relative last-activity, pre-formatted (no clock on this page). */
  lastActivity: string;
  status: ThreadStatus;
  /** REQUESTED threads only — the addressed agents and their consent state. */
  addressees?: ThreadAddressee[];
}

export const THREADS: MockThread[] = [
  {
    id: "uikit",
    title: "UI-kit design",
    parentId: "website",
    participants: [PEOPLE.diana, PEOPLE.me],
    hasAgent: true,
    lastActivity: "3h ago",
    status: "active",
  },
  {
    // Just sent from the composer's "New agent thread" panel: the tagline
    // became this title, the pills became `addressees`, and each addressee's
    // member has to approve their agent working it before it starts.
    id: "qa-sweep",
    title: "Design QA sweep",
    parentId: "website",
    participants: [PEOPLE.me, PEOPLE.diana, PEOPLE.daniel, PEOPLE.emily],
    hasAgent: true,
    lastActivity: "12m ago",
    status: "requested",
    addressees: [
      { member: PEOPLE.diana, approved: true },
      { member: PEOPLE.daniel, approved: false },
      { member: PEOPLE.emily, approved: false },
    ],
  },
  {
    id: "lottie",
    title: "Lottie animation handoff",
    parentId: "website",
    participants: [PEOPLE.diana, PEOPLE.emily],
    lastActivity: "5h ago",
    status: "active",
  },
  {
    // Hangs off the Diana DM, so Diana is necessarily one of the two parties —
    // a DM thread whose participants did not include that DM's person would be
    // an incoherent fixture, not a design question.
    id: "tokens",
    title: "Color token audit",
    parentId: "dm-diana",
    participants: [PEOPLE.diana, PEOPLE.me],
    hasAgent: true,
    lastActivity: "yesterday",
    status: "active",
  },
  {
    id: "navbar-audit",
    title: "Navbar responsive audit",
    parentId: "fav-frontend",
    participants: [PEOPLE.emily, PEOPLE.me],
    hasAgent: true,
    lastActivity: "2h ago",
    status: "active",
  },
  {
    id: "navbar",
    title: "Navbar responsive bug",
    parentId: "frontend",
    participants: [PEOPLE.emily, PEOPLE.daniel],
    lastActivity: "4d ago",
    status: "inactive",
  },
  {
    id: "retro",
    title: "Q2 design retro",
    parentId: "website",
    participants: [PEOPLE.andrew, PEOPLE.sophia],
    lastActivity: "2w ago",
    status: "inactive",
  },
];

/**
 * The two messages MY OWN agents posted into these threads.
 *
 * Exported because each one appears TWICE: in the thread transcript below, and
 * again in that agent's activity feed (`mock-agents.ts`) as a "sent" entry. The
 * agent view's whole claim is that it shows the same traffic the thread saw, so
 * two copies of the string would be a fixture that can disagree with itself.
 */
export const UIKIT_KIT_PAGE_NOTE =
  "Put the drafted states on the kit review page so they can be read side by side. I renamed btn/secondary to btn/light so the names match the code — flagging it so the library stays in sync.";

export const QA_SWEEP_PROGRESS_NOTE =
  "Started on the front-end side while Diana's agent walks the design file. 9 of 21 screens read — 4 spacing values off the 4px rhythm and one grey that is not a token. Per-screen list to follow.";

/**
 * Thread transcripts, keyed by thread id. Only the threads present here can be
 * opened — the rest are inert rows and cards, exactly like every other control
 * on this page. Two are worked: a settled ACTIVE thread and a just-REQUESTED
 * one, which is the pair the center pane has to render differently.
 */
export const THREAD_TRANSCRIPTS: Record<string, MockMessage[]> = {
  // A thread minutes old: my request, and the ONE addressee who has approved.
  // Daniel's and Emily's agents are still pending, so they have said nothing —
  // an unapproved agent has not spawned, and silence is what that looks like.
  "qa-sweep": [
    {
      id: "q1",
      author: PEOPLE.me,
      authorLabel: "You",
      time: "12m ago",
      side: "me",
      paragraphs: [
        [
          {
            text:
              "Sweep the v3 screens for spacing and token drift before the freeze. Flag anything off the 4px rhythm or using a value that is not in the kit, and list it per screen — no fixes yet, I want the size of the problem first.",
          },
        ],
      ],
    },
    {
      id: "q2",
      author: PEOPLE.diana,
      authorLabel: "Diana T.",
      time: "9m ago",
      side: "peer",
      agent: true,
      paragraphs: [
        [
          {
            text:
              "Approved and started on the design side. Walking the v3.0 file screen by screen — 6 of 21 read so far, 3 spacing values off the rhythm and 2 one-off greys that are not tokens. I'll post the per-screen list when the pass finishes.",
          },
        ],
        [
          { text: "@Samuel W.", mention: true, self: true },
          {
            text:
              " I'll need your call on the two legacy greys before the list lands — replace them or tokenize them as-is?",
          },
        ],
      ],
    },
    {
      // MY agent, working the sweep from my side. It is not an addressee — the
      // pills address other members' agents, and consent gates them, not the
      // requester's own. Same string as its "sent" entry in `mock-agents.ts`.
      id: "q3",
      author: PEOPLE.me,
      authorLabel: "You",
      time: "6m ago",
      side: "me",
      agent: true,
      paragraphs: [[{ text: QA_SWEEP_PROGRESS_NOTE }]],
    },
  ],
  uikit: [
    {
      id: "t1",
      author: PEOPLE.diana,
      authorLabel: "Diana T.",
      time: "5h ago",
      side: "peer",
      agent: true,
      paragraphs: [
        [
          {
            text:
              "Pulled the interactive elements out of the v3.0 file. Hover, focus, pressed and disabled are drafted for buttons, inputs and the segmented control — 14 components in all. Two are still missing a disabled face: the date field and the file drop zone.",
          },
        ],
      ],
    },
    {
      id: "t2",
      author: PEOPLE.me,
      authorLabel: "You",
      time: "4h ago",
      side: "me",
      agent: true,
      paragraphs: [
        [{ text: UIKIT_KIT_PAGE_NOTE }],
        [
          { text: "Blocked on the two disabled faces before the kit can be frozen. " },
          { text: "@Diana T.", mention: true },
        ],
      ],
    },
    {
      id: "t3",
      author: PEOPLE.diana,
      authorLabel: "Diana T.",
      time: "3h ago",
      side: "peer",
      paragraphs: [
        [
          {
            text:
              "Good catch on the rename — I'll mirror it in the library today. The disabled faces are drawn, just not published; they go up after standup.",
          },
        ],
      ],
      reactions: [{ emoji: "🙌", count: 1 }],
    },
    {
      id: "t4",
      author: PEOPLE.me,
      authorLabel: "You",
      time: "3h ago",
      side: "me",
      paragraphs: [
        [{ text: "Perfect. Once those land I'll freeze v1 of the kit and tag it." }],
      ],
    },
    {
      id: "t5",
      author: PEOPLE.diana,
      authorLabel: "Diana T.",
      time: "1h ago",
      side: "peer",
      agent: true,
      paragraphs: [
        [
          {
            text:
              "Disabled faces are published — date field and drop zone are both in the v3.0 file. Nothing else on that page changed.",
          },
        ],
        [
          { text: "@Samuel W.", mention: true, self: true },
          { text: " both faces are in — ready for your freeze." },
        ],
      ],
    },
  ],
};

/**
 * The threads the SIDEBAR shows, grouped by the row they nest under: ACTIVE and
 * REQUESTED, never inactive. Both are places you can walk into — a requested
 * thread is live work in formation, a closed one has nothing left to open. The
 * sidebar DERIVES its nested rows from this, so it and the right panel read one
 * fixture and cannot disagree.
 */
export const SIDEBAR_THREADS_BY_PARENT: Record<string, MockThread[]> =
  THREADS.reduce<Record<string, MockThread[]>>((acc, thread) => {
    if (thread.status === "inactive") return acc;
    (acc[thread.parentId] ??= []).push(thread);
    return acc;
  }, {});
