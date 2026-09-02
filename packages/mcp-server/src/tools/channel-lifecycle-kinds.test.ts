/**
 * THE AGENT'S WRITE SURFACE. ⚠ A terminal `kind` is structurally unrenderable
 * on the requester's side — the web reader drops the three kinds outright
 * (`channels-v2/view-model.ts › isLifecycleEcho`, wiring plan Phase 5,
 * 2026-08-18; before that a session card folded the marker into its `endEvent`)
 * — so an ANSWER posted as
 * `kind:"task_finished"` appears NOWHERE. Two guards pinned here:
 *   1. ⚠ **`kind` IS NOT A PARAM ANY MORE (C12, 2026-09-02)**, so the three are
 *      not REFUSABLE — they are UNSAYABLE. The field published five values of
 *      which three were refused, one had its own op and one was the default,
 *      and its own text opened "leave it unset". A pre-call guard over an
 *      argument no caller can send is a guard with nothing to catch, so what is
 *      pinned here is the DELETION and the belt behind it: the server's
 *      `service-writes.assertLifecycleKindIsServerOwned` is now the only
 *      refusal, and the 403 it raises is still answered with the RULE.
 *   2. `op="milestone"` exists, so the milestone lane is a different CALL, not
 *      a different `kind` on the same call — and it is the ONLY writer of a
 *      `task_*` kind left on this tool.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
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

// ── 1. the deletion, and the belt behind it ────────────────────────────────────

describe("the three lifecycle kinds are UNSAYABLE, not merely refused (C12)", () => {
  it.each(LIFECYCLE_KINDS)("%s is not a value a caller can send", (kind) => {
    // ⚠ THE STRONGER GUARD. A pre-call refusal caught a caller that named one;
    // an absent param means nothing can name one, so there is no arm to keep
    // correct and no sentence to keep in sync with the server's.
    expect(CHANNEL_INPUT_SHAPE).not.toHaveProperty("kind");
    expect(JSON.stringify(CHANNEL_INPUT_SHAPE.op.options)).not.toContain(kind);
  });

  it("an unknown arg is dropped by the strict shape, never forwarded", async () => {
    // The call as an older agent would still write it: `kind` reaches nothing.
    const client = stubClient();
    const res = await callTool(client)({
      op: "post",
      channel: "general",
      body: "Here is the finished analysis…",
      kind: "task_finished",
    });

    expect(res.isError).toBeFalsy();
    const [, input] = vi.mocked(client.postChannelMessage).mock.calls[0];
    expect((input as unknown as Record<string, unknown>).kind).toBeUndefined();
  });

  it("the SERVER's 403 is still answered with the rule, not with membership", async () => {
    // ⚠ THE BELT FOR A BYPASSED BUILD. Unreachable through the tool now, and
    // answered anyway — the one thing it must never read as is "you left the
    // channel", which is what a status-only branch would have said.
    const client = stubClient({
      postChannelMessage: vi.fn(async () => {
        throw Object.assign(new Error("forbidden"), {
          status: 403,
          code: "CHANNEL_LIFECYCLE_KIND_FORBIDDEN",
        });
      }),
    });
    const res = await opPost(client, "general", "done", {});

    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).toContain("LIFECYCLE kind");
    expect(text).toContain("FINAL ANSWER");
    expect(text).toContain('op="milestone"');
    expect(text).not.toContain("member of that channel");
  });
});

describe("what the deletion must NOT catch", () => {
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
  it("the rule outlived the param: the doctrine still states it, once", () => {
    // ⚠ **THE PARAM'S `.describe()` WAS THE OTHER HALF OF THIS PAIR AND IS
    // GONE** (C12). What it taught — that everything substantive you send is a
    // plain message, and that the three markers belong to the runtime — is a
    // STANDING rule rather than a field contract, so it belongs in the pulled
    // doctrine and nowhere else. A rule stated in two places drifts in one.
    //
    // ⚠ **G2 (A6, 2026-09-02) — THE FENCE IS THE CREDENTIAL, NOT THE CALLER.**
    // The retired describe read "this tool REFUSES them from you", and the
    // hotfix investigation proved the sentence wrong rather than the code: the
    // refusal keys on `ctx.source === "agent"`
    // (`service-writes-lifecycle.ts`), by pinned invariant, because
    // cookie-session posts are the desktop's own lane and must keep writing
    // lifecycle rows.
    expect(CHANNEL_DOCTRINE).toContain("REFUSED FROM AN AGENT CREDENTIAL");
    expect(CHANNEL_DOCTRINE).toContain(
      "the fence is the credential a call arrives on, not the author it claims",
    );
    expect(CHANNEL_DOCTRINE).not.toContain("they are REFUSED from you");
    expect(CHANNEL_DOCTRINE).toContain("EVERY SUBSTANTIVE THING YOU SAY IS AN ORDINARY MESSAGE");
  });
});
