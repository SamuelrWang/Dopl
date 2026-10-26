import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { AgentIdentity } from "../client/types";

/**
 * What the Identities page knows about its roles' agents, from this machine's session feed
 * (`channels/components/use-desktop-sessions.ts`). `null` sessions = could not ask, which every
 * reader keeps apart from "nothing ran" (INVARIANTS §11).
 */

export type Sessions = ReadonlyArray<DesktopSessionSummary> | null;

/** One of this machine's agents, and the identity it launched as. */
export interface IdentityRun {
  identity: AgentIdentity;
  session: DesktopSessionSummary;
}

/** `main/session-summary-text.js › displayText`'s collapse, so a name compares as the desktop wrote it. */
function normalName(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The identity a session ran as: by the id stamped at spawn, else (a session from a desktop older
 * than the stamp) by name, where a shared row must also be in the session's own workspace.
 */
function identityOf(
  identities: ReadonlyArray<AgentIdentity>,
  session: DesktopSessionSummary
): AgentIdentity | undefined {
  if (session.identityId) return identities.find((i) => i.id === session.identityId);
  const name = normalName(session.identityName);
  if (!name) return undefined;
  return identities.find(
    (i) =>
      normalName(i.name) === name &&
      (i.visibility === "private" || i.workspaceId === session.workspaceId)
  );
}

/** Every session credited to exactly one identity, or to none. */
export function joinRuns(
  identities: ReadonlyArray<AgentIdentity>,
  sessions: Sessions
): IdentityRun[] {
  return (sessions ?? []).flatMap((session) => {
    const identity = identityOf(identities, session);
    return identity ? [{ identity, session }] : [];
  });
}

/** When an agent last did anything: its last activity, else when it ended, else when it started. */
function touchedAt(session: DesktopSessionSummary): number | null {
  return session.lastActivityAt ?? session.endedAt ?? session.startedAt ?? null;
}

/** Working before idle, then the most recently started. Ended agents never appear. */
export function liveRuns(runs: ReadonlyArray<IdentityRun>): IdentityRun[] {
  const rank = (s: DesktopSessionSummary) => (s.state === "working" ? 0 : 1);
  return runs
    .filter((run) => run.session.state !== "ended")
    .sort(
      (a, b) =>
        rank(a.session) - rank(b.session) ||
        (b.session.startedAt ?? 0) - (a.session.startedAt ?? 0)
    );
}

/** Finished agents, most recently ended first. */
export function endedRuns(runs: ReadonlyArray<IdentityRun>, limit = 7): IdentityRun[] {
  return runs
    .filter((run) => run.session.state === "ended")
    .sort((a, b) => (touchedAt(b.session) ?? 0) - (touchedAt(a.session) ?? 0))
    .slice(0, limit);
}

export interface IdentityUse {
  running: number;
  /** Epoch ms; `null` = nothing on record, which is not "never used". */
  lastUsed: number | null;
}

const NO_USE: IdentityUse = { running: 0, lastUsed: null };

/** Each identity's live count and last use, keyed by identity id. */
export function usageOf(runs: ReadonlyArray<IdentityRun>): ReadonlyMap<string, IdentityUse> {
  const use = new Map<string, IdentityUse>();
  for (const { identity, session } of runs) {
    const prev = use.get(identity.id) ?? NO_USE;
    const at = touchedAt(session);
    use.set(identity.id, {
      running: prev.running + (session.state === "ended" ? 0 : 1),
      lastUsed: at === null ? prev.lastUsed : Math.max(prev.lastUsed ?? at, at),
    });
  }
  return use;
}

export function usageFor(use: ReadonlyMap<string, IdentityUse>, identity: AgentIdentity): IdentityUse {
  return use.get(identity.id) ?? NO_USE;
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
 * Search, runtime filter, then sort by `use`. Search reads the name, description and runtime,
 * never the instructions, which would match half the list on a common word. A stable sort, so rows
 * with no history keep the server's order.
 */
export function arrangeIdentities(
  identities: ReadonlyArray<AgentIdentity>,
  { query, runtime, sort }: IdentityArrangement,
  use: ReadonlyMap<string, IdentityUse>
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
    return found.sort((a, b) => usageFor(use, b).running - usageFor(use, a).running);
  }
  return found.sort((a, b) => (usageFor(use, b).lastUsed ?? -1) - (usageFor(use, a).lastUsed ?? -1));
}
