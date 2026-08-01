/**
 * SHARED HARNESS — the agent-addressing suites.
 *
 * Two suites read this one channel: `channel-agent-addressing.test.ts` (what a
 * POST addresses — `to_agent` / `as_agent` / `to_agents` / `intent`) and
 * `channel-thread-participants.test.ts` (who is admitted to a THREAD — the
 * `create_thread` seed and the set `get_thread` renders). They were one file
 * until it passed the §2 500-line cap.
 *
 * Extracted rather than copied because both halves depend on the SAME
 * asymmetry: the CHANNEL roster is a strict subset of the WORKSPACE roster
 * (Dale is only in the workspace), which is precisely the B2 case one half
 * pins and the other half must not quietly relax. Two private copies is how
 * one of them grows a Dale who is also a channel member and stops testing
 * anything.
 *
 * Not a `.test.ts` file (vitest would find no tests in it), and deliberately
 * NOT named `channel-*`: `toolGroupFiles` in `tool-group-files.ts` groups every
 * non-test `channel-*.ts` as CHANNEL TOOL SOURCE, so that prefix would feed
 * this harness into the parity and await-cap source scans as if it shipped.
 * Same reason `narration-fixtures.ts` carries no tool stem.
 */

import { vi } from "vitest";
import type { DoplClient } from "@dopl/client";

export const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

export const QUARTZ = {
  id: "agent-1",
  channelId: "chan-1",
  workspaceId: "ws-1",
  ownerUserId: "u-me",
  name: "quartz",
  status: "active",
  createdAt: "2026-07-31T00:00:00Z",
  updatedAt: "2026-07-31T00:00:00Z",
};
/** Bob's agent — the one this caller may ADDRESS but may never speak AS. */
export const ONYX = { ...QUARTZ, id: "agent-2", ownerUserId: "u-bob", name: "onyx" };

export const BOB = {
  userId: "u-bob",
  email: "bob@x.com",
  displayName: "Bob",
  status: "active",
};
export const CARA = {
  userId: "u-cara",
  email: "cara@x.com",
  displayName: "Cara",
  status: "active",
};
/** In the WORKSPACE, not in the channel — the B2 case, and the common one. */
export const DALE = {
  userId: "u-dale",
  email: "dale@x.com",
  displayName: "Dale",
  status: "active",
};

type PostSpy = (
  channelId: string,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export function stubClient(overrides: Record<string, unknown> = {}): DoplClient {
  const postChannelMessage = vi.fn<PostSpy>(async () => ({
    id: "m1",
    seq: 12,
    kind: "message",
    metadata: {},
    authorUserId: "u-me",
  }));
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listChannelAgents: vi.fn(async () => [QUARTZ, ONYX]),
    // The CHANNEL roster — a strict subset of the workspace. Dale is only in
    // the workspace, which is exactly the shape B2 is about.
    listChannelMembers: vi.fn(async () => [
      { userId: "u-me", displayName: "Me", email: "me@x.com", role: "owner" },
      { userId: "u-bob", displayName: "Bob", email: "bob@x.com", role: "member" },
      { userId: "u-cara", displayName: "Cara", email: "cara@x.com", role: "member" },
    ]),
    listWorkspaceMembers: vi.fn(async () => [BOB, CARA, DALE]),
    listChannelThreads: vi.fn(async () => []),
    postChannelMessage,
    ...overrides,
  } as unknown as DoplClient;
}

export function apiError(status: number, code?: string): unknown {
  return Object.assign(new Error(`HTTP ${status}`), { status, code });
}

export const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");
