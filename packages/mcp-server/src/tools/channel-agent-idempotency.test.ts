/**
 * **`client_msg_id` ON `manage action="launch"` AND `manage action="direct"`** —
 * the wire half of
 * G10 (2026-09-02, MCP/architecture v2 slice A10).
 *
 * ⚠ **WHAT WAS PROMISED AND BY WHAT.** The doctrine tells a caller that a
 * timed-out request is still pending and must not be re-issued, because a second
 * launch starts a SECOND agent on the same work and a second direction says the
 * same thing to a live agent twice. Until this wave that was the entire
 * mechanism. These cases assert the three things that replace it on this side of
 * the wire:
 *
 *  1. **THE KEY REACHES THE SERVER** on both ops, out of the SHARED
 *     `client_msg_id` param the tool already publishes for `send` and
 *     `send thread="new"` — not a per-op spelling, which would be a second
 *     idempotency vocabulary on one tool.
 *  2. **A CONVERGED RETRY SAYS SO**, as `retry=existing`, on every terminal
 *     shape. A converged retry and a fresh request are otherwise the same line,
 *     and a caller that cannot tell them apart is back to guessing exactly what
 *     the key removed.
 *  3. **A CALLER THAT SENDS NO KEY SEES NO NEW FIELD.** The fact is added by
 *     spread, so nothing grows a `retry=-` it never had — which is also what
 *     keeps `tool-budget.test.ts`'s measured results honest.
 *
 * ⚠ AND `existing` WINS ANY `retry` VERDICT ALREADY PRINTED. On a pending row
 * the line used to end `retry=no`; "this call filed nothing" is the stronger and
 * more actionable statement, because it says the id printed beside it is the
 * FIRST request's rather than a second agent's.
 *
 * ⚠ `channel-` filename prefix, like every other file in this directory that the
 * parity split-scan and the removed-vocabulary source scan walk.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { registerChannelTool } from "./channel";
import { callTool, stub } from "./narration-fixtures";

const CHANNEL = {
  id: "ch-1",
  workspaceId: "ws-1",
  slug: "general",
  name: "General",
  topic: "",
  visibility: "private" as const,
  createdBy: "u1",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const KEY = "orchestrator-run-7:launch-1";

function directive(over: Partial<LaunchDirective> = {}): LaunchDirective {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    channelId: "ch-1",
    threadId: null,
    goal: "ship the parser",
    model: null,
    status: "pending",
    templateId: null,
    templateName: null,
    refusalReason: null,
    agentId: null,
    claimedAt: null,
    decidedAt: null,
    expiresAt: "2026-09-02T12:02:00.000Z",
    createdAt: "2026-09-02T12:00:00.000Z",
    ...over,
  };
}

const DIRECTION = {
  id: "d-1",
  operatorUserId: "u1",
  channelId: "ch-1",
  threadId: null,
  agentId: "k3wpf7c5",
  body: "check the deploy",
  status: "pending" as const,
  refusalReason: null,
  reply: null,
  claimedAt: null,
  decidedAt: null,
  expiresAt: "2026-09-02T00:10:00Z",
  createdAt: "2026-09-02T00:00:00Z",
};

const agentStub = (over: Record<string, unknown> = {}) =>
  stub({
    listChannels: vi.fn(async () => [CHANNEL]),
    getChannel: vi.fn(async () => CHANNEL),
    createLaunchDirective: vi.fn(async () => ({ offline: false, directive: directive() })),
    getLaunchDirective: vi.fn(async () => directive()),
    createAgentDirection: vi.fn(async () => ({ offline: false, direction: DIRECTION })),
    getAgentDirection: vi.fn(async () => DIRECTION),
    listAgentDirections: vi.fn(async () => []),
    ...over,
  });

const run = (client: DoplClient, args: Record<string, unknown>) =>
  callTool(registerChannelTool, client, "dopl_channel", args);

const LAUNCH = {
  op: "manage",
  action: "launch",
  channel: "general",
  body: "ship it",
  wait_ms: 0,
};
const DIRECT = {
  op: "manage",
  action: "direct",
  channel: "general",
  to: "k3wpf7c5",
  body: "check the deploy",
  wait_ms: 0,
};

describe("the key reaches the server, out of the tool's SHARED client_msg_id param", () => {
  it('op="manage" action="launch" carries it into the create body', async () => {
    const create = vi.fn(async () => ({ offline: false, directive: directive() }));
    await run(agentStub({ createLaunchDirective: create }), { ...LAUNCH, client_msg_id: KEY });
    expect(create.mock.calls[0][0]).toMatchObject({ clientMsgId: KEY });
  });

  it('op="manage" action="direct" carries it into the create body', async () => {
    const create = vi.fn(async () => ({ offline: false, direction: DIRECTION }));
    await run(agentStub({ createAgentDirection: create }), { ...DIRECT, client_msg_id: KEY });
    expect(create.mock.calls[0][0]).toMatchObject({ clientMsgId: KEY });
  });

  it("omitting it sends `undefined`, never an invented key", async () => {
    // ⚠ A KEY THIS PROCESS MINTED WOULD BE THE WORST OF BOTH: it dedupes nothing
    // across calls (a fresh one per invocation) while making every row carry a
    // uniqueness constraint nobody asked for.
    const create = vi.fn(async () => ({ offline: false, directive: directive() }));
    await run(agentStub({ createLaunchDirective: create }), LAUNCH);
    expect(create.mock.calls[0][0]).toMatchObject({ clientMsgId: undefined });
  });
});

describe("a converged retry says so — `retry=existing`, on every terminal shape", () => {
  const converged = (over: Partial<LaunchDirective>) =>
    agentStub({
      createLaunchDirective: vi.fn(async () => ({
        offline: false,
        directive: directive(over),
        existing: true,
      })),
    });

  it("LAUNCHED — the agent handle is the FIRST request's, not a second one's", async () => {
    const out = await run(converged({ status: "launched", agentId: "abcd1234" }), {
      ...LAUNCH,
      client_msg_id: KEY,
    });
    expect(out).toContain("launched");
    expect(out).toContain("agent=@agent-abcd1234");
    expect(out).toContain("retry=existing");
  });

  it("PENDING — `existing` WINS the `retry=no` this line used to end on", async () => {
    const out = await run(converged({ status: "pending" }), { ...LAUNCH, client_msg_id: KEY });
    expect(out).toContain("pending");
    expect(out).toContain("retry=existing");
    expect(out).not.toContain("retry=no");
  });

  it("REFUSED — over the refusal's own retry verdict, for the same reason", async () => {
    const out = await run(converged({ status: "refused", refusalReason: "busy" }), {
      ...LAUNCH,
      client_msg_id: KEY,
    });
    expect(out).toContain("reason=busy");
    expect(out).toContain("retry=existing");
    expect(out).not.toContain("retry=once");
  });

  it("EXPIRED — a lapsed row is still THAT row, and asking again would file a new one", async () => {
    const out = await run(converged({ status: "expired" }), { ...LAUNCH, client_msg_id: KEY });
    expect(out).toContain("expired");
    expect(out).toContain("retry=existing");
  });

  it('op="manage" action="direct" — DELIVERED, and the reply the first call never saw comes with it', async () => {
    const out = await run(
      agentStub({
        createAgentDirection: vi.fn(async () => ({
          offline: false,
          direction: { ...DIRECTION, status: "delivered" as const, reply: "3 files changed" },
          existing: true,
        })),
      }),
      { ...DIRECT, client_msg_id: KEY },
    );
    expect(out).toContain("delivered");
    expect(out).toContain("retry=existing");
    expect(out).toContain("3 files changed");
  });

  it('op="manage" action="direct" — PENDING carries it too, over that line\'s own `retry=no`', async () => {
    const out = await run(
      agentStub({
        createAgentDirection: vi.fn(async () => ({
          offline: false,
          direction: DIRECTION,
          existing: true,
        })),
      }),
      { ...DIRECT, client_msg_id: KEY },
    );
    expect(out).toContain("retry=existing");
    expect(out).not.toContain("retry=no");
  });
});

describe("a caller that sent no key sees a byte-identical result", () => {
  it('op="manage" action="launch" adds no field — not even a dash', async () => {
    const out = await run(
      agentStub({
        createLaunchDirective: vi.fn(async () => ({
          offline: false,
          directive: directive({ status: "launched", agentId: "abcd1234" }),
        })),
      }),
      LAUNCH,
    );
    expect(out).not.toContain("retry=");
  });

  it('op="manage" action="direct" keeps its own `retry=no` when nothing converged', async () => {
    const out = await run(agentStub(), DIRECT);
    expect(out).toContain("retry=no");
    expect(out).not.toContain("retry=existing");
  });

  it("an OLDER SERVER that sends no `existing` key reads as a fresh request", async () => {
    // ⚠ INVARIANTS §13 — this client is deployed against both. Absent is `false`,
    // which is right there: a server without the column stored no key, so every
    // call really was fresh, and claiming otherwise would be the one lie that
    // makes a caller stop retrying something that never landed.
    const out = await run(
      agentStub({
        createLaunchDirective: vi.fn(async () => ({
          offline: false,
          directive: directive({ status: "launched", agentId: "abcd1234" }),
        })),
      }),
      { ...LAUNCH, client_msg_id: KEY },
    );
    expect(out).not.toContain("retry=existing");
  });
});

/**
 * **`op="send"` — A CONVERGED RETRY OPENS BY SAYING NOTHING WAS WRITTEN**
 * (2026-09-04, follow-up 4 to the self-wake investigation).
 *
 * ⚠ **THE SEND LANE HAD NO SUCH NOTICE AT ALL.** `service-writes.ts`'s
 * idempotency short-circuit returns the STORED row and writes nothing, with an
 * ack byte-identical to a first post — which is why the agent's own transcript
 * in the Mobile Command Center incident showed the 3:48 PM message posted twice
 * over ONE row (seq 963). The launch and direct lanes above have carried
 * `retry=existing` since A10; this is the same fact on the op every agent calls
 * most.
 *
 * ⚠ **IT IS THE HEAD, NOT A FIELD, AND THAT IS THE ONE DIFFERENCE FROM THOSE
 * LANES.** The word `posted` is itself the wrong claim on a replay, and a caller
 * that reads no further than the first word must not take one for the other.
 */
