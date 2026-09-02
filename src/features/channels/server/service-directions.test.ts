/**
 * THE PRIVATE DIRECT LANE'S SERVER FENCES — cited by name from
 * `schema-direction.ts` and `app/api/channels/agent-directions/route.ts` as the
 * thing that asserts them, so it has to exist and has to assert them.
 *
 * ⚠ **THE HEADLINE IS AN ABSENCE, AND IT IS THE WHOLE AUTHORIZATION STORY.** The
 * only machine an agent may direct is its own operator's, and the way that stays
 * true is that no schema and no service signature on this path accepts an
 * operator id. `operator_user_id` is `ctx.userId`, stamped LAST so no payload key
 * can shadow it.
 *
 * The other properties that fail quietly:
 *  - **MEMBERSHIP, NOT READABILITY.** A public channel the caller never joined is
 *    a 404 — a direction reaches an agent working that channel.
 *  - **NOTHING IS FILED FOR A MACHINE THAT IS NOT REPORTING IN**, so an
 *    orchestrator is told "nothing was filed" rather than watching a row expire.
 *  - **A MALFORMED ID IS A 404, NOT A 500.** It goes into a `uuid =` filter, so
 *    without the shape check it is a 22P02 plus a `system_events` row per call —
 *    and malformed must collapse to the SAME answer foreign and absent get, or
 *    ids become probeable.
 *  - **EXPIRY IS LAZY AND LIVES AT THE READ**, so the reported status may differ
 *    from the stored column, by design.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-directions");
vi.mock("./repository-collab");
vi.mock("./repository-tasks");
vi.mock("./service-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service-shared")>();
  return { ...actual, loadVisibleChannel: vi.fn() };
});

import * as directionRepo from "./repository-directions";
import * as collab from "./repository-collab";
import * as repoTasks from "./repository-tasks";
import { loadVisibleChannel } from "./service-shared";
import {
  claimAgentDirection,
  createAgentDirection,
  getAgentDirection,
  listRecentAgentDirections,
} from "./service-directions";
import { DirectionCreateSchema, DirectionDecideSchema } from "../schema-direction";
import type { ChannelContext } from "./service-shared";

const WS = "11111111-2222-3333-4444-555555555555";
const ME = "22222222-3333-4444-5555-666666666666";
const CH = "33333333-4444-5555-6666-777777777777";
const DID = "44444444-5555-6666-7777-888888888888";
const AGENT = "k3wpf7c5";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: ME,
  source: "agent",
  role: "member",
};

const channelRow = { id: CH, workspace_id: WS, name: "With Dana" };

function row(over: Record<string, unknown> = {}) {
  return {
    id: DID,
    workspace_id: WS,
    channel_id: CH,
    task_id: null,
    operator_user_id: ME,
    agent_id: AGENT,
    body: "check the deploy",
    status: "pending",
    refusal_reason: null,
    reply: null,
    claimed_at: null,
    decided_at: null,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    created_at: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadVisibleChannel).mockResolvedValue({
    channel: channelRow,
    membership: { role: "member" },
  } as never);
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
    new Map([[ME, { lastSeenAt: new Date().toISOString() }]]) as never
  );
  vi.mocked(directionRepo.insertAgentDirection).mockImplementation(
    async (_op, input) => row({ ...input }) as never
  );
  vi.mocked(directionRepo.findAgentDirection).mockResolvedValue(row() as never);
  vi.mocked(directionRepo.listRecentAgentDirections).mockResolvedValue([] as never);
  vi.mocked(directionRepo.claimAgentDirection).mockResolvedValue(
    row({ status: "claimed" }) as never
  );
});

describe("🔒 the operator is ctx.userId and can never be a parameter", () => {
  it("no schema on this path accepts an operator field", () => {
    // ⚠ THE ABSENCE IS THE FENCE. Asserted rather than left to review, because a
    // field added here would be silently honoured by everything downstream.
    const create = Object.keys(DirectionCreateSchema.shape);
    // ⚠ `clientMsgId` JOINED THE SET ON 2026-09-02 (A10/G10) AND IS NOT AN
    // IDENTITY. It names WHICH GESTURE this row is, never whose machine hears it
    // — the uniqueness it buys is scoped BY `operator_user_id`, which is still a
    // separate argument no payload can reach. The census is a whitelist, so a
    // field is added to it deliberately or not at all.
    expect(create.sort()).toEqual([
      "agentId",
      "body",
      "channel",
      "clientMsgId",
      "threadId",
    ]);
    for (const key of ["operator", "operatorUserId", "userId", "operator_user_id"]) {
      expect(create, key).not.toContain(key);
      for (const option of DirectionDecideSchema.options) {
        expect(Object.keys(option.shape), key).not.toContain(key);
      }
    }
  });

  it("stamps ctx.userId, as a separate argument the payload cannot reach", async () => {
    await createAgentDirection(ctx, {
      channel: CH,
      agentId: AGENT,
      body: "hi",
    } as never);
    const [operatorArg, insert] = vi.mocked(directionRepo.insertAgentDirection).mock.calls[0];
    expect(operatorArg).toBe(ME);
    expect(Object.keys(insert)).not.toContain("operator_user_id");
  });

  it("passes ctx.userId as the fence on EVERY read and write", async () => {
    await getAgentDirection(ctx, DID);
    await claimAgentDirection(ctx, DID);
    await listRecentAgentDirections(ctx);
    for (const fn of [
      directionRepo.findAgentDirection,
      directionRepo.claimAgentDirection,
      directionRepo.listRecentAgentDirections,
    ]) {
      for (const call of vi.mocked(fn).mock.calls) {
        expect(call[0], fn.name).toBe(ME);
      }
    }
  });
});

describe("what a direction may be filed against", () => {
  it("REFUSES a channel the caller is not a MEMBER of, even a readable one", async () => {
    // ⚠ Readability is not enough: a direction reaches an agent working that
    // channel, so `loadVisibleChannel`'s public-channel admission is too wide.
    vi.mocked(loadVisibleChannel).mockResolvedValue({
      channel: channelRow,
      membership: null,
    } as never);
    await expect(
      createAgentDirection(ctx, { channel: CH, agentId: AGENT, body: "hi" } as never)
    ).rejects.toThrow(/Direction not found/);
    expect(directionRepo.insertAgentDirection).not.toHaveBeenCalled();
  });

  it("REFUSES a thread that is not in that channel", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null as never);
    await expect(
      createAgentDirection(ctx, {
        channel: CH,
        agentId: AGENT,
        body: "hi",
        threadId: DID,
      } as never)
    ).rejects.toThrow(/Direction not found/);
  });

  it("FILES NOTHING when the operator's machine is not reporting in", async () => {
    // ⚠ A row nobody will claim expires silently and tells the orchestrator
    // nothing it can act on. `offline: true` is a 200, not an error.
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map() as never);
    const out = await createAgentDirection(ctx, {
      channel: CH,
      agentId: AGENT,
      body: "hi",
    } as never);
    expect(out).toEqual({ offline: true, direction: null });
    expect(directionRepo.insertAgentDirection).not.toHaveBeenCalled();
  });

  it("treats a STALE heartbeat as offline", async () => {
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
      new Map([[ME, { lastSeenAt: new Date(Date.now() - 600_000).toISOString() }]]) as never
    );
    const out = await createAgentDirection(ctx, {
      channel: CH,
      agentId: AGENT,
      body: "hi",
    } as never);
    expect(out.offline).toBe(true);
  });
});

describe("a malformed id is a 404, never a 500", () => {
  it("refuses a non-UUID before it can reach a `uuid =` filter", async () => {
    // ⚠ Without this it is a 22P02 cast failure — a 500 plus a `system_events`
    // row on EVERY such call (`requireConsentId`'s rationale).
    for (const bad of ["nope", "", "12345"]) {
      await expect(getAgentDirection(ctx, bad)).rejects.toThrow(/Direction not found/);
      await expect(claimAgentDirection(ctx, bad)).rejects.toThrow(/Direction not found/);
    }
    expect(directionRepo.findAgentDirection).not.toHaveBeenCalled();
  });

  it("collapses malformed onto the SAME answer foreign and absent get", async () => {
    // ⚠ Three causes, one error, so ids cannot be probed.
    vi.mocked(directionRepo.findAgentDirection).mockResolvedValue(null as never);
    await expect(getAgentDirection(ctx, DID)).rejects.toThrow(/Direction not found/);
  });

  it("DROPS a junk channel filter rather than passing it to Postgres", async () => {
    await listRecentAgentDirections(ctx, { channelId: "not-a-uuid" });
    expect(
      vi.mocked(directionRepo.listRecentAgentDirections).mock.calls[0][2]
    ).toEqual({ channelId: undefined });
  });

  it("keeps a real channel filter", async () => {
    await listRecentAgentDirections(ctx, { channelId: CH });
    expect(
      vi.mocked(directionRepo.listRecentAgentDirections).mock.calls[0][2]?.channelId
    ).toBe(CH);
  });
});

describe("expiry is lazy and lives at the read", () => {
  it("REPORTS `expired` for a past-TTL row whose column still says pending", async () => {
    vi.mocked(directionRepo.findAgentDirection).mockResolvedValue(
      row({ expires_at: new Date(Date.now() - 1000).toISOString() }) as never
    );
    const out = await getAgentDirection(ctx, DID);
    expect(out.status).toBe("expired");
  });

  it("refuses to CLAIM an expired one, before the CAS runs", async () => {
    vi.mocked(directionRepo.findAgentDirection).mockResolvedValue(
      row({ expires_at: new Date(Date.now() - 1000).toISOString() }) as never
    );
    await expect(claimAgentDirection(ctx, DID)).rejects.toThrow(/not claimable \(expired\)/);
    expect(directionRepo.claimAgentDirection).not.toHaveBeenCalled();
  });

  it("a LOST CAS is `taken`, told apart from decided and absent", async () => {
    // ⚠ The pre-read exists so the desktop's log can say WHICH — the CAS alone
    // answers `null` for all three.
    vi.mocked(directionRepo.claimAgentDirection).mockResolvedValue(null as never);
    await expect(claimAgentDirection(ctx, DID)).rejects.toThrow(/not claimable \(taken\)/);
  });

  it("an already-decided row is `decided`, not `taken`", async () => {
    vi.mocked(directionRepo.findAgentDirection).mockResolvedValue(
      row({ status: "delivered" }) as never
    );
    await expect(claimAgentDirection(ctx, DID)).rejects.toThrow(/not claimable \(decided\)/);
  });
});

describe("the recent listing keeps what the backstop drops", () => {
  it("KEEPS terminal rows — the reply is the whole reason the op exists", async () => {
    vi.mocked(directionRepo.listRecentAgentDirections).mockResolvedValue([
      row({ status: "delivered", reply: "all green" }),
      row({ id: "x", status: "refused", refusal_reason: "no-session" }),
    ] as never);
    const out = await listRecentAgentDirections(ctx);
    expect(out.map((d) => d.status)).toEqual(["delivered", "refused"]);
    expect(out[0].reply).toBe("all green");
  });
});
