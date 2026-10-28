/**
 * UI-STAGING FAKE DATA for /identities: the people behind the staged identities and this
 * machine's agents, in the desktop session feed's own shape (`use-desktop-sessions.ts`), so the
 * product face reads them exactly as it reads the bridge. Times are relative to the mount.
 */

import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { AvatarStackUser } from "@/shared/ui/avatar-stack";
import { STAGING_PEOPLE, STAGING_USER_ID } from "@/features/ui-staging/staging-stubs";

export function photoOf(userId: string | null): string | null {
  return STAGING_PEOPLE.find((p) => p.userId === userId)?.avatarUrl ?? null;
}

export function nameOf(userId: string): string | null {
  return STAGING_PEOPLE.find((p) => p.userId === userId)?.displayName ?? null;
}

/** The channel's people besides the viewer: who can wear a shared identity. */
export const STAGING_PEERS: ReadonlyArray<AvatarStackUser> = STAGING_PEOPLE.filter(
  (p) => p.userId !== STAGING_USER_ID
).map((p) => ({
  userId: p.userId,
  displayName: p.displayName ?? p.email ?? "Member",
  avatarUrl: p.avatarUrl ?? null,
}));

const MIN = 60_000;

interface AgentSeed {
  /** Absent = a session from a desktop older than the id stamp: joined by name. */
  identityId?: string;
  identityName: string;
  agent: string;
  channel: string;
  thread: string;
  state: DesktopSessionSummary["state"];
  /** Minutes ago it started (live) or ended. */
  ago: number;
  color: string;
  runtime: string;
}

const AGENTS: ReadonlyArray<AgentSeed> = [
  { identityId: "id-release", identityName: "Release Captain", agent: "Release Captain", channel: "releases", thread: "Cut 1.7.24", state: "working", ago: 40, color: "agent-03", runtime: "claude" },
  { identityId: "id-sql", identityName: "SQL Reviewer", agent: "SQL Reviewer", channel: "tech-debt", thread: "Teardown order fix", state: "working", ago: 15, color: "agent-11", runtime: "codex" },
  { identityId: "id-sql", identityName: "SQL Reviewer", agent: "Schema Diff", channel: "api-v2-migration", thread: "Payload parity", state: "idle", ago: 6, color: "agent-07", runtime: "codex" },
  { identityId: "id-coder", identityName: "Coder", agent: "Identity Cards", channel: "tech-debt", thread: "Card overhaul", state: "working", ago: 5, color: "agent-14", runtime: "claude" },
  { identityId: "id-flake", identityName: "Flake Hunter", agent: "Flake Hunter", channel: "flaky-tests", thread: "Device token expiry", state: "working", ago: 3, color: "agent-05", runtime: "codex" },
  { identityId: "id-chief", identityName: "Chief of Staff", agent: "Chief of Staff", channel: "tech-debt", thread: "Monday digest", state: "ended", ago: 20, color: "agent-09", runtime: "claude" },
  { identityId: "id-release", identityName: "Release Captain", agent: "Release Captain", channel: "releases", thread: "Cut 1.7.23", state: "ended", ago: 180, color: "agent-03", runtime: "claude" },
  { identityId: "id-sql", identityName: "SQL Reviewer", agent: "Schema Diff", channel: "tech-debt", thread: "Index audit", state: "ended", ago: 300, color: "agent-07", runtime: "codex" },
  { identityName: "Researcher", agent: "Pricing notes", channel: "tech-debt", thread: "Agent pricing", state: "ended", ago: 2880, color: "agent-12", runtime: "codex" },
];

export function stagingSessions(now: number): DesktopSessionSummary[] {
  return AGENTS.map((a, i) => {
    const at = now - a.ago * MIN;
    const ended = a.state === "ended";
    return {
      sessionId: `stg-session-${i}`,
      channelId: `stg-ch-${a.channel}`,
      threadId: `stg-th-${i}`,
      agentId: `a${String(i).padStart(7, "0")}`,
      name: `a${String(i).padStart(7, "0")}`,
      displayName: a.agent,
      state: a.state,
      detail: a.state === "working" ? "thinking" : null,
      channelName: a.channel,
      threadTitle: a.thread,
      identityName: a.identityName,
      identityId: a.identityId ?? null,
      color: a.color,
      runtimeId: a.runtime,
      startedAt: ended ? at - 30 * MIN : at,
      lastActivityAt: ended ? at : now - MIN,
      endedAt: ended ? at : null,
    };
  });
}
