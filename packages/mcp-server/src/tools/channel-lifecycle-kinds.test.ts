/**
 * P0-2 / P0-3 — THE AGENT'S WRITE SURFACE, after the 2026-08-04 incident.
 *
 * WHAT HAPPENED. A responder agent finished its work and posted the ANSWER as
 * `kind:"task_finished"`. On the requester's side it appeared nowhere:
 * `lib/group-thread.ts` folds a terminal marker into `draft.endEvent` and never
 * pushes it to `draft.entries`, so its body is structurally unrenderable. The
 * runtime was innocent — the desktop's delivery call emits no `kind` at all and
 * the MCP default is `message`. The AGENT chose the kind, because the surface
 * offered five values in one flat enum with no rule about whose each one is.
 *
 * TWO CHANGES ARE PINNED HERE:
 *   1. `op="post"` REFUSES the three lifecycle kinds, before any round-trip, with
 *      a message that says what to do instead. (The authoritative refusal is the
 *      server's — `service-writes.assertLifecycleKindIsServerOwned` — and lives
 *      in the app's own suite. This one is the fast, teaching half.)
 *   2. `op="milestone"` exists, so the milestone lane is a different CALL rather
 *      than a different `kind` on the same call. That is the seam: the two acts
 *      can no longer be confused by picking wrongly between adjacent enum values.
 *
 * The stub client is hand-rolled; nothing transports. What each assertion is
 * really watching for is a REGRESSION OF THE SURFACE, not of the transport: if
 * the refusal is removed, or the milestone op silently starts accepting a kind
 * again, the incident's whole runway is back.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opPost } from "./channel-ops-write";
import { registerChannelTool } from "./channel";
import type { RegisterTool, ToolResponse } from "./respond";

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

const THREAD_ID = "79ce5325-f53e-4d00-a1c0-f48875000bc0";

/** The three kinds that state a RUNTIME fact and are not an agent's to post. */
const LIFECYCLE_KINDS = ["task_started", "task_finished", "task_failed"] as const;

function stubClient(overrides: Record<string, unknown> = {}): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listChannelThreads: vi.fn(async () => []),
    postChannelMessage: vi.fn(async (_c: string, input: Record<string, unknown>) => ({
      id: "m1",
      seq: 7,
      kind: input.kind ?? "message",
      authorUserId: "u-me",
      metadata: input.metadata ?? {},
    })),
    ...overrides,
  } as unknown as DoplClient;
}

/** Drive the real registrar so the ROUTING is under test, not just the handler. */
function callTool(client: DoplClient) {
  let handler!: (args: Record<string, unknown>) => Promise<ToolResponse>;
  const register: RegisterTool = (_n, _d, _s, h) => {
    handler = h as typeof handler;
  };
  registerChannelTool(register, client);
  return handler;
}

// ── 1. the refusal ─────────────────────────────────────────────────────────────

describe('op="post" refuses the lifecycle kinds (P0-2)', () => {
  it.each(LIFECYCLE_KINDS)("refuses %s WITHOUT any round-trip", async (kind) => {
    const client = stubClient();
    const res = await opPost(client, "general", "Here is the finished analysis…", { kind });

    expect(res.isError).toBe(true);
    // "Nothing was sent" has to be TRUE, not merely claimed: the failure mode is
    // an agent that believes it delivered. Refused ahead of the channel lookup,
    // so not even the resolve happens.
    expect(client.postChannelMessage).not.toHaveBeenCalled();
    expect(client.listChannels).not.toHaveBeenCalled();
  });

  it("leads with the CONSEQUENCE, because that is what changes behaviour", async () => {
    // An agent that reached for `task_finished` believed it was delivering. The
    // sentence that moves it is "the body is not shown", not "that kind is
    // reserved" — so both the effect and the remedy are pinned.
    const text = (
      await opPost(stubClient(), "general", "done", { kind: "task_finished" })
    ).content[0].text;

    expect(text).toContain("Nothing was sent");
    expect(text).toContain("its body is not shown at all");
    expect(text).toContain("delivered nowhere");
    // The remedy, in the two forms it can take.
    expect(text).toContain("drop `kind` entirely and post the same text");
    expect(text).toContain('op="milestone"');
    // And the rule that generalizes it.
    expect(text).toContain("FINAL ANSWER included");
  });

  it("names the kind the caller actually passed", async () => {
    for (const kind of LIFECYCLE_KINDS) {
      const text = (await opPost(stubClient(), "general", "x", { kind })).content[0].text;
      expect(text).toContain(`kind="${kind}"`);
    }
  });
});

