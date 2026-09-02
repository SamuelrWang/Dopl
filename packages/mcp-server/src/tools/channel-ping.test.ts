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
    ]) {
      expect(CHANNEL_INPUT_SHAPE, key).not.toHaveProperty(key);
    }
  });

  /**
   * ⚠ **`recipient` WAS ON THE LIST ABOVE UNTIL 2026-09-02, AND THE GUARD WAS
   * RIGHT TO BAN IT THEN** (F-429). The reason it gave — *"a param an MCP client
   * can see is a param a model will try, and a silently-dropped address is the
   * invisible-delivery failure the addressing contract exists to prevent"* — was
   * about a FOURTH spelling landing beside `to`, `to_desktop` and `agent_id`
   * while all three stayed declared. C5 landed it as a DELETION instead: three
   * spellings out, one in, in the same change.
   *
   * ⚠ **SO THE BAN BECAME THE PROPERTY IT WAS STANDING IN FOR** — exactly one
   * recipient param on this op, and nothing on the shape that could name another
   * member's machine. The three names below may never come back.
   */
  it("takes EXACTLY ONE recipient param, and the three it replaced are gone", () => {
    expect(CHANNEL_INPUT_SHAPE).toHaveProperty("recipient");
    expect(CHANNEL_INPUT_SHAPE).not.toHaveProperty("to_desktop");
    expect(CHANNEL_INPUT_SHAPE).not.toHaveProperty("ping_to");
    expect(CHANNEL_INPUT_SHAPE).not.toHaveProperty("ping_agent_id");
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
      recipient: "desktop",
      // Everything a caller might try to point this at someone else's machine.
      operator: "u2",
      user_id: "u2",
      sender_agent_id: "k3wpf7c5",
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

describe("EXACTLY ONE RECIPIENT — now a shape rather than a count", () => {
  /**
   * ⚠ **THE RUNTIME COUNT IS DELETED, NOT RELAXED.** `recipientOr` counted three
   * mutually exclusive params and wrote two refusals — one naming all three
   * spellings, one naming the count it saw. Neither case is expressible now, so
   * the zero case is `missingParams` like every other required argument and the
   * two case does not exist.
   */
  it("names `recipient` when it is missing, like any other required param", async () => {
    const client = pingStub();
    const out = await run(client, SEND);
    expect(out).toContain("recipient");
    expect(client.createPing).not.toHaveBeenCalled();
  });

  it("cannot be sent two destinations at all", async () => {
    // The old two-recipient call, as a caller would still write it: the extra
    // keys are not on the shape, so nothing reaches the wire but `recipient`.
    const client = pingStub();
    await run(client, { ...SEND, recipient: "desktop", to: "u2" });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.calls[0][0]).toMatchObject({ toDesktop: true });
    expect(create.mock.calls[0][0]).not.toHaveProperty("to");
  });
});

describe("one string, the wire's own three keys", () => {
  it('recipient="desktop"', async () => {
    const client = pingStub();
    await run(client, { ...SEND, recipient: "desktop" });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.calls[0][0]).toMatchObject({ toDesktop: true });
  });

  it("a member ref — anything that is neither of the other two", async () => {
    const client = pingStub();
    await run(client, { ...SEND, recipient: "dana@example.com" });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.calls[0][0]).toMatchObject({ to: "dana@example.com" });
  });

  it("the printed `@agent-<id>` handle, STRIPPED rather than refused", async () => {
    // ⚠ `read_sessions` prints `@agent-<id>`, so that is what a model copies.
    const client = pingStub();
    await run(client, { ...SEND, recipient: "@agent-k3wpf7c5" });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.calls[0][0]).toMatchObject({ agentId: "k3wpf7c5" });
  });

  it("the bare eight-character instance id, which is the same agent", async () => {
    const client = pingStub();
    await run(client, { ...SEND, recipient: "k3wpf7c5" });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.calls[0][0]).toMatchObject({ agentId: "k3wpf7c5" });
  });

  /**
   * ⚠ THE THREE FORMS CANNOT OVERLAP, WHICH IS WHY THERE IS NO PRECEDENCE RULE.
   * A user id is a 36-character uuid and an email carries an `@` that is never
   * in first position — neither can match the anchored agent-id shape.
   */
  it("a user id is a MEMBER, never an agent instance", async () => {
    const client = pingStub();
    await run(client, {
      ...SEND,
      recipient: "9f1d0f0a-1111-2222-3333-444455556666",
    });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.calls[0][0]).toMatchObject({
      to: "9f1d0f0a-1111-2222-3333-444455556666",
    });
  });

  it("carries the thread through when one is named", async () => {
    const client = pingStub();
    await run(client, { ...SEND, recipient: "desktop", thread: "t-1" });
    const create = client.createPing as unknown as ReturnType<typeof vi.fn>;
    expect(create.mock.calls[0][0]).toMatchObject({ threadId: "t-1" });
  });
});

