/**
 * Channels v2 — MY RUNNING AGENTS, the fixture behind the right panel's Agents
 * tab and the agent view it opens.
 *
 * ⚠ HARDCODED — no backing data yet (Samuel 2026-08-18). The Agents tab and the
 * agent view are wired in Phase 5 of the wiring plan, over a WIDENED desktop
 * session projection that does not exist: context occupancy and token spend are
 * runtime metrics the server stores none of (MAPPING.md § Agents tab & the
 * agent view; wiring plan, Risk 5). The fixture stays so the designed surface
 * remains visible and reviewable rather than being replaced by an empty state
 * for three phases.
 *
 * This is an OPERATOR fixture, not a roster: every row is one of the viewer's
 * own agents. Other members' agents are visible as message authors, never as
 * rows here — their runtime is in their window.
 *
 * ⚠ SELF-CONTAINED on purpose. In the mock these rows named `mock-threads.ts`
 * ids and imported two message strings out of the thread transcripts so the two
 * fixtures could not disagree. Threads are REAL now, and a fixture agent
 * pointing at a real thread id would be a fabricated claim that a real exchange
 * has an agent on it. Titles are literals here, and the agent view's header no
 * longer navigates.
 */

/** Liveness as the panel draws it. `running` = the loop is turning right now;
 *  `idle` = it is still mine and still holds its context, but nothing is in
 *  flight. Neither means "finished" — a finished agent leaves the list. */
export type AgentState = "running" | "idle";

/** Which glyph narrates a work entry. Three verbs is the whole vocabulary: the
 *  feed says what KIND of work is happening, not which tool ran. */
export type AgentWorkKind = "scan" | "read" | "edit";

interface AgentEntryBase {
  id: string;
  /** Relative, pre-formatted — there is no clock behind this fixture. */
  time: string;
  text: string;
}

/**
 * The agent NARRATING ITSELF: what it is thinking about and touching. This is
 * the lane a thread transcript never shows, and the reason the agent view
 * exists at all.
 */
export interface AgentWorkEntry extends AgentEntryBase {
  kind: "work";
  work: AgentWorkKind;
}

/** A message this agent actually POSTED into a thread, captioned with where it
 *  went. */
export interface AgentSentEntry extends AgentEntryBase {
  kind: "sent";
  to: string;
}

/**
 * One line of the DIRECT 1:1 lane between me and this agent. It does NOT reach
 * the thread — operator↔agent traffic is out-of-band, which is exactly why it
 * lives in this panel instead of the composer.
 */
export interface AgentDirectEntry extends AgentEntryBase {
  kind: "direct";
  from: "me" | "agent";
}

export type AgentActivityEntry =
  | AgentWorkEntry
  | AgentSentEntry
  | AgentDirectEntry;

export interface FixtureAgent {
  id: string;
  label: string;
  /** Literal title, NOT a thread id — see the file header. TWO agents may name
   *  the same title; that is a shape the panel has to draw, not a bug. */
  threadTitle: string;
  state: AgentState;
  /** Bare relative phrase; the UI composes "Started 2h ago". */
  startedAt: string;
  lastActivityAt: string;
  /** Context window occupancy, in tokens — what the meter reads. */
  contextUsed: number;
  contextWindow: number;
  /** Lifetime spend, pre-formatted: these run to millions and a raw integer
   *  reads as noise in a caption. */
  tokensSpent: string;
  /** Oldest first, like a transcript. */
  activity: AgentActivityEntry[];
}

const UIKIT_KIT_PAGE_NOTE =
  "Put the drafted states on the kit review page so they can be read side by side. I renamed btn/secondary to btn/light so the names match the code — flagging it so the library stays in sync.";

const QA_SWEEP_PROGRESS_NOTE =
  "Started on the front-end side while Diana's agent walks the design file. 9 of 21 screens read — 4 spacing values off the 4px rhythm and one grey that is not a token. Per-screen list to follow.";

