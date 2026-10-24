/**
 * Every word (and every scripted beat) in the Orchestration section — tab copy
 * AND the strings drawn inside the four animated windows — in one place, so
 * copy can change without touching markup.
 * Markup: ./ontology-section.tsx (shell + tour), ./ontology-windows.tsx
 * (Context, Channels, Tasks), ./ontology-command.tsx (Command).
 *
 * ⚠ Times are ms from the moment the window starts playing. The tab meter
 * fills over `endMs` plus a short settle and the tour advances when it is full
 * (ontology-section.tsx › SETTLE_MS), with no hold.
 */

export const ORCH_COPY = {
  eyebrow: "Orchestration",
  heading: "Unparalleled orchestration for all of your work",
  tablistLabel: "Orchestration views",
} as const;

/** Runtime marks, the same files the onboarding runtime picker shows. */
const RUNTIME = {
  claude: { name: "Claude", logo: "/img/onboarding/claude-logo.svg" },
  grok: { name: "Grok", logo: "/img/logos/grok-bot.png" },
  muse: { name: "Muse", logo: "/img/onboarding/muse-logo.svg" },
  chatgpt: { name: "ChatGPT", logo: "/img/onboarding/chatgpt-logo.svg" },
} as const;
type Runtime = (typeof RUNTIME)[keyof typeof RUNTIME];

export type AgentId = "orchestrator" | "scout" | "liaison" | "booker";

/** Sam's identities. `color` is an agent colour-bank slot (1 to 16): identity,
 *  never status. Search runs on Grok, communication on Muse, the rest on
 *  ChatGPT, and the orchestrator on Claude. */
export const AGENTS: Record<AgentId, { name: string; color: number; runtime: Runtime }> = {
  orchestrator: { name: "Orchestrator", color: 3, runtime: RUNTIME.claude },
  scout: { name: "Scout", color: 6, runtime: RUNTIME.grok },
  liaison: { name: "Liaison", color: 9, runtime: RUNTIME.muse },
  booker: { name: "Booker", color: 13, runtime: RUNTIME.chatgpt },
};

/** People. "sam" is the visitor's stand-in, the one directing the agents. */
export const PEOPLE = {
  sam: { name: "Sam", photo: "/img/onboarding/onboarding-avatar-4.jpg" },
  anthony: { name: "Anthony", photo: "/img/avatars/anthony.jpg" },
  grace: { name: "Grace", photo: "/img/avatars/grace-v2.jpg" },
} as const;
export type PersonId = keyof typeof PEOPLE;

/** Other people's identities that Sam's agents talk to: drawn with that
 *  person's photo and their own runtime, named "<Name>'s Assistant". */
export const ASSISTANTS: Partial<Record<PersonId, { color: number; runtime: Runtime }>> = {
  grace: { color: 11, runtime: RUNTIME.muse },
  anthony: { color: 15, runtime: RUNTIME.chatgpt },
};

/** Who a row/message belongs to: one of Sam's agents, a person, or another
 *  person's assistant. */
export type Actor = { agent: AgentId } | { person: PersonId } | { assistant: PersonId };

export const DOPL_MARK = "/img/onboarding/dopl-mark.png";

// ── 1 · Build & share memory: Scout researches, the ontology organizes it ─

export const CONTEXT = {
  endMs: 6000,
  writer: "scout" as AgentId,
  kbLabel: "Knowledge base",
  kbTitle: "Offsite options",
  writing: "researching…",
  wrote: "wrote 3 entries",
  /** `at` = when the entry lands; `detail` = venue, price, flight from SFO. */
  entries: [
    { name: "Lisbon", detail: "Casa do Rio · $2,070/night · 11h from SFO", at: 700 },
    { name: "Barcelona", detail: "Hotel Arts · $2,450/night · 12h from SFO", at: 1300 },
    { name: "Porto", detail: "Quinta da Vila · $1,480/night · 14h from SFO", at: 1900 },
  ],
  sourcesLabel: "From",
  wireAt: 2600,
  objLabel: "Ontology · Event",
  objTitle: "Q1 Team Offsite",
  objAt: 3100,
  fields: [
    { key: "Dates", value: "Mar 12 to 14", at: 3400 },
    { key: "Location", value: "Lisbon", at: 3650 },
    { key: "Attendees", value: "5", at: 3900 },
    { key: "Budget", value: "$12,000", at: 4150 },
  ],
  peopleLabel: "People",
  /** Linked people, each with their home airport; `more` = the rest. */
  people: [
    { id: "sam", airport: "SFO" },
    { id: "grace", airport: "SFO" },
    { id: "anthony", airport: "JFK" },
  ] as { id: PersonId; airport: string }[],
  more: "+2",
  peopleAt: 4500,
  templateBadge: "Template",
  template: "Event: dates, location, people, budget",
  templateAt: 5500,
} as const;

