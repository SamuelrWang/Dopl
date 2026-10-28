import type {
  IdentitiesPreview,
  IdentityAction,
  IdentityPreview,
} from "@/features/home/preview-types";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { AgentIdentity } from "../client/types";
import { endedRuns, normalName, touchedAt, type IdentityRun, type IdentityUse } from "./identity-runs";

/**
 * The account's seeded preview (`GET /api/home/preview › identities`, INVARIANTS §4A) laid over the
 * Identities face. An identity with no entry reads exactly as it does with no preview at all.
 */

export type PreviewIndex = ReadonlyMap<string, IdentityPreview>;

/** Each identity's entry, keyed by identity id: by id first, then by name among unclaimed entries. */
export function matchPreviews(
  identities: ReadonlyArray<AgentIdentity>,
  preview: IdentitiesPreview | null
): PreviewIndex {
  const index = new Map<string, IdentityPreview>();
  const entries = preview?.identities ?? [];
  if (entries.length === 0) return index;
  const claimed = new Set<IdentityPreview>();
  for (const identity of identities) {
    const entry = entries.find((e) => e.identityId === identity.id);
    if (!entry) continue;
    index.set(identity.id, entry);
    claimed.add(entry);
  }
  for (const identity of identities) {
    if (index.has(identity.id)) continue;
    const name = normalName(identity.name);
    const entry = entries.find(
      (e) => !claimed.has(e) && e.name !== undefined && normalName(e.name) === name
    );
    if (entry) index.set(identity.id, entry);
  }
  return index;
}

export function hasRules(entry: IdentityPreview | undefined): entry is IdentityPreview {
  return !!entry && entry.tools.length + entry.rules.length + entry.escalations.length > 0;
}

export function channelLabel(name: string): string {
  return `#${name.replace(/^#+/, "")}`;
}

/** The channels a shared row reaches: the selected one, plus the entry's. */
export function sharedReach(entry: IdentityPreview | undefined, channelName: string): string[] {
  return [...new Set([channelName, ...(entry?.channels ?? [])].map(channelLabel))];
}

export function reachLabel(reach: ReadonlyArray<string>): string {
  if (reach.length === 1) return `Shared in ${reach[0]}`;
  if (reach.length === 2) return `Shared in ${reach[0]} and ${reach[1]}`;
  return `Shared in ${reach.length} channels`;
}

function loggedAt(action: IdentityAction): number {
  return Date.parse(action.at);
}

/** `use` with each entry's latest logged action counted as a use. */
export function withLoggedUse(
  use: ReadonlyMap<string, IdentityUse>,
  index: PreviewIndex
): ReadonlyMap<string, IdentityUse> {
  if (index.size === 0) return use;
  const out = new Map(use);
  for (const [id, entry] of index) {
    if (entry.actionLog.length === 0) continue;
    const last = Math.max(...entry.actionLog.map(loggedAt));
    const prev = out.get(id) ?? { running: 0, lastUsed: null };
    out.set(id, { ...prev, lastUsed: Math.max(prev.lastUsed ?? last, last) });
  }
  return out;
}

/** The entry's log, most recent first. */
export function actionLogOf(entry: IdentityPreview | undefined): IdentityAction[] {
  return [...(entry?.actionLog ?? [])].sort((a, b) => loggedAt(b) - loggedAt(a));
}

export type RecentItem =
  | { kind: "run"; identity: AgentIdentity; at: number; session: DesktopSessionSummary }
  | { kind: "log"; identity: AgentIdentity; at: number; action: IdentityAction };

/** Finished agents and logged actions in one feed, most recent first. */
export function recentActivity(
  runs: ReadonlyArray<IdentityRun>,
  identities: ReadonlyArray<AgentIdentity>,
  index: PreviewIndex,
  limit = 7
): RecentItem[] {
  const ended: RecentItem[] = endedRuns(runs, limit).map(({ identity, session }) => ({
    kind: "run",
    identity,
    session,
    at: touchedAt(session) ?? 0,
  }));
  const logged: RecentItem[] = identities.flatMap((identity) =>
    (index.get(identity.id)?.actionLog ?? []).map((action) => ({
      kind: "log" as const,
      identity,
      action,
      at: loggedAt(action),
    }))
  );
  return [...ended, ...logged].sort((a, b) => b.at - a.at).slice(0, limit);
}