export const FIXTURE_AGENTS: FixtureAgent[] = [
  {
    id: "uikit-states",
    label: "UI-kit design worker",
    threadTitle: "UI-kit design",
    state: "running",
    startedAt: "2h ago",
    lastActivityAt: "2m ago",
    contextUsed: 84_000,
    contextWindow: 200_000,
    tokensSpent: "1.2M",
    activity: [
      {
        id: "a1-1",
        kind: "sent",
        to: "UI-kit design",
        time: "4h ago",
        text: UIKIT_KIT_PAGE_NOTE,
      },
      {
        id: "a1-2",
        kind: "work",
        work: "scan",
        time: "12m ago",
        text: "Scanning 14 components for token drift…",
      },
      {
        id: "a1-3",
        kind: "work",
        work: "edit",
        time: "2m ago",
        text: "Publishing the two disabled faces onto the kit review page",
      },
    ],
  },
  {
    // The richest feed: all three lanes, including the ONE question that made
    // Samuel ask for this surface — "why did you do X".
    id: "qa-sweep-frontend",
    label: "Design QA sweep worker",
    threadTitle: "Design QA sweep",
    state: "running",
    startedAt: "12m ago",
    lastActivityAt: "40s ago",
    contextUsed: 18_000,
    contextWindow: 200_000,
    tokensSpent: "210k",
    activity: [
      {
        id: "a2-1",
        kind: "work",
        work: "read",
        time: "11m ago",
        text: "Reading design-tokens.css and the v3.0 spacing scale",
      },
      {
        id: "a2-2",
        kind: "work",
        work: "scan",
        time: "9m ago",
        text: "Scanning 21 screens for spacing and token drift…",
      },
      {
        id: "a2-3",
        kind: "sent",
        to: "Design QA sweep",
        time: "6m ago",
        text: QA_SWEEP_PROGRESS_NOTE,
      },
      {
        id: "a2-4",
        kind: "direct",
        from: "me",
        time: "4m ago",
        text: "Why did you skip the button variants?",
      },
      {
        id: "a2-5",
        kind: "direct",
        from: "agent",
        time: "3m ago",
        text: "They are not on the freeze list — the variant sheet is owned by the UI-kit thread, so counting them here would report the same drift twice. Say the word and I'll fold them in.",
      },
      {
        id: "a2-6",
        kind: "work",
        work: "edit",
        time: "40s ago",
        text: "Writing the per-screen drift list — 9 of 21 screens done",
      },
    ],
  },
  {
    // SECOND agent on "UI-kit design". Two of mine on one thread is normal: one
    // is drafting states, this one audited the colours and is holding its
    // findings. It is idle and nearly full — the meter says so in amber.
    id: "uikit-token-audit",
    label: "Token drift auditor",
    threadTitle: "UI-kit design",
    state: "idle",
    startedAt: "yesterday",
    lastActivityAt: "3h ago",
    contextUsed: 152_000,
    contextWindow: 200_000,
    tokensSpent: "4.8M",
    activity: [
      {
        id: "a3-1",
        kind: "work",
        work: "scan",
        time: "yesterday",
        text: "Walked 240 colour declarations across the v3.0 file",
      },
      {
        id: "a3-2",
        kind: "direct",
        from: "me",
        time: "3h ago",
        text: "Anything left that is not on a token?",
      },
      {
        id: "a3-3",
        kind: "direct",
        from: "agent",
        time: "3h ago",
        text: "Six greys and two shadows. They are in the audit note — I stopped there rather than rewriting them, since the kit freeze has not landed.",
      },
    ],
  },
];

/**
 * How many of MY agents are on each thread title. Two on one thread is the case
 * the cards have to make obvious, and a count is the cheapest way to say it
 * without the reader having to compare two `↳` lines.
 */
export const AGENTS_PER_THREAD: Record<string, number> = FIXTURE_AGENTS.reduce<
  Record<string, number>
>((acc, agent) => {
  acc[agent.threadTitle] = (acc[agent.threadTitle] ?? 0) + 1;
  return acc;
}, {});

/**
 * Fixture order, REGROUPED so agents sharing a thread sit next to each other —
 * a card between them hides the very thing this tab has to show. Group order
 * follows first appearance, and `sort` is stable, so within a thread the
 * fixture order survives.
 */
const THREAD_ORDER = [...new Set(FIXTURE_AGENTS.map((a) => a.threadTitle))];

export const GROUPED_FIXTURE_AGENTS: FixtureAgent[] = [...FIXTURE_AGENTS].sort(
  (a, b) =>
    THREAD_ORDER.indexOf(a.threadTitle) - THREAD_ORDER.indexOf(b.threadTitle)
);

/** `84_000` → `"84k"`. Tokens are only ever glanced at here; the exact integer
 *  is noise at caption size. */
export function formatTokens(value: number): string {
  return `${Math.round(value / 1000)}k`;
}
