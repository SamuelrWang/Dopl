/** Every write runs on the RLS-bypassing admin client, so the operator scope is an argument, not a
 *  policy: `operator_user_id` is always `ctx.userId`, and another operator's directive answers 404. */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = await vi.hoisted(() => import("./service-launch-fixtures"));
vi.mock("./repository-launch", () => fx.mocks.launchRepo);
vi.mock("./repository-collab", () => fx.mocks.collab);
vi.mock("./repository-tasks", () => fx.mocks.tasks);
vi.mock("./repository-session-colors", () => fx.mocks.sessionColors);
vi.mock("./service-shared", (importOriginal) => fx.serviceSharedMock(importOriginal));
vi.mock("@/features/agent-identities/server/service", () => fx.mocks.identities);

import * as launchRepo from "./repository-launch";
import * as collab from "./repository-collab";
import * as repoTasks from "./repository-tasks";
import { loadVisibleChannel } from "./service-shared";
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
import { CHANNEL_ROW, DIR, ME, WS, ctx, row, wireLaunchDefaults } from "./service-launch-fixtures";

const OTHER = "99999999-9999-9999-9999-999999999999";
const TASK = "44444444-4444-4444-4444-444444444444";

beforeEach(wireLaunchDefaults);

describe("create — the three gates, in order", () => {
  it("stamps the CALLER as operator, and there is nowhere for a payload to say otherwise", async () => {
    // The input type has no operator field; the cast drives the shape the compiler refuses.
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
    // `loadVisibleChannel` admits a non-member to a public channel; a launch is not a read.
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
    // A dropped thread id would start the agent in the wrong place and report success.
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);
    await expect(
      createLaunchDirective(ctx, { channel: "general", threadId: TASK })
    ).rejects.toBeInstanceOf(LaunchDirectiveNotFoundError);
    expect(launchRepo.insertLaunchDirective).not.toHaveBeenCalled();
  });

  it("carries a valid thread id through", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue({ id: TASK } as never);
    await createLaunchDirective(ctx, { channel: "general", threadId: TASK });
    expect(vi.mocked(launchRepo.insertLaunchDirective).mock.calls[0][1].task_id).toBe(TASK);
  });

  it("sets expires_at from LAUNCH_DIRECTIVE_TTL_MS", async () => {
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
    // Fail-safe: a row with no stamp is not evidence the machine is up.
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
    // The pre-read ruled out missing/decided/expired, so a null from the UPDATE can only be the race.
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
    // The repository's operator predicate makes it indistinguishable from absent, so ids cannot be probed.
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
    // The requester may already be addressing `@abcd1234`; a later `refused` would make that a lie.
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
    // Expiry gates a new claim, not the report of an agent that already started.
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