describe('op="send" — a replayed post says so in its first words', () => {
  const posted = (over: Record<string, unknown> = {}) =>
    ({
      listChannels: vi.fn(async () => [CHANNEL]),
      listChannelMembers: vi.fn(async () => []),
      postChannelMessage: vi.fn(async () => ({
        id: "m1",
        seq: 963,
        kind: "message",
        metadata: {},
        authorUserId: "u1",
        ...over,
      })),
    }) as unknown as DoplClient;

  const send = { op: "send", channel: "general", body: "the answer" };

  it("names the seq the FIRST call wrote, and that it was not re-sent", async () => {
    const text = await run(posted({ replayed: true }), { ...send, client_msg_id: KEY });
    expect(text).toContain("already posted as #963 (idempotent replay — not re-sent)");
    expect(text.startsWith("posted ")).toBe(false);
  });

  it("a FIRST post is untouched — no caller grows a field it never had", async () => {
    const text = await run(posted(), { ...send, client_msg_id: KEY });
    expect(text.startsWith("posted ")).toBe(true);
    expect(text).not.toContain("idempotent replay");
  });

  it("an OLDER SERVER that sends no `replayed` key reads as a fresh post", async () => {
    // ⚠ ABSENT IS "not reported", never "it was a replay" — the same rule the
    // launch lane's own older-server case pins.
    const text = await run(posted({ replayed: undefined }), send);
    expect(text).not.toContain("idempotent replay");
  });
});