// ── 2 · Coordinate & hand off: the agents plan it together in a channel ───

export type ChannelLine =
  | { kind: "msg"; from: Actor; text: string }
  | { kind: "event"; text: string };

export const CHANNEL = {
  name: "q1-offsite",
  /** In order; the timeline is derived from this list (ontology-thread.ts),
   *  so copy edits never desync it. ⚠ Rail steps below cite these INDICES. */
  lines: [
    { kind: "msg", from: { person: "sam" }, text: "@Orchestrator plan our Q1 offsite for 5 people, under $12k." },
    { kind: "msg", from: { agent: "orchestrator" }, text: "On it. Bringing in @Scout, @Liaison, and @Booker." },
    { kind: "event", text: "Orchestrator launched Scout, Liaison, and Booker" },
    {
      kind: "msg",
      from: { agent: "liaison" },
      text: "@Grace's Assistant when is Grace free in March, and which airport does she fly from?",
    },
    { kind: "msg", from: { assistant: "grace" }, text: "Grace is free March 10 to 20 and flies from SFO." },
    { kind: "msg", from: { assistant: "anthony" }, text: "Anthony is free March 11 to 15 and flies from JFK." },
    {
      kind: "msg",
      from: { agent: "scout" },
      text: "Top pick is Casa do Rio in Lisbon, $6,200 for 3 nights. @Booker it's yours.",
    },
  ] as ChannelLine[],
  /** The agent rail beside the feed (ontology-agent-rail.tsx), one card per
   *  agent in the channel, in this order. Steps: [status, line index, edge]. */
  rail: {
    contextLabel: "Context tokens",
    spentLabel: "spent",
    agents: [
      {
        agent: "orchestrator",
        identity: "Orchestrator",
        steps: [
          ["idle", 0, "start"],
          ["working", 0, "land"],
          ["posting", 1, "typing"],
          ["working", 1, "after"],
          ["idle", 6, "after"],
        ],
        /** Context used, in k tokens: at the card's first step, then its last. */
        context: [288, 341],
        limit: "1M",
        limitK: 1000,
        spent: "1.4M",
      },
      {
        agent: "scout",
        identity: "Scout",
        steps: [
          ["working", 2, "land"],
          ["posting", 6, "typing"],
          ["done", 6, "after"],
        ],
        context: [40, 212],
        limit: "1M",
        limitK: 1000,
        spent: "860k",
      },
      {
        agent: "liaison",
        identity: "Liaison",
        steps: [
          ["working", 2, "land"],
          ["posting", 3, "typing"],
          ["working", 3, "after"],
          ["done", 5, "after"],
        ],
        context: [22, 74],
        limit: "400k",
        limitK: 400,
        spent: "190k",
      },
      {
        agent: "booker",
        identity: "Booker",
        steps: [
          ["queued", 2, "land"],
          ["working", 6, "land"],
        ],
        context: [12, 31],
        limit: "400k",
        limitK: 400,
        spent: "64k",
      },
    ],
  },
} as const;

export type RailStatus = "idle" | "queued" | "working" | "posting" | "done";
/** Which moment of a feed line a rail step fires on: the window start, the
 *  line's typing row, the line landing, or a beat after it lands. */
export type RailEdge = "start" | "typing" | "land" | "after";