describe("what the refusal must NOT catch", () => {
  it("task_progress still posts: it is the milestone lane", async () => {
    const client = stubClient();
    const res = await opPost(client, "general", "schema half landed", {
      kind: "task_progress",
      thread: THREAD_ID,
    });
    expect(res.isError).toBeFalsy();
    expect(client.postChannelMessage).toHaveBeenCalled();
  });

  it("a plain message posts, which is the entire point of the rule", async () => {
    const client = stubClient();
    const res = await opPost(client, "general", "Here is the answer.", {});
    expect(res.isError).toBeFalsy();
    const [, input] = vi.mocked(client.postChannelMessage).mock.calls[0];
    // No kind on the wire at all — the default is what every substantive post is.
    expect((input as Record<string, unknown>).kind).toBeUndefined();
  });
});

// ── 2. the milestone op ────────────────────────────────────────────────────────

describe('op="milestone" — a different CALL, not a different kind (P0-3)', () => {
  it("posts a task_progress threaded under the given thread", async () => {
    const client = stubClient();
    const res = await callTool(client)({
      op: "milestone",
      channel: "general",
      thread: THREAD_ID,
      body: "schema half landed",
    });

    expect(res.isError).toBeFalsy();
    const [channelId, input] = vi.mocked(client.postChannelMessage).mock.calls[0];
    const sent = input as Record<string, unknown>;
    expect(channelId).toBe("chan-1");
    expect(sent.kind).toBe("task_progress");
    expect(sent.body).toBe("schema half landed");
    expect(sent.metadata).toMatchObject({ taskId: THREAD_ID });
  });

  it("REQUIRES a thread, where post leaves it optional", async () => {
    // An untagged milestone groups into nothing the requester is watching, which
    // is the one shape of this call that is always a mistake. `post` keeps
    // `thread` optional because an untagged post is a legitimate main-room line.
    const client = stubClient();
    const res = await callTool(client)({
      op: "milestone",
      channel: "general",
      body: "schema half landed",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("thread");
    expect(client.postChannelMessage).not.toHaveBeenCalled();
  });

  it("addresses nobody: a milestone marks the thread, it does not reach for anyone", async () => {
    // `to` / `to_agent` / `to_agents` are deliberately not routed through. A
    // milestone that could address somebody would be a reply wearing a marker's
    // clothes, which is the confusion this op exists to remove.
    const client = stubClient();
    await callTool(client)({
      op: "milestone",
      channel: "general",
      thread: THREAD_ID,
      body: "step two",
      to: "peer@example.com",
      to_agent: "quartz",
    });
    const [, input] = vi.mocked(client.postChannelMessage).mock.calls[0];
    const sent = input as Record<string, unknown>;
    expect(sent.toUserId).toBeUndefined();
    expect(sent.toAgent).toBeUndefined();
    expect(sent.toAgents).toBeUndefined();
  });

  it("carries as_agent, so a milestone is still attributable inside a breakout room", async () => {
    // A thread that admits the caller through one of its AGENTS refuses any post
    // that does not CLAIM that agent (`mayWriteThread`), milestones included.
    const client = stubClient({
      listChannelAgents: vi.fn(async () => [
        { id: "agent-1", name: "quartz", ownerUserId: "u-me", status: "active" },
      ]),
    });
    await callTool(client)({
      op: "milestone",
      channel: "general",
      thread: THREAD_ID,
      body: "step two",
      as_agent: "quartz",
    });
    const [, input] = vi.mocked(client.postChannelMessage).mock.calls[0];
    expect((input as Record<string, unknown>).authorAgentId).toBe("agent-1");
  });
});

// ── 3. the surface still teaches the rule ──────────────────────────────────────

describe("the published surface says whose each kind is", () => {
  it("the `kind` describe stops reading as an interchangeable list", () => {
    let schema!: Record<string, { description?: string }>;
    const register: RegisterTool = (_n, _d, s) => {
      schema = s as unknown as Record<string, { description?: string }>;
    };
    registerChannelTool(register, stubClient());

    // zod carries `.describe()` on the def; read it the way an MCP client would.
    const described = (schema.kind as unknown as { description?: string }).description ?? "";
    expect(described).toContain("LEAVE THIS UNSET");
    expect(described).toContain("FINAL ANSWER");
    expect(described).toContain("LIFECYCLE MARKERS");
    expect(described).toContain('op="milestone"');
  });
});
