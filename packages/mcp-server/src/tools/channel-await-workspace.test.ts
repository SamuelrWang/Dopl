/**
 * THE WORKSPACE-WIDE `await` OP, and the ADDITIVITY of the per-channel one's
 * new `sessions` key.
 *
 * ⚠ TWO PROPERTIES THIS SUITE EXISTS FOR:
 *  1. **THE SCOPE IS STATED, ALWAYS.** A workspace hold watches channels the
 *     caller is a MEMBER of. An agent that sees traffic will otherwise assume it
 *     is seeing ALL traffic, and read silence from a public room it never joined
 *     as evidence the workspace is quiet.
 *  2. **`sessions` IS ADDITIVE.** An older server sends no such key; the render
 *     must be byte-identical to the pre-wave one in that case, because a heading
 *     with no rows under it reads as "you have no agents".
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opAwaitWorkspace } from "./channel-ops-await-workspace";
import { opAwait } from "./channel-ops-await";

const ME = "11111111-1111-1111-1111-111111111111";

function message(over: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    seq: 10,
    channelId: "chan-1",
    authorUserId: "22222222-2222-2222-2222-222222222222",
    authorKind: "agent",
    kind: "message",
    body: "the parser is done",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-08-22T12:00:00.000Z",
    channelName: "General",
    channelSlug: "general",
    ...over,
  };
}

/**
 * ⚠ THE INNER POLL SLEEPS, AND IT HAS TO. `opAwaitWorkspace` treats a hold that
 * returns far under its ask as CUT SHORT — the platform-clamp branch, which
 * deliberately tells the agent NOT to re-arm. An instant mock trips it every
 * time, so a case testing the ordinary TIMEOUT result would be testing the clamp
 * warning instead. Paired with `HOLD_MS` below: elapsed must exceed half the ask.
 */
const POLL_DELAY_MS = 30;
const HOLD_MS = 40;

function wsClient(result: Record<string, unknown>): DoplClient {
  return {
    awaitWorkspaceMessages: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
      return { messages: [], timedOut: true, channelCount: 2, ...result };
    }),
  } as unknown as DoplClient;
}

const text = async (c: DoplClient, since = 5, timeout?: number) =>
  (await opAwaitWorkspace(c, since, timeout, ME)).content[0].text as string;

describe("a workspace page names the channel every message came from", () => {
  it("groups by channel and heads each group with a usable ref", async () => {
    const out = await text(
      wsClient({
        messages: [
          message(),
          message({ id: "m-2", seq: 11, channelId: "chan-2", channelName: "Ops", channelSlug: "ops" }),
          message({ id: "m-3", seq: 12 }),
        ],
        timedOut: false,
      })
    );
    expect(out).toContain("### `General` — `general`");
    expect(out).toContain("### `Ops` — `ops`");
    expect(out).toContain("across 2 channels");
  });

  /**
   * ⚠ THE CURSOR IS THE MAX OVER THE WHOLE PAGE, NOT THE LAST LINE. Grouping
   * reorders the page relative to `seq`, so "the last message shown" is no
   * longer the highest seq — taking it would advance the cursor past the other
   * group's newer messages and lose them PERMANENTLY, because a cursor only
   * moves forward.
   */
  it("REGRESSION: the next `since` is the page MAXIMUM, not the last rendered line", async () => {
    const out = await text(
      wsClient({
        messages: [
          message({ seq: 10 }),
          message({ id: "m-2", seq: 99, channelId: "chan-2", channelName: "Ops", channelSlug: "ops" }),
          message({ id: "m-3", seq: 11 }),
        ],
        timedOut: false,
      })
    );
    expect(out).toContain("Highest seq shown: 99");
    expect(out).toContain("since=99");
  });

  it("falls back to the id when a channel could not be labelled", async () => {
    const out = await text(
      wsClient({
        messages: [message({ channelName: null, channelSlug: null })],
        timedOut: false,
      })
    );
    expect(out).toContain("chan-1");
  });
});

describe("the scope is stated on every result", () => {
  it("on a page WITH messages", async () => {
    const out = await text(wsClient({ messages: [message()], timedOut: false }));
    expect(out).toContain("every channel you are a MEMBER of (2)");
    expect(out).toContain("PUBLIC channel you have not joined is NOT watched");
  });

  it("on a timeout", async () => {
    const out = await text(wsClient({}), 5, HOLD_MS);
    expect(out).toContain("every channel you are a MEMBER of (2)");
  });

  it("ZERO memberships is a REFUSAL to re-arm, not a quiet empty page", async () => {
    // ⚠ A hold watching nothing can never fire; telling the agent to keep
    // waiting on it is telling it to wait forever.
    const out = await text(wsClient({ channelCount: 0 }), 5, HOLD_MS);
    expect(out).toContain("THIS HOLD WATCHED NOTHING");
    expect(out).toContain("Do not re-arm");
  });
});

