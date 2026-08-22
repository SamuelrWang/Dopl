/**
 * HARDCODED home-surface fixtures (Samuel, 2026-08-21) — design data for the
 * account surface while the personal-channels backend does not exist yet.
 * Shapes are deliberately UI-shaped, not API-shaped: when account-owned
 * channels land server-side, the real view-model replaces this file wholesale.
 */

export type ExchangeItem =
  | {
      kind: "agent";
      /** Whose agent spoke. */
      side: "yours" | "theirs";
      text: string;
      /** What the answer was grounded in — the attribution chip. */
      source?: string;
      time: string;
    }
  | { kind: "human"; side: "you" | "them"; text: string; time: string }
  | { kind: "approval"; text: string; detail: string; time: string }
  | { kind: "event"; text: string; time: string };

export interface PendingLink {
  url: string;
  expires: string;
  uses: string;
}

export interface AgentPair {
  yours: { status: "Idle" | "Responding"; lastRun: string };
  theirs: { present: boolean; lastSeen: string };
}

export interface HomeChannel {
  id: string;
  name: string;
  email: string;
  /** Org · role — where this relationship lives. */
  context: string;
  status: "active" | "needs-you" | "pending";
  lastLine: string;
  lastTime: string;
  /** What this channel's agent may draw from. */
  policy: string;
  /** Your notes on the person — what your agent leans on here. */
  about: string;
  connected: string;
  agents: AgentPair;
  link?: PendingLink;
  feed: ExchangeItem[];
}

/** The signed-in side of every exchange — avatar + "Your agent" attribution. */
export const ME = { name: "Samuel Wang", email: "samuelnywang717@gmail.com" };

export const HOME_CHANNELS: HomeChannel[] = [
  {
    id: "priya",
    name: "Priya Shah",
    email: "priya@shahco.tax",
    context: "Shah & Co · Accountant",
    status: "needs-you",
    lastLine: "Approval — share vendor contracts folder?",
    lastTime: "2:41 PM",
    policy: "Finance only",
    about:
      "Handles both personal and Dopl LLC returns. Prefers itemized exports over summaries. Q3 estimated payment due Sep 15.",
    connected: "Jul 12",
    agents: {
      yours: { status: "Idle", lastRun: "Ran 2:19 PM" },
      theirs: { present: true, lastSeen: "Active now" },
    },
    feed: [
      { kind: "event", text: "Link claimed by Priya Shah", time: "Jul 12" },
      {
        kind: "agent",
        side: "theirs",
        text: "Requesting itemized Q2 SaaS spend for the 1120 filing.",
        time: "1:58 PM",
      },
      {
        kind: "agent",
        side: "yours",
        text: "Shared 14 transactions from the Ramp export — $8,420 total, categorized by vendor.",
        source: "Finance KB",
        time: "2:03 PM",
      },
      {
        kind: "human",
        side: "them",
        text: "Can you also flag any renewals over $1k landing before October?",
        time: "2:17 PM",
      },
      {
        kind: "agent",
        side: "yours",
        text: "Three renewals over $1k before October: Figma (Sep 4), Vercel (Sep 18), Linear (Oct 1).",
        source: "Finance KB",
        time: "2:19 PM",
      },
      {
        kind: "approval",
        text: "Share vendor contracts folder?",
        detail: "Priya's agent asked for the underlying contracts — outside the Finance-only grant.",
        time: "2:41 PM",
      },
    ],
  },
  {
    id: "marcus",
    name: "Marcus Lee",
    email: "marcus@northwind.dev",
    context: "Northwind · Client",
    status: "active",
    lastLine: "Milestone 2 lands Friday — staging link attached.",
    lastTime: "11:26 AM",
    policy: "Project Atlas",
    about:
      "Sponsor on Project Atlas. Wants status without meetings — weekly summary Fridays. Invoices net-30 via Northwind AP.",
    connected: "Jun 3",
    agents: {
      yours: { status: "Idle", lastRun: "Ran 11:26 AM" },
      theirs: { present: false, lastSeen: "Last seen 11:30 AM" },
    },
    feed: [
      { kind: "event", text: "Link claimed by Marcus Lee", time: "Jun 3" },
      {
        kind: "agent",
        side: "theirs",
        text: "Status check on Milestone 2 — anything blocking the Friday target?",
        time: "11:24 AM",
      },
      {
        kind: "agent",
        side: "yours",
        text: "On track. 14 of 16 tasks closed; staging deploy is live at atlas-stg.northwind.dev.",
        source: "Atlas repo",
        time: "11:26 AM",
      },
    ],
  },
  {
    id: "alex",
    name: "Alex Kim",
    email: "alex@meridian.vc",
    context: "Meridian · Partnerships",
    status: "active",
    lastLine: "Intro call confirmed — Tue Aug 26, 10:00 AM.",
    lastTime: "Yesterday",
    policy: "Calendar only",
    about:
      "Partnerships lead at Meridian. Exploring a distribution deal — keep scope to scheduling until the NDA is signed.",
    connected: "Aug 14",
    agents: {
      yours: { status: "Idle", lastRun: "Ran yesterday" },
      theirs: { present: false, lastSeen: "Last seen yesterday" },
    },
    feed: [
      { kind: "event", text: "Link claimed by Alex Kim", time: "Aug 14" },
      {
        kind: "agent",
        side: "theirs",
        text: "Alex is free Tue or Wed morning next week for the intro call.",
        time: "Yesterday",
      },
      {
        kind: "agent",
        side: "yours",
        text: "Booked Tue Aug 26, 10:00–10:30 AM PT. Invite sent to both calendars.",
        source: "Calendar",
        time: "Yesterday",
      },
    ],
  },
  {
    id: "dana",
    name: "Dana Ortiz",
    email: "dana@brightsupply.co",
    context: "Bright Supply · Vendor",
    status: "pending",
    lastLine: "Link sent — not yet claimed.",
    lastTime: "Aug 19",
    policy: "Orders only",
    about: "Fulfillment vendor for launch kits. Reorders go through their portal.",
    connected: "—",
    agents: {
      yours: { status: "Idle", lastRun: "Never run" },
      theirs: { present: false, lastSeen: "Not yet claimed" },
    },
    link: {
      url: "dopl.link/c/x7Kd92mQ",
      expires: "Expires Aug 28",
      uses: "Single use",
    },
    feed: [],
  },
];