export const RAIL_STATUS_LABEL: Record<RailStatus, string> = {
  idle: "Idle",
  queued: "Queued",
  working: "Working",
  posting: "Posting",
  done: "Done",
};

// ── 3 · Track & finish work: the task tracker ─────────────────────────────

// PLANNED: task tracker not shipped yet. Samuel is adding it; this window is a
// plausible mock of it, so keep its vocabulary in step with the real feature
// when it lands.
export type TaskStatus = "queued" | "working" | "done" | "needs";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Queued",
  working: "In progress",
  done: "Done",
  needs: "Needs you",
};

export const TASKS = {
  endMs: 4400,
  label: "Tasks",
  title: "Q1 Team Offsite",
  /** `steps` = status changes in order; the LAST one is the static end frame. */
  rows: [
    { title: "Collect availability", owner: { agent: "liaison" }, steps: [["working", 0], ["done", 700]] },
    { title: "Shortlist venues", owner: { agent: "scout" }, steps: [["working", 0], ["done", 1600]] },
    {
      title: "Gather traveler details",
      owner: { agent: "liaison" },
      steps: [["queued", 0], ["working", 900], ["done", 2600]],
    },
    {
      title: "Book Casa do Rio, $6,200",
      owner: { agent: "booker" },
      steps: [["queued", 0], ["working", 2000], ["needs", 3400]],
    },
    { title: "Book 5 flights", owner: { agent: "booker" }, steps: [["queued", 0], ["working", 3800]] },
    { title: "Send itinerary", owner: { agent: "liaison" }, steps: [["queued", 0]] },
  ] as { title: string; owner: Actor; steps: [TaskStatus, number][] }[],
} as const;

// ── 4 · Direct at any depth: notifications + directing one sub-agent ──────

export const COMMAND = {
  endMs: 8000,
  notificationsLabel: "Notifications",
  app: "Dopl",
  /** Newest arrives on TOP. `decision` rows carry the two answer buttons. */
  notifications: [
    { title: "Orchestrator launched Liaison", body: "#q1-offsite", at: 400 },
    { title: "Liaison reached Grace's Assistant", body: "Asked for her March availability", at: 1500 },
    { title: "Booker needs your decision", body: "Book Casa do Rio for $6,200?", at: 3300, decision: true },
    { title: "Booker booked 5 flights", body: "SFO and JFK to Lisbon, March 12", at: 7400 },
  ],
  approve: "Approve",
  deny: "Deny",
  /** The drill-down, outermost first; the last crumb is the agent in view. */
  crumbs: [
    { agent: "orchestrator" as AgentId, at: 300 },
    { agent: "booker" as AgentId, at: 1300 },
  ],
  focus: "booker" as AgentId,
  parent: "orchestrator" as AgentId,
  liveness: "Working",
  infoAt: 2200,
  info: {
    context: "Context",
    contextValue: "64k / 400k",
    /** Fill of the context bar at the end frame, 0 to 1 (64k of 400k). */
    contextFill: 0.16,
    permission: "Permission",
    /** The agent's permission level, shown as a dropdown face (Ask / Auto / Full in the product). */
    level: "Auto",
    runtime: "Runtime",
    parent: "Parent",
  },
  stream: { text: "Holding 5 seats on TAP 236 to Lisbon…", at: 2900 },
  composerPlaceholder: "Message Booker",
  typeAt: 3800,
  typeStep: 42,
  mine: "Aisle seats for Grace and me.",
  sentAt: 5400,
  replyTypingAt: 5900,
  reply: { text: "Done. Seats 14C and 15C.", at: 6900 },
} as const;

// ── The tour ──────────────────────────────────────────────────────────────

export const STAGE_COPY = {
  context: {
    title: "Build & share memory",
    blurb: "Write knowledge once and organize it into context every identity can read.",
  },
  channels: {
    title: "Coordinate & hand off",
    blurb: "Work moves between identities in shared channels, with full visibility.",
  },
  tasks: {
    title: "Track & finish work",
    blurb: "See every task in progress and what is waiting on you.",
  },
  command: {
    title: "Direct at any depth",
    blurb: "Get notified when work branches, and step into any part of it.",
  },
} as const;