describe("the workspace stop rule is its own, not the per-channel one", () => {
  it("warns that ANY channel's traffic wakes it, so a wake is not news", async () => {
    const out = await text(wsClient({}), 5, HOLD_MS);
    expect(out).toContain("wakes on ANY message in ANY channel");
    expect(out).toContain("workspace activity as a sign of life");
  });

  it("says the TIMEOUT stops being the 'nothing is happening' signal", async () => {
    expect(await text(wsClient({}), 5, HOLD_MS)).toContain(
      "the timeout can no longer be your"
    );
  });

  it("states the ABSENCE of a finished state (INVARIANTS §10)", async () => {
    expect(await text(wsClient({}), 5, HOLD_MS)).toContain(
      "no finished STATE to wait for"
    );
  });
});

describe("the caller's own posts never end its own workspace hold", () => {
  it("passes excludeAuthor when the boot handshake named the caller", async () => {
    const client = wsClient({});
    await opAwaitWorkspace(client, 5, HOLD_MS, ME);
    const call = vi.mocked(client.awaitWorkspaceMessages).mock.calls[0][0];
    expect(call.excludeAuthor).toBe(ME);
  });

  it("passes NO filter when it did not", async () => {
    const client = wsClient({});
    await opAwaitWorkspace(client, 5, HOLD_MS, null);
    const call = vi.mocked(client.awaitWorkspaceMessages).mock.calls[0][0];
    expect(call).not.toHaveProperty("excludeAuthor");
  });
});

/**
 * ADDITIVITY. ⚠ `undefined` (an older server, or a failed session read behind a
 * good hold) and `[]` (the server looked, this machine reports nothing) are
 * DIFFERENT ANSWERS and must render differently — collapsing them tells an
 * orchestrator it has no agents whenever it talks to an older deployment.
 */
describe("the `sessions` block is ADDITIVE on both holds", () => {
  const session = {
    channelId: "chan-1",
    threadId: null,
    name: "abcd1234",
    state: "working" as const,
    detail: null,
    channelName: "General",
    threadTitle: null,
    updatedAt: new Date().toISOString(),
    model: null,
    toolLabel: null,
    contextUsed: null,
    contextWindow: null,
    tokensSpent: 900,
    startedAt: null,
    lastActivityAt: null,
    templateName: null,
  };

  it("workspace: an ABSENT key renders no block at all", async () => {
    const out = await text(wsClient({ messages: [message()], timedOut: false }));
    expect(out).not.toContain("Your agents");
  });

  it("workspace: an EMPTY array renders the honest 'none reported' line", async () => {
    const out = await text(
      wsClient({ messages: [message()], timedOut: false, sessions: [] })
    );
    expect(out).toContain("none reported");
    expect(out).toContain("not proof there are none");
  });

  it("workspace: a populated array renders the sessions, telemetry included", async () => {
    const out = await text(
      wsClient({ messages: [message()], timedOut: false, sessions: [session] })
    );
    expect(out).toContain("### Your agents — 1");
    expect(out).toContain("900 tokens");
  });

  it("per-channel: absent renders no block; populated renders one", async () => {
    const bare = {
      listChannels: vi.fn(async () => [
        { id: "chan-1", slug: "general", name: "General", visibility: "private" },
      ]),
      awaitChannelMessages: vi.fn(async () => ({
        messages: [message()],
        timedOut: false,
      })),
    } as unknown as DoplClient;
    const noBlock = (await opAwait(bare, "general", 5, 40_000, ME)).content[0]
      .text as string;
    expect(noBlock).not.toContain("Your agents");

    const withSessions = {
      ...bare,
      awaitChannelMessages: vi.fn(async () => ({
        messages: [message()],
        timedOut: false,
        sessions: [session],
      })),
    } as unknown as DoplClient;
    const block = (await opAwait(withSessions, "general", 5, 40_000, ME))
      .content[0].text as string;
    expect(block).toContain("### Your agents — 1");
  });

  it("per-channel: the block renders on a TIMEOUT too — the case it earns most", async () => {
    // ⚠ A hold that came back empty is exactly when an orchestrator has to decide
    // whether the agent it is waiting on is still alive.
    const client = {
      listChannels: vi.fn(async () => [
        { id: "chan-1", slug: "general", name: "General", visibility: "private" },
      ]),
      awaitChannelMessages: vi.fn(async () => {
        // ⚠ Same reason as `POLL_DELAY_MS` above — an instant hold reads as CUT
        // SHORT, which is a different result with different guidance.
        await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
        return { messages: [], timedOut: true, sessions: [session] };
      }),
    } as unknown as DoplClient;
    const out = (await opAwait(client, "general", 5, HOLD_MS, ME)).content[0]
      .text as string;
    expect(out).toContain("### Your agents — 1");
  }, 30_000);
});
