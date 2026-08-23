/**
 * LAUNCH-OVER-MCP — the directive lifecycle: create → claim (CAS, races
 * included) → decide, plus lazy expiry and operator scoping.
 *
 * ⚠ **THE PROPERTY THIS SUITE EXISTS FOR IS THE OPERATOR SCOPE.** A directive
 * asks a machine to start a process, so "whose machine" is the entire
 * authorization story — and because every write runs on the RLS-bypassing admin
 * client, the fence is an ARGUMENT rather than a policy. Two things are driven
 * adversarially: that `operator_user_id` is always `ctx.userId` and never
 * anything a caller supplied, and that ANOTHER operator's directive is
 * invisible and unclaimable (and invisible in the not-found sense, so ids cannot
 * be probed).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-launch", () => ({
  insertLaunchDirective: vi.fn(),
  findLaunchDirective: vi.fn(),
  claimLaunchDirective: vi.fn(),
  decideLaunchDirective: vi.fn(),
}));
vi.mock("./repository-collab", () => ({ presenceForWorkspace: vi.fn() }));
vi.mock("./repository-tasks", () => ({ findTaskByChannelAndId: vi.fn() }));
vi.mock("./service-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service-shared")>();
  return { ...actual, loadVisibleChannel: vi.fn() };
});
// ⚠ MOCKED THOUGH THIS FILE NAMES NO TEMPLATE: `service-launch.ts` imports the
// agent-templates barrel at module scope, and that module is `server-only` with a
// live Supabase admin client under it. The TEMPLATE cases are next door, in
// `service-launch-template.test.ts`.
vi.mock("@/features/agent-templates/server/service", () => ({
  resolveTemplateRef: vi.fn(),
}));

import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import * as repoTasks from "./repository-tasks";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
import {
  LaunchDirectiveNotClaimableError,
  LaunchDirectiveNotFoundError,
} from "./errors";
import {
  claimLaunchDirective,
  createLaunchDirective,
  decideLaunchDirective,
  getLaunchDirective,
} from "./service-launch";
import { LAUNCH_DIRECTIVE_TTL_MS } from "../constants";

const WS = "22222222-2222-2222-2222-222222222222";
const ME = "33333333-3333-3333-3333-333333333333";
const OTHER = "99999999-9999-9999-9999-999999999999";
const CHAN = "11111111-1111-1111-1111-111111111111";
const TASK = "44444444-4444-4444-4444-444444444444";
const DIR = "55555555-5555-5555-5555-555555555555";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  source: "agent",
  role: "member",
};

const CHANNEL_ROW = { id: CHAN, slug: "general", name: "General", visibility: "private" };
const MEMBERSHIP = { channel_id: CHAN, user_id: ME, role: "member" };

function row(over: Record<string, unknown> = {}) {
  return {
    id: DIR,
    workspace_id: WS,
    channel_id: CHAN,
    task_id: null,
    operator_user_id: ME,
    goal: "ship the parser",
    model: null,
    template_id: null,
    template_name: null,
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

function online() {
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
    new Map([[ME, { online: true, lastSeenAt: new Date().toISOString() }]]) as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadVisibleChannel).mockResolvedValue({
    channel: CHANNEL_ROW,
    membership: MEMBERSHIP,
  } as never);
  vi.mocked(launchRepo.insertLaunchDirective).mockResolvedValue(row());
});

describe("create — the three gates, in order", () => {
  it("stamps the CALLER as operator, and there is nowhere for a payload to say otherwise", async () => {
    online();
    // ⚠ A caller-supplied operator has nowhere to go — the input TYPE has no such
    // field, which is the real enforcement. The cast is how a test drives the
    // shape a compiler already refuses, so the runtime behaviour is pinned too.
    await createLaunchDirective(ctx, {
      channel: "general",
      operatorUserId: OTHER,
    } as unknown as Parameters<typeof createLaunchDirective>[1]);
    const [operatorArg, insert] = vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0];
    expect(operatorArg).toBe(ME);
    expect(insert).not.toHaveProperty("operator_user_id");
    expect(JSON.stringify(insert)).not.toContain(OTHER);
  });

  it("REFUSES a channel the caller can READ but is not a MEMBER of", async () => {
    // ⚠ `loadVisibleChannel` admits a non-member to a PUBLIC channel (§5). A
    // launch is not a read: starting an agent in a room you never joined is not
    // something the room agreed to.
    online();
    vi.mocked(loadVisibleChannel).mockResolvedValue({
      channel: { ...CHANNEL_ROW, visibility: "public" },
      membership: null,
    } as never);
    await expect(
      createLaunchDirective(ctx, { channel: "general" })
    ).rejects.toBeInstanceOf(LaunchDirectiveNotFoundError);
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("REFUSES a thread that is not in that channel — never silently drops it", async () => {
    // ⚠ A dropped thread id starts the agent in the wrong place and reports
    // success, which is worse than a refusal.
    online();
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);
    await expect(
      createLaunchDirective(ctx, { channel: "general", threadId: TASK })
    ).rejects.toBeInstanceOf(LaunchDirectiveNotFoundError);
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("carries a valid thread id through", async () => {
    online();
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue({ id: TASK } as never);
    await createLaunchDirective(ctx, { channel: "general", threadId: TASK });
    expect(vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1].task_id).toBe(TASK);
  });

  it("sets expires_at from LAUNCH_DIRECTIVE_TTL_MS", async () => {
    online();
    const before = Date.now();
    await createLaunchDirective(ctx, { channel: "general" });
    const expires = Date.parse(
      vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1].expires_at
    );
    expect(expires).toBeGreaterThanOrEqual(before + LAUNCH_DIRECTIVE_TTL_MS - 50);
    expect(expires).toBeLessThanOrEqual(Date.now() + LAUNCH_DIRECTIVE_TTL_MS + 50);
  });
});

describe("presence — offline files NO ROW", () => {
  const cases: Array<[string, Map<string, unknown>]> = [
    ["no presence row at all", new Map()],
    [
      "a stamp older than the online window",
      new Map([[ME, { online: false, lastSeenAt: new Date(Date.now() - 600_000).toISOString() }]]),
    ],
    // ⚠ FAIL-SAFE DIRECTION: a projection that cannot say when it last heard
    // from a machine is not evidence the machine is up.
    ["a null stamp", new Map([[ME, { online: true, lastSeenAt: null }]])],
    ["an unparseable stamp", new Map([[ME, { online: true, lastSeenAt: "yesterday" }]])],
  ];
  for (const [label, presence] of cases) {
    it(`${label} → offline, and nothing is inserted`, async () => {
      vi.mocked(collab.presenceForWorkspace).mockResolvedValue(presence as never);
      const out = await createLaunchDirective(ctx, { channel: "general" });
      expect(out).toEqual({ offline: true, directive: null });
      expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
    });
  }

  it("ANOTHER member being online is not this operator's machine being online", async () => {
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
      new Map([[OTHER, { online: true, lastSeenAt: new Date().toISOString() }]]) as never
    );
    expect((await createLaunchDirective(ctx, { channel: "general" })).offline).toBe(true);
  });
});

describe("lazy expiry — reported, never swept", () => {
  const past = new Date(Date.now() - 1000).toISOString();

  it("a PENDING row past its TTL reports as expired", async () => {
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(
      row({ status: "pending", expires_at: past })
    );
    expect((await getLaunchDirective(ctx, DIR)).status).toBe("expired");
  });

  it("a CLAIMED row past its TTL reports as expired too", async () => {
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(
      row({ status: "claimed", expires_at: past })
    );
    expect((await getLaunchDirective(ctx, DIR)).status).toBe("expired");
  });

  it("a TERMINAL row past its TTL keeps its outcome — expiry never rewrites history", async () => {
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(
      row({ status: "launched", agent_id: "abcd1234", expires_at: past })
    );
    const d = await getLaunchDirective(ctx, DIR);
    expect(d.status).toBe("launched");
    expect(d.agentId).toBe("abcd1234");
  });

  it("NOTHING IS WRITTEN by a read — there is no sweep", async () => {
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(
      row({ expires_at: past })
    );
    await getLaunchDirective(ctx, DIR);
    expect(launchRepo.claimLaunchDirective).not.toHaveBeenCalled();
    expect(launchRepo.decideLaunchDirective).not.toHaveBeenCalled();
  });
});

describe("claim — the CAS, and every way it can lose", () => {
  it("moves pending → claimed and scopes the UPDATE to this operator", async () => {
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(row());
    vi.mocked(launchRepo.claimLaunchDirective).mockResolvedValue(
      row({ status: "claimed", claimed_at: new Date().toISOString() })
    );
    const d = await claimLaunchDirective(ctx, DIR);
    expect(d.status).toBe("claimed");
    expect(vi.mocked(launchRepo.claimLaunchDirective).mock.calls[0][0]).toBe(ME);
    expect(vi.mocked(launchRepo.claimLaunchDirective).mock.calls[0][1]).toBe(WS);
  });

  it("RACE: the CAS returning null means a sibling machine won — 'taken', not an error about the row", async () => {
    // ⚠ The pre-read ruled out missing / decided / expired, so a null from the
    // UPDATE can only be the race. Reporting it as anything else would send the
    // losing machine looking for a fault that does not exist.
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(row());
    vi.mocked(launchRepo.claimLaunchDirective).mockResolvedValue(null);
    await expect(claimLaunchDirective(ctx, DIR)).rejects.toMatchObject({
      reason: "taken",
    });
  });

  it("an already-DECIDED directive is not claimable, and the CAS is never issued", async () => {
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(
      row({ status: "launched", agent_id: "abcd1234" })
    );
    await expect(claimLaunchDirective(ctx, DIR)).rejects.toMatchObject({
      reason: "decided",
    });
    expect(launchRepo.claimLaunchDirective).not.toHaveBeenCalled();
  });

  it("an EXPIRED directive is not claimable, and the CAS is never issued", async () => {
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(
      row({ expires_at: new Date(Date.now() - 1).toISOString() })
    );
    await expect(claimLaunchDirective(ctx, DIR)).rejects.toBeInstanceOf(
      LaunchDirectiveNotClaimableError
    );
    expect(launchRepo.claimLaunchDirective).not.toHaveBeenCalled();
  });

  it("ADVERSARIAL: ANOTHER operator's directive is INVISIBLE and unclaimable", async () => {
    // The repository's own `operator_user_id` predicate makes it indistinguishable
    // from absent — a 404, never a 403, so ids cannot be probed.
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(null);
    await expect(claimLaunchDirective(ctx, DIR)).rejects.toBeInstanceOf(
      LaunchDirectiveNotFoundError
    );
    await expect(getLaunchDirective(ctx, DIR)).rejects.toBeInstanceOf(
      LaunchDirectiveNotFoundError
    );
    expect(launchRepo.claimLaunchDirective).not.toHaveBeenCalled();
  });
});

describe("decide — terminal, and final", () => {
  it("launched carries the agent id and no reason", async () => {
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(
      row({ status: "launched", agent_id: "abcd1234", decided_at: new Date().toISOString() })
    );
    const d = await decideLaunchDirective(ctx, DIR, {
      status: "launched",
      agentId: "abcd1234",
    });
    expect(d.agentId).toBe("abcd1234");
    const written = vi.mocked(launchRepo.decideLaunchDirective).mock.calls[0][3];
    expect(written.refusal_reason).toBeNull();
  });

  it("refused carries the reason and no agent id", async () => {
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(
      row({ status: "refused", refusal_reason: "cap", decided_at: new Date().toISOString() })
    );
    const d = await decideLaunchDirective(ctx, DIR, {
      status: "refused",
      refusalReason: "cap",
    });
    expect(d.refusalReason).toBe("cap");
    expect(vi.mocked(launchRepo.decideLaunchDirective).mock.calls[0][3].agent_id).toBeNull();
  });

  it("scopes the UPDATE to this operator", async () => {
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(
      row({ status: "refused", refusal_reason: "busy", decided_at: new Date().toISOString() })
    );
    await decideLaunchDirective(ctx, DIR, { status: "refused", refusalReason: "busy" });
    expect(vi.mocked(launchRepo.decideLaunchDirective).mock.calls[0][0]).toBe(ME);
  });

  it("a SECOND decide is refused rather than overwriting the first", async () => {
    // ⚠ The requester may already have read `launched` and started addressing
    // `@abcd1234`; flipping it to `refused` afterwards would make that a lie.
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(null);
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(
      row({ status: "launched", agent_id: "abcd1234" })
    );
    await expect(
      decideLaunchDirective(ctx, DIR, { status: "refused", refusalReason: "cap" })
    ).rejects.toMatchObject({ reason: "decided" });
  });

  it("ANOTHER operator's directive cannot be decided — and answers not-found, not forbidden", async () => {
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(null);
    vi.mocked(launchRepo.findLaunchDirective).mockResolvedValue(null);
    await expect(
      decideLaunchDirective(ctx, DIR, { status: "launched", agentId: "abcd1234" })
    ).rejects.toBeInstanceOf(LaunchDirectiveNotFoundError);
  });

  it("an EXPIRED directive may still be DECIDED — a started agent must be reportable", async () => {
    // ⚠ Refusing the write would leave a running agent no directive accounts
    // for. Expiry governs whether a NEW claim may begin, not whether a finished
    // one may be reported.
    vi.mocked(launchRepo.decideLaunchDirective).mockResolvedValue(
      row({
        status: "launched",
        agent_id: "abcd1234",
        decided_at: new Date().toISOString(),
        expires_at: new Date(Date.now() - 1).toISOString(),
      })
    );
    const d = await decideLaunchDirective(ctx, DIR, {
      status: "launched",
      agentId: "abcd1234",
    });
    expect(d.status).toBe("launched");
  });
});
