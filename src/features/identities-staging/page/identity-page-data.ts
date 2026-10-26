"use client";

/**
 * THE PAGE'S OWN DATA (item 3c; staging data layer, never ported) — the facts that belong to the
 * SET of identities rather than to any one of them, which is the whole distinction item 3b was
 * about. Four things live here:
 *
 * 1. **The channels the page can scope to** ({@link STAGING_CHANNELS}). Samuel, item 3c: *"this
 *    page shows everything from all channels and then the user can scope it down to view the
 *    elements from just one specific channel… what is shown is basically tied to which channel is
 *    actually selected, which I'm now thinking about is actually not necessarily the best."*
 * 2. **Which channels a shared identity reaches** ({@link sharedReach}).
 * 3. **Whether each runtime can actually launch** ({@link runtimeReadiness}).
 * 4. **The aggregates the page draws**: what is running everywhere, and one feed of what every
 *    identity did ({@link activeEverywhere}, {@link pageFeed}).
 *
 * ⚠ **WHAT IS REAL AND WHAT IS NOT** (PORTING.md carries this too):
 * - The identity rows are the store's. Everything else on this page is mock.
 * - **Reach is the one that is also an open PRODUCT question, not just missing data.** A shared
 *   identity lives in ONE link container today, so "shared in #releases and #tech-debt" assumes a
 *   container can back more than one channel, or that an identity can be lent to several. Which of
 *   those is true is Samuel's call; the UI here shows the shape either answer needs.
 * - Runtime readiness is a real desktop fact (`use-launch-selection.ts` knows the registered
 *   runtimes; the sign-in state is the runtime prompt's) that no web page can read.
 */

import { STAGING_RUNTIMES } from "../data";
import {
  identityViewMock,
  type IdentityLogMock,
  type IdentityRunMock,
} from "../view/identity-view-mocks";
import type { AgentIdentity } from "@/features/agent-identities/client/types";

// ─── The channels the page can scope to ──────────────────────────────

/** `"all"` is the DEFAULT, which is the amendment: the page is no longer bound to one channel. */
export type ChannelScope = "all" | string;

/** The names the demo's channel column uses, so the staged pages agree. */
export const STAGING_CHANNELS: ReadonlyArray<string> = [
  "#tech-debt",
  "#releases",
  "#api-v2-migration",
  "#design-review",
  "#flaky-tests",
];

/** Which channels each shared identity reaches. See the header: this is the open product question. */
const REACH: Record<string, ReadonlyArray<string>> = {
  "id-release": ["#releases", "#tech-debt"],
  "id-postmortem": ["#tech-debt"],
  "id-sql": ["#tech-debt", "#api-v2-migration"],
  "id-critic": ["#design-review"],
  "id-flake": ["#flaky-tests", "#tech-debt"],
};

export function sharedReach(identity: AgentIdentity): ReadonlyArray<string> {
  return REACH[identity.id] ?? [];
}

/** What a shared card's scope line says, given the page's scope. Scoped to one channel the row's
 *  own reach is implied, so the line says the channel; across all of them it says the reach. */
export function reachLabel(identity: AgentIdentity, scope: ChannelScope): string | null {
  const reach = sharedReach(identity);
  if (reach.length === 0) return null;
  if (scope !== "all") return `Shared in ${scope}`;
  if (reach.length === 1) return `Shared in ${reach[0]}`;
  if (reach.length === 2) return `Shared in ${reach[0]} and ${reach[1]}`;
  return `Shared in ${reach.length} channels`;
}

/**
 * Does this row belong in the grid at the current scope?
 *
 * ⚠ **ONLY A SHARED ROW IS CHANNEL-SCOPED.** A private row lives on your home shelf and is yours
 * in every channel, so narrowing the page to one channel must not hide it — that is the other half
 * of what the scope control means, and getting it wrong empties the Personal section.
 */
export function inScope(identity: AgentIdentity, scope: ChannelScope): boolean {
  if (scope === "all") return true;
  if (identity.visibility !== "workspace") return true;
  return sharedReach(identity).includes(scope);
}

