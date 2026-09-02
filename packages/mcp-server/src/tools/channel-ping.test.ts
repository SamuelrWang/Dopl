/**
 * `dopl_channel(op="ping")` / `op="pings"` — THE "NEEDS YOU" SIGNAL.
 *
 * ⚠ **THE HEADLINE ASSERTION IS AN ABSENCE.** There is no argument on this
 * surface that names an operator, and there never may be: the two self-scoped
 * recipient forms resolve to the authenticated caller's own operator server-side,
 * and that absence IS the loop brake. You cannot ping another member's agent
 * because there is nothing to say it with.
 *
 * The other properties that fail quietly:
 *  - **EXACTLY ONE RECIPIENT, AND THE REFUSAL NAMES THE COUNT IT SAW.** Zero is a
 *    signal with nowhere to go; two would make the server pick, and a caller that
 *    sent two cannot otherwise tell which one would have won.
 *  - **THE RESULT MUST SAY A PING IS NOT A MESSAGE.** A tool result is read at
 *    the moment the model picks its next action, so it outvotes the description
 *    (INVARIANTS §10) — and the failure it prevents is an agent pinging again and
 *    again because it is waiting for a reply that can never come.
 *  - **THE TWO CURSOR SPACES MUST BE NAMED AS SEPARATE** in both results. Crossing
 *    them reads a plausible WRONG page rather than erroring, which is the failure
 *    mode nothing else can catch.
 *  - **THE BODY CAP IS REFUSED BEFORE ANY ROUND TRIP**, so "nothing was sent" is
 *    trivially true rather than confusable with a delivery failure.
 *  - **`agent_id` ACCEPTS THE HANDLE `read_sessions` PRINTS**, via the ONE shared
 *    stripper — a second copy drifts and sends `@agent-` at a column CHECK.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";

import { registerChannelTool } from "./channel";
import { callTool, stub } from "./narration-fixtures";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";

const CHANNEL = {
  id: "ch-1",
  workspaceId: "ws-1",
  slug: "build",
  name: "Build",
  topic: "",
  visibility: "private" as const,
  createdBy: "u1",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const PING = {
  id: "p-1",
  seq: 12,
  channelId: "ch-1",
  channelSlug: "build",
  threadId: null,
  senderUserId: "u1",
  senderAgentId: "k3wpf7c5",
  recipientKind: "desktop" as const,
  recipientUserId: "u1",
  recipientAgentId: null,
  kind: "done" as const,
  body: "migration written and tests are green",
  createdAt: "2026-09-01T10:00:00Z",
};

function pingStub(over: Record<string, unknown> = {}): DoplClient {
  return stub({
    listChannels: vi.fn(async () => [CHANNEL]),
    createPing: vi.fn(async () => PING),
    listPings: vi.fn(async () => [PING]),
    ...over,
  });
}

const run = (client: DoplClient, args: Record<string, unknown>) =>
  callTool(registerChannelTool, client, "dopl_channel", args);

const SEND = Object.freeze({
  op: "ping",
  channel: "build",
  ping_kind: "done",
  body: "migration written and tests are green",
});

describe("🔒 there is no argument for WHOSE machine, and none may appear", () => {
  it("declares no operator, sender or user field on the published shape", () => {
    // ⚠ Not "declared and ignored" — a param an MCP client can see is a param a
    // model will try, and a silently-dropped address is the invisible-delivery
    // failure the addressing contract exists to prevent.
    for (const key of [
      "operator",
      "operator_id",
      "user_id",
      "sender",
      "sender_agent_id",
      "recipient",
    ]) {
      expect(CHANNEL_INPUT_SHAPE, key).not.toHaveProperty(key);
    }
  });

  it("still declares no `to_agent`, which is what this lane could have re-introduced", () => {
    // ⚠ The banned named-agent param. This op needed "reach one of my own
    // agents" and took the EXISTING `agent_id` rather than resurrecting the
    // spelling the rollback removed.
    expect(CHANNEL_INPUT_SHAPE).not.toHaveProperty("to_agent");
    expect(CHANNEL_INPUT_SHAPE).toHaveProperty("agent_id");
  });

  it("passes ONLY the wire keys — an extra arg cannot smuggle an address", async () => {
    const client = pingStub();
    await run(client, {
      ...SEND,
      to_desktop: true,
      // Everything a caller might try to point this at someone else's machine.
      operator: "u2",
      user_id: "u2",
      recipient: "u2",
    });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(Object.keys(create.mock.calls[0][0]).sort()).toEqual([
      "body",
      "channel",
      "kind",
      "toDesktop",
    ]);
  });
});

describe("EXACTLY ONE RECIPIENT", () => {
  it("refuses zero and names all three spellings", async () => {
    const client = pingStub();
    const out = await run(client, SEND);
    expect(out).toMatch(/exactly one recipient and got none/);
    expect(out).toContain("to_desktop");
    expect(out).toContain("agent_id");
    expect(client.createPing).not.toHaveBeenCalled();
  });

  it("refuses two and NAMES THE COUNT IT SAW", async () => {
    const client = pingStub();
    const out = await run(client, { ...SEND, to_desktop: true, to: "u2" });
    expect(out).toMatch(/got 2\b/);
    expect(client.createPing).not.toHaveBeenCalled();
  });

  it("refuses three", async () => {
    const client = pingStub();
    const out = await run(client, {
      ...SEND,
      to_desktop: true,
      to: "u2",
      agent_id: "k3wpf7c5",
    });
    expect(out).toMatch(/got 3\b/);
  });
});

describe("the three recipient forms reach the wire", () => {
  it("to_desktop", async () => {
    const client = pingStub();
    await run(client, { ...SEND, to_desktop: true });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.calls[0][0]).toMatchObject({ toDesktop: true });
  });

  it("to=<member>", async () => {
    const client = pingStub();
    await run(client, { ...SEND, to: "dana@example.com" });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.calls[0][0]).toMatchObject({ to: "dana@example.com" });
  });

  it("agent_id, and it STRIPS the printed handle rather than refusing it", async () => {
    // ⚠ `read_sessions` prints `@agent-<id>`, so that is what a model copies.
    const client = pingStub();
    await run(client, { ...SEND, agent_id: "@agent-k3wpf7c5" });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.calls[0][0]).toMatchObject({ agentId: "k3wpf7c5" });
  });

  it("carries the thread through when one is named", async () => {
    const client = pingStub();
    await run(client, { ...SEND, to_desktop: true, thread: "t-1" });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.calls[0][0]).toMatchObject({ threadId: "t-1" });
  });
});

describe("the body cap is refused BEFORE any round trip", () => {
  it("names both numbers and points at op=\"post\" for the detail", async () => {
    const client = pingStub();
    const out = await run(client, {
      ...SEND,
      to_desktop: true,
      body: "x".repeat(601),
    });
    expect(out).toContain("600");
    expect(out).toContain("601");
    expect(out).toMatch(/op="post"/);
    // ⚠ Nothing resolved and nothing sent, so "nothing was sent" is trivially
    // true rather than confusable with a delivery failure.
    expect(client.listChannels).not.toHaveBeenCalled();
    expect(client.createPing).not.toHaveBeenCalled();
  });
});

describe("the result teaches what a ping IS NOT", () => {
  it("says it is in no transcript and that nothing replies", async () => {
    const out = await run(pingStub(), { ...SEND, to_desktop: true });
    expect(out).toMatch(/not a message/i);
    expect(out).toMatch(/await/);
  });

  it("warns that the ping seq is not a message seq", async () => {
    const out = await run(pingStub(), { ...SEND, to_desktop: true });
    expect(out).toMatch(/not a message seq/i);
  });

  it("says what happens NEXT, per recipient form", async () => {
    const desktop = await run(pingStub(), { ...SEND, to_desktop: true });
    expect(desktop).toMatch(/external session/i);

    const agentPing = { ...PING, recipientKind: "agent" as const, recipientAgentId: "k3wpf7c5" };
    const woke = await run(
      pingStub({ createPing: vi.fn(async () => agentPing) }),
      { ...SEND, agent_id: "k3wpf7c5" },
    );
    // ⚠ It must not PROMISE a wake — the machine decides, and a dead session is
    // an honest outcome rather than a failure.
    expect(woke).toMatch(/if that agent is live/i);

    const memberPing = { ...PING, recipientKind: "member" as const, recipientUserId: "u2" };
    const filed = await run(
      pingStub({ createPing: vi.fn(async () => memberPing) }),
      { ...SEND, to: "u2" },
    );
    expect(filed).toMatch(/did NOT trigger their machine/);
  });
});

describe('op="pings" — the inbox', () => {
  it("puts the untrusted framing BEFORE any body", async () => {
    const out = await run(pingStub(), { op: "pings" });
    const framing = out.indexOf("SECURITY:");
    const body = out.indexOf("migration written");
    expect(framing).toBeGreaterThanOrEqual(0);
    expect(body).toBeGreaterThan(framing);
  });

  it("renders kind, seq, channel, sender handle and body", async () => {
    const out = await run(pingStub(), { op: "pings" });
    expect(out).toContain("[done]");
    expect(out).toContain("seq 12");
    expect(out).toContain("#`build`");
    expect(out).toContain("@agent-k3wpf7c5");
  });

  it("hands back the cursor to re-arm on", async () => {
    const out = await run(pingStub(), { op: "pings" });
    expect(out).toContain("since=12");
  });

  it("does NOT move the cursor on an empty page", async () => {
    // ⚠ Re-arming on a fabricated seq is how a reader silently skips the next
    // arrival — the one failure an inbox must never have.
    const out = await run(pingStub({ listPings: vi.fn(async () => []) }), {
      op: "pings",
      since: 7,
    });
    expect(out).toMatch(/SAME since/);
    expect(out).not.toContain("since=");
  });

  it("passes the caller's filters and NO identity — there is none to pass", async () => {
    const client = pingStub();
    await run(client, { op: "pings", since: 4, limit: 5 });
    const list = client.listPings as unknown as ReturnType<typeof vi.fn>;
    expect(list.mock.calls[0][0]).toEqual({ since: 4, limit: 5 });
  });

  it("names the two cursor spaces as separate", async () => {
    const out = await run(pingStub(), { op: "pings" });
    expect(out).toMatch(/separate from message seqs/i);
  });
});

describe("required params are named before anything runs", () => {
  it.each([
    ["channel", { op: "ping", ping_kind: "done", body: "b", to_desktop: true }],
    ["ping_kind", { op: "ping", channel: "build", body: "b", to_desktop: true }],
    ["body", { op: "ping", channel: "build", ping_kind: "done", to_desktop: true }],
  ])("missing %s", async (name, args) => {
    const client = pingStub();
    const out = await run(client, args);
    expect(out).toContain(name);
    expect(client.createPing).not.toHaveBeenCalled();
  });
});