describe("the body cap is refused BEFORE any round trip", () => {
  it("names both numbers and points at op=\"post\" for the detail", async () => {
    const client = pingStub();
    const out = await run(client, {
      ...SEND,
      recipient: "desktop",
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
    const out = await run(pingStub(), { ...SEND, recipient: "desktop" });
    expect(out).toMatch(/not a message/i);
    expect(out).toMatch(/await/);
  });

  it("warns that the ping seq is not a message seq", async () => {
    const out = await run(pingStub(), { ...SEND, recipient: "desktop" });
    expect(out).toMatch(/not a message seq/i);
  });

  it("says what happens NEXT, per recipient form", async () => {
    const desktop = await run(pingStub(), { ...SEND, recipient: "desktop" });
    expect(desktop).toMatch(/external session/i);

    const agentPing = { ...PING, recipientKind: "agent" as const, recipientAgentId: "k3wpf7c5" };
    const woke = await run(
      pingStub({ createPing: vi.fn(async () => agentPing) }),
      { ...SEND, recipient: "k3wpf7c5" },
    );
    // ⚠ It must not PROMISE a wake — the machine decides, and a dead session is
    // an honest outcome rather than a failure.
    expect(woke).toMatch(/if that agent is live/i);

    const memberPing = { ...PING, recipientKind: "member" as const, recipientUserId: "u2" };
    const filed = await run(
      pingStub({ createPing: vi.fn(async () => memberPing) }),
      { ...SEND, recipient: "u2" },
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

  /**
   * ⚠ **THE INBOX HAS NO CURSOR, AND THAT IS C13's FIX** (2026-09-02). A ping seq
   * was a SECOND cursor space behind the one `since` param that also carries the
   * message cursor, and crossing them read a plausible WRONG page instead of
   * erroring. The remedy is one space, not a prefix: `since` is the message seq
   * and nothing else, and this op hands back the newest page.
   */
  it("takes NO cursor — `since` never reaches the ping lane", async () => {
    const client = pingStub();
    await run(client, { op: "pings", since: 4, limit: 5 });
    const list = client.listPings as unknown as ReturnType<typeof vi.fn>;
    expect(list.mock.calls[0][0]).toEqual({ limit: 5 });
  });

  it("says the page is the newest one and that a seq is how you dedupe", async () => {
    const out = await run(pingStub(), { op: "pings" });
    expect(out).toMatch(/newest page/i);
    expect(out).not.toMatch(/since=/);
  });

  it("still says a ping is in no transcript, which is the other half", async () => {
    const out = await run(pingStub(), { op: "pings" });
    expect(out).toMatch(/in NO transcript/i);
  });
});

describe("required params are named before anything runs", () => {
  it.each([
    ["channel", { op: "ping", ping_kind: "done", body: "b", recipient: "desktop" }],
    ["ping_kind", { op: "ping", channel: "build", body: "b", recipient: "desktop" }],
    ["body", { op: "ping", channel: "build", ping_kind: "done", recipient: "desktop" }],
  ])("missing %s", async (name, args) => {
    const client = pingStub();
    const out = await run(client, args);
    expect(out).toContain(name);
    expect(client.createPing).not.toHaveBeenCalled();
  });
});