// ─── Runtime readiness ───────────────────────────────────────────────

export type RuntimeState = "ready" | "reauth" | "signin";

export interface RuntimeReadiness {
  id: string;
  label: string;
  state: RuntimeState;
}

/** The three worlds Samuel named: everything ready, something needs re-auth, something is not
 *  signed in. The staged States pill switches between them (`identities-staging-page.tsx`). */
export type ReadinessScenario = "ready" | "reauth" | "signin";

export function runtimeReadiness(scenario: ReadinessScenario): ReadonlyArray<RuntimeReadiness> {
  return STAGING_RUNTIMES.map((runtime, i) => ({
    id: runtime.id,
    label: runtime.label ?? runtime.id,
    // The first runtime stays ready in every world: a page where nothing can launch is not the
    // state worth drawing, and the mixed row is the one that has to read well.
    state: scenario === "ready" || i === 0 ? "ready" : scenario,
  }));
}

// ─── The aggregates ──────────────────────────────────────────────────

/**
 * WHAT AN AGENT IS DOING — item 7, fix 7 (Samuel, 2026-10-22: *"I don't think it makes sense for
 * the green dots to be on the left there. I think there should be something on the right instead.
 * I think it should be more descriptive than just a green dot. Just say it's working, or if it's
 * working, if it's doing something, maybe if it's idle… I don't think it should show ended
 * agents."*).
 *
 * Two states reach the page and there is no third: **working** (running something now) and
 * **idle** (alive, between turns). `ended` is modelled ONLY so it can be dropped — see
 * {@link activeEverywhere}.
 */
export type AgentState = "working" | "idle";

/** The words the page prints. `working` carries the live dot; `idle` carries none, because a dot
 *  that means "not doing anything" is the decoration the ask removed. */
export const AGENT_STATE_WORD: Record<AgentState, string> = {
  working: "Working…",
  idle: "Idle",
};

export interface ActiveRun {
  identity: AgentIdentity;
  agent: string;
  channel: string;
  thread: string;
  since: string;
  state: AgentState;
}

/** `since` as minutes ("40m" → 40, "2h" → 120). The mock writes a label; this reads it back. */
function sinceMinutes(since: string): number {
  const n = Number.parseFloat(since);
  if (!Number.isFinite(n)) return 0;
  return /h/i.test(since) ? n * 60 : n;
}

/**
 * The mock's own state, derived and NOT random, so the server and client renders agree.
 *
 * ⚠ **IN THE PRODUCT THIS IS NOT DERIVED AT ALL.** The live session list reports its own state
 * (the desktop's session table is literally `working | idle | ended`), so the port reads that
 * field and deletes this function. The 30-minute line here only exists to produce a mixed list
 * out of fixtures that carry nothing but an elapsed label.
 */
function runState(since: string): AgentState {
  return sinceMinutes(since) <= 30 ? "working" : "idle";
}

/**
 * FINISHED RUNS, IN THE POOL ON PURPOSE.
 *
 * ⚠ **THIS IS NOT PADDING AND IT IS NOT THEATRE.** The product's live session list is the desktop
 * session table, and that table's own state column is `working | idle | ended` — it really does
 * hand back rows for agents that have stopped. `identity-view-mocks.ts › running` holds only live
 * rows, so a filter written against it alone would drop nothing, pass, and leave the one thing fix
 * 7 forbids ("I don't think it should show ended agents") unenforced the moment the page is wired
 * to real data. These rows make the pool look like what the product will hand over, so the gate in
 * {@link activeEverywhere} is exercised by `identity-page-data.test.ts` instead of being green by
 * accident.
 *
 * `identityId` must name an identity in `data.ts › SEED_IDENTITIES`, or the row never enters the
 * pool and the gate goes vacuous again — which is the trap this replaced. The test pins it.
 */
const ENDED_RUNS: ReadonlyArray<{ identityId: string } & IdentityRunMock> = [
  {
    identityId: "id-release",
    agent: "Release Captain",
    channel: "#releases",
    thread: "Cut 1.7.23",
    since: "3h",
  },
  {
    identityId: "id-sql",
    agent: "Schema Diff",
    channel: "#tech-debt",
    thread: "Index audit",
    since: "5h",
  },
];

