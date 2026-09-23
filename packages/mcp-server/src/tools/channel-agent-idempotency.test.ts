// `client_msg_id` on `manage action="launch"` / `"direct"`: the shared param reaches the server, a
// converged retry says `retry=existing` (winning any other verdict), and a keyless call gains no field.

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, LaunchDirective } from "@dopl/client";
import { registerChannelTool } from "./channel";
import { CHANNEL_ROW as CHANNEL, LAUNCH, directive } from "./launch-fixtures";
import { callTool, stub } from "./narration-fixtures";

const KEY = "orchestrator-run-7:launch-1";

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
    // A key minted here would dedupe nothing across calls.
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
    // A server without the column stored no key, so absent `existing` reads as fresh (INVARIANTS §13).
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

// On `send` a replay changes the HEAD word: `posted` is itself the wrong claim when nothing was written.
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

  // `to` is required: a send that addresses nobody is refused before the wire.
  const send = { op: "send", channel: "general", body: "the answer", to: "u-peer" };

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
    // Absent is "not reported", never "it was a replay".
    const text = await run(posted({ replayed: undefined }), send);
    expect(text).not.toContain("idempotent replay");
  });
});
