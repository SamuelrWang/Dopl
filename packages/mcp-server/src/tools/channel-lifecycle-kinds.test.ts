/**
 * THE AGENT'S WRITE SURFACE. ⚠ A terminal `kind` is structurally unrenderable
 * on the requester's side (`lib/group-thread.ts` folds it into `draft.endEvent`
 * and never pushes it to `draft.entries`), so an ANSWER posted as
 * `kind:"task_finished"` appears NOWHERE. Two guards pinned here:
 *   1. `op="post"` REFUSES the three lifecycle kinds before any round-trip,
 *      saying what to do instead. (Authoritative refusal is the server's,
 *      `service-writes.assertLifecycleKindIsServerOwned`; this is the fast,
 *      teaching half.)
 *   2. `op="milestone"` exists, so the milestone lane is a different CALL, not
 *      a different `kind` on the same call — the two acts can no longer be
 *      confused by picking wrongly between adjacent enum values.
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
    listChannelThreads: vi.fn(async () => ({ threads: [], truncated: false })),
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
    // ⚠ "Nothing was sent" must be TRUE, not claimed — refused ahead of the
    // channel lookup, so not even the resolve happens.
    expect(client.postChannelMessage).not.toHaveBeenCalled();
    expect(client.listChannels).not.toHaveBeenCalled();
  });

  it("leads with the CONSEQUENCE, because that is what changes behaviour", async () => {
    // ⚠ The sentence that moves an agent is "the body is not shown", not "that
    // kind is reserved" — pin the effect AND the remedy.
    const text = (
      await opPost(stubClient(), "general", "done", { kind: "task_finished" })
    ).content[0].text;

    expect(text).toContain("Nothing was sent");
    expect(text).toContain("its body is not shown at all");
    expect(text).toContain("delivered nowhere");
    expect(text).toContain("drop `kind` entirely and post the same text");
    expect(text).toContain('op="milestone"');
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
    // ⚠ No kind on the wire at all.
    expect((input as unknown as Record<string, unknown>).kind).toBeUndefined();
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
    const sent = input as unknown as Record<string, unknown>;
    expect(channelId).toBe("chan-1");
    expect(sent.kind).toBe("task_progress");
    expect(sent.body).toBe("schema half landed");
    expect(sent.metadata).toMatchObject({ taskId: THREAD_ID });
  });

  it("REQUIRES a thread, where post leaves it optional", async () => {
    // ⚠ An untagged milestone groups into nothing the requester is watching —
    // always a mistake. `post` keeps `thread` optional because an untagged post
    // is a legitimate main-room line.
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
    // ⚠ `to` is a live param of `post` and deliberately NOT routed through here
    // — a milestone that could address somebody is a reply wearing a marker's
    // clothes. ⚠ Do not assert the absence of a field the TYPE lacks: that is
    // not coverage, it is a comment that runs.
    const client = stubClient();
    await callTool(client)({
      op: "milestone",
      channel: "general",
      thread: THREAD_ID,
      body: "step two",
      to: "peer@example.com",
    });
    const [, input] = vi.mocked(client.postChannelMessage).mock.calls[0];
    const sent = input as unknown as Record<string, unknown>;
    expect(sent.toUserId).toBeUndefined();
    // ⚠ …and it DID send thread and body, so the absence above is a ROUTING
    // decision, not a call that never happened.
    expect((sent.metadata as Record<string, unknown>).taskId).toBe(THREAD_ID);
    expect(sent.body).toBe("step two");
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

    const described = (schema.kind as unknown as { description?: string }).description ?? "";
    expect(described).toContain("LEAVE THIS UNSET");
    expect(described).toContain("FINAL ANSWER");
    expect(described).toContain("LIFECYCLE MARKERS");
    expect(described).toContain('op="milestone"');
  });
});
