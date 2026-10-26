import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { agentEndedAt } from "@/features/channels/components/agents-model";
import type { RuntimeDescriptor } from "@/features/channels/lib/runtime-capability";
import type { AgentIdentity } from "../client/types";

/**
 * What the Identities page knows about its roles' agents, from this machine's session feed
 * (`channels/components/use-desktop-sessions.ts`). A session names the identity it launched as by
 * NAME, a spawn-time snapshot, so the join is on the name. `null` sessions = could not ask, which
 * every reader keeps apart from "nothing ran" (INVARIANTS §11).
 */

export type Sessions = ReadonlyArray<DesktopSessionSummary> | null;

/** One of this machine's agents, and the identity it launched as. */
export interface IdentityRun {
  identity: AgentIdentity;
  session: DesktopSessionSummary;
}

function launchedAs(identity: AgentIdentity, session: DesktopSessionSummary): boolean {
  const name = session.identityName?.trim();
  return !!name && name === identity.name.trim();
}

export function runsOf(identity: AgentIdentity, sessions: Sessions): DesktopSessionSummary[] {
  return (sessions ?? []).filter((s) => launchedAs(identity, s));
}

/** Each session joined to the FIRST identity wearing its name, so a session is never listed twice
 *  when two shelves hold a role of the same name. */
function joinRuns(
  identities: ReadonlyArray<AgentIdentity>,
  sessions: Sessions
): IdentityRun[] {
  return (sessions ?? []).flatMap((session) => {
    const identity = identities.find((i) => launchedAs(i, session));
    return identity ? [{ identity, session }] : [];
  });
}

/** When an agent last did anything: its last activity, else when it ended, else when it started. */
function touchedAt(session: DesktopSessionSummary): number | null {
  return session.lastActivityAt ?? agentEndedAt(session) ?? session.startedAt ?? null;
}

/** Working before idle, then the most recently started. Ended agents never appear. */
export function liveRuns(
  identities: ReadonlyArray<AgentIdentity>,
  sessions: Sessions
): IdentityRun[] {
  const rank = (s: DesktopSessionSummary) => (s.state === "working" ? 0 : 1);
  return joinRuns(identities, sessions)
    .filter((run) => run.session.state !== "ended")
    .sort(
      (a, b) =>
        rank(a.session) - rank(b.session) ||
        (b.session.startedAt ?? 0) - (a.session.startedAt ?? 0)
    );
}

/** Finished agents, most recently ended first. */
export function endedRuns(
  identities: ReadonlyArray<AgentIdentity>,
  sessions: Sessions,
  limit = 7
): IdentityRun[] {
  return joinRuns(identities, sessions)
    .filter((run) => run.session.state === "ended")
    .sort((a, b) => (touchedAt(b.session) ?? 0) - (touchedAt(a.session) ?? 0))
    .slice(0, limit);
}

export function runningCount(identity: AgentIdentity, sessions: Sessions): number {
  return runsOf(identity, sessions).filter((s) => s.state !== "ended").length;
}

/** The latest moment any of this identity's agents was seen, or `null` when none is on record. */
export function lastUsedAt(identity: AgentIdentity, sessions: Sessions): number | null {
  const times = runsOf(identity, sessions)
    .map(touchedAt)
    .filter((t): t is number => t !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

/** "5m ago" from epoch ms. */
export function agoLabel(ms: number): string {
  return formatRelativeTime(new Date(ms).toISOString());
}

export type IdentitySort = "recent" | "name" | "running";

export const SORT_OPTIONS: ReadonlyArray<{ value: IdentitySort; label: string }> = [
  { value: "recent", label: "Recently used" },
  { value: "name", label: "Name" },
  { value: "running", label: "Running first" },
];

/** `runtime` is `"all"` or a runtime id. */
export interface IdentityArrangement {
  query: string;
  runtime: string;
  sort: IdentitySort;
}

export const DEFAULT_ARRANGEMENT: IdentityArrangement = { query: "", runtime: "all", sort: "recent" };

/**
 * Search, runtime filter, then sort. Search reads the name, description and runtime, never the
 * instructions, which would match half the list on a common word. A stable sort, so rows with no
 * history keep the server's order.
 */
export function arrangeIdentities(
  identities: ReadonlyArray<AgentIdentity>,
  { query, runtime, sort }: IdentityArrangement,
  sessions: Sessions
): AgentIdentity[] {
  const needle = query.trim().toLowerCase();
  const found = identities.filter((identity) => {
    if (runtime !== "all" && identity.runtime !== runtime) return false;
    if (needle === "") return true;
    return [identity.name, identity.description ?? "", identity.runtime ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  if (sort === "name") return found.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "running") {
    return found.sort((a, b) => runningCount(b, sessions) - runningCount(a, sessions));
  }
  return found.sort(
    (a, b) => (lastUsedAt(b, sessions) ?? -1) - (lastUsedAt(a, sessions) ?? -1)
  );
}

export interface RuntimeReadiness {
  id: string;
  label: string;
  ready: boolean;
}

/** Each registered runtime and whether it is signed in; `null` until the desktop has answered. */
export function runtimeReadiness(selection: {
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  connected: ReadonlyArray<string>;
  connectedKnown: boolean;
}): RuntimeReadiness[] | null {
  if (!selection.connectedKnown || selection.runtimes.length === 0) return null;
  return selection.runtimes.map((r) => ({
    id: r.id,
    label: r.label || r.id,
    ready: selection.connected.includes(r.id),
  }));
}