/** What the product's session list hands over for one identity: live rows AND ended ones. */
export function pooledRuns(
  identity: AgentIdentity
): ReadonlyArray<IdentityRunMock & { state: AgentState | "ended" }> {
  return [
    ...identityViewMock(identity.id).running.map((run) => ({
      ...run,
      state: runState(run.since),
    })),
    ...ENDED_RUNS.filter((r) => r.identityId === identity.id).map((r) => ({
      agent: r.agent,
      channel: r.channel,
      thread: r.thread,
      since: r.since,
      state: "ended" as const,
    })),
  ];
}

/**
 * Every agent running from any of these identities. The page-level answer to a question no card
 * can answer about the others.
 *
 * 🔒 **ENDED AGENTS NEVER LEAVE THIS FUNCTION** (fix 7). The gate is here and not in the panel so
 * that no view can draw one by forgetting: the panel is handed a list that cannot contain one, and
 * `ActiveRun.state` has no `ended` member for it to carry. Working rows come before idle ones,
 * because "what is happening now" is the question the tab asks.
 */
export function activeEverywhere(
  identities: ReadonlyArray<AgentIdentity>
): ReadonlyArray<ActiveRun> {
  const runs = identities.flatMap((identity) =>
    pooledRuns(identity)
      // The one gate.
      .filter((run): run is IdentityRunMock & { state: AgentState } => run.state !== "ended")
      .map((run) => ({ identity, ...run }))
  );
  return [...runs].sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] || sinceMinutes(a.since) - sinceMinutes(b.since)
  );
}

const STATE_ORDER: Record<AgentState, number> = { working: 0, idle: 1 };

export interface FeedRow extends IdentityLogMock {
  identity: AgentIdentity;
}

/** One feed across every identity, most recent first — which is why a log row carries `at`
 *  (minutes ago) and not a clock string. */
export function pageFeed(
  identities: ReadonlyArray<AgentIdentity>,
  limit = 7
): ReadonlyArray<FeedRow> {
  return identities
    .flatMap((identity) =>
      identityViewMock(identity.id).log.map((row) => ({ identity, ...row }))
    )
    .sort((a, b) => a.at - b.at)
    .slice(0, limit);
}

// ─── The grid's own controls ─────────────────────────────────────────

export type SortKey = "recent" | "name" | "running";

export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "recent", label: "Recently used" },
  { value: "name", label: "Name" },
  { value: "running", label: "Running first" },
];

/** Minutes since this identity was last used, for the `recent` sort. `null` sorts last. */
function lastUsedRank(identity: AgentIdentity): number {
  const run = identityViewMock(identity.id).log;
  return run.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...run.map((r) => r.at));
}

function runningCount(identity: AgentIdentity): number {
  return identityViewMock(identity.id).running.length;
}

/**
 * Search, filter and sort, in that order. Search reads the name, the description and the runtime,
 * because those are the three things anyone would type; it does NOT read instructions, which would
 * match half the list on a common word.
 */
export function arrangeIdentities(
  identities: ReadonlyArray<AgentIdentity>,
  {
    query,
    runtime,
    sort,
    scope,
  }: { query: string; runtime: string; sort: SortKey; scope: ChannelScope }
): ReadonlyArray<AgentIdentity> {
  const needle = query.trim().toLowerCase();
  const found = identities.filter((identity) => {
    if (!inScope(identity, scope)) return false;
    if (runtime !== "all" && identity.runtime !== runtime) return false;
    if (needle === "") return true;
    const hay = [identity.name, identity.description ?? "", identity.runtime ?? ""]
      .join(" ")
      .toLowerCase();
    return hay.includes(needle);
  });
  const sorted = [...found];
  if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "recent") sorted.sort((a, b) => lastUsedRank(a) - lastUsedRank(b));
  if (sort === "running") sorted.sort((a, b) => runningCount(b) - runningCount(a));
  return sorted;
}
