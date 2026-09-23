/** Shared ids, rows and module mocks for the launch-directive service suites. Named `-fixtures.ts`,
 *  not `*.test.ts`, so vitest imports it and never runs it. */

import { vi } from "vitest";
import type { ChannelContext } from "./service-shared";
import { LAUNCH_DIRECTIVE_TTL_MS } from "../constants";

export const WS = "22222222-2222-2222-2222-222222222222";
export const ME = "33333333-3333-3333-3333-333333333333";
export const CHAN = "11111111-1111-1111-1111-111111111111";
/** A valid v4 uuid, so a schema that parses it (`LaunchDecideSchema`) accepts it too. */
export const DIR = "55555555-5555-4555-8555-555555555555";

export const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  credentialSubjectUserId: ME,
  source: "agent",
  role: "member",
};

export const CHANNEL_ROW = { id: CHAN, slug: "general", name: "General", visibility: "private" };
export const MEMBERSHIP = { channel_id: CHAN, user_id: ME, role: "member" };

/** Module bodies for each suite's hoisted `vi.mock` factories. This file imports none of the modules
 *  it stands in for, so a factory can load it without a cycle. */
export const mocks = {
  launchRepo: {
    insertLaunchDirective: vi.fn(),
    findLaunchDirective: vi.fn(),
    findLaunchDirectiveByClientMsgId: vi.fn(),
    claimLaunchDirective: vi.fn(),
    decideLaunchDirective: vi.fn(),
  },
  agentOwner: { agentIsAnotherMembers: vi.fn() },
  collab: { presenceForWorkspace: vi.fn() },
  tasks: { findTaskByChannelAndId: vi.fn() },
  // The create's colour gate reads the taken set through a live `supabaseAdmin()`; only the reads
  // are stubbed, so the gate's policy still runs in every suite.
  sessionColors: {
    foreignLiveColorsByChannel: vi.fn(async () => new Map()),
    pendingDirectiveColors: vi.fn(async () => []),
  },
  // `service-launch.ts` loads this `server-only` barrel at module scope (via `service-launch-identity.ts`).
  identities: { resolveIdentityRef: vi.fn() },
  loadVisibleChannel: vi.fn(),
};

/** `./service-shared` with only `loadVisibleChannel` replaced. */
export async function serviceSharedMock(importOriginal: <T>() => Promise<T>) {
  const actual = await importOriginal<typeof import("./service-shared")>();
  return { ...actual, loadVisibleChannel: mocks.loadVisibleChannel };
}

/** A pending `launch` directive row as the repository returns it. */
export function row(over: Record<string, unknown> = {}) {
  return {
    id: DIR,
    kind: "launch",
    workspace_id: WS,
    channel_id: CHAN,
    task_id: null,
    operator_user_id: ME,
    goal: "ship the parser",
    model: null,
    identity_id: null,
    identity_name: null,
    target_agent_id: null,
    target_name: null,
    status: "pending",
    refusal_reason: null,
    agent_id: null,
    claimed_at: null,
    decided_at: null,
    expires_at: new Date(Date.now() + LAUNCH_DIRECTIVE_TTL_MS).toISOString(),
    created_at: new Date().toISOString(),
    ...over,
  } as never;
}

/** The operator's machine heartbeat just now (re-call it under a faked `Date`). */
export function online(): void {
  mocks.collab.presenceForWorkspace.mockResolvedValue(
    new Map([[ME, { online: true, lastSeenAt: new Date().toISOString() }]])
  );
}

/** The insert payload of the `call`-th `insertLaunchDirective`. */
export function inserted(call = 0): Record<string, unknown> {
  return mocks.launchRepo.insertLaunchDirective.mock.calls[call][1] as Record<string, unknown>;
}

/** Inserts answer `row()` overlaid with the insert's own fields, as the database would. */
export function echoInserts(): void {
  mocks.launchRepo.insertLaunchDirective.mockImplementation(
    async (_op: string, input: Record<string, unknown>) => row(input)
  );
}

/** The `beforeEach` every launch suite shares: a visible channel the caller is a member of, the
 *  operator online, no stored retry, no foreign target, and inserts answering `row()`. */
export function wireLaunchDefaults(): void {
  vi.clearAllMocks();
  mocks.loadVisibleChannel.mockResolvedValue({ channel: CHANNEL_ROW, membership: MEMBERSHIP });
  online();
  mocks.agentOwner.agentIsAnotherMembers.mockResolvedValue(false);
  mocks.launchRepo.findLaunchDirectiveByClientMsgId.mockResolvedValue(null);
  mocks.launchRepo.insertLaunchDirective.mockResolvedValue(row());
}
