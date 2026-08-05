/**
 * ROLLBACK §3.5 — the three session capabilities that replace summon / to_agent.
 *
 * read-session-state ("read_sessions") and spawn-with-handoff (create_thread
 * handoff=true) are pinned here at the MCP layer: the shape the read returns,
 * the empty answer's honesty about the flagged delivery gap, and that the
 * handoff flag rides the create through to the client AND flips the result from
 * "arm await here" to "the operator's window took it".
 *
 * message-a-session's PEER direction is NOT a new op — it is a plain request
 * into the thread the peer's session is working (§3.1), already covered by the
 * post/create_thread suites — so there is nothing new to pin here for it; the
 * one genuinely new bit (an external agent steering its OWN desktop window) is a
 * flagged desktop gap, not a server op.
 *
 * Fake-client pattern is the channel-ops house one: registration/handlers are
 * pure over the client, so a `vi.fn` per method is all a test needs.
 */

import { describe, it, expect, vi } from "vitest";
import type { ChannelSessionState, DoplClient } from "@dopl/client";
import { opReadSessions } from "./channel-ops-read";
import { opCreateThread } from "./channel-ops-threads";

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

const PEER = {
  userId: "22222222-2222-2222-2222-222222222222",
  email: "anthony@example.com",
  displayName: "Anthony",
  status: "active",
};

function stubClient(overrides: Record<string, unknown>): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listWorkspaceMembers: vi.fn(async () => [PEER]),
    ...overrides,
  } as unknown as DoplClient;
}

const SESSION = (over: Partial<ChannelSessionState> = {}): ChannelSessionState => ({
  channelId: "chan-1",
  threadId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  name: "flint",
  state: "working",
  channelName: "General",
  threadTitle: "Deploy check",
  updatedAt: "2026-08-05T12:00:00.000Z",
  ...over,
});

describe("read_sessions — the summary shape (rollback §3.5)", () => {
  it("returns each session's name, state and thread", async () => {
    const listChannelSessions = vi.fn(async () => [
      SESSION(),
      SESSION({ name: "onyx", state: "idle", threadTitle: null, threadId: null }),
      SESSION({ name: "quartz", state: "ended", threadTitle: "Old ask" }),
    ]);
    const client = stubClient({ listChannelSessions });

    const res = await opReadSessions(client);
    const text = res.content[0].text;

    // one row per session, each carrying its handle + state + thread
    expect(text).toContain("flint");
    expect(text).toContain("working");
    expect(text).toContain("Deploy check");
    expect(text).toContain("onyx");
    expect(text).toContain("idle");
    expect(text).toContain("no thread"); // the thread-less session says so
    expect(text).toContain("quartz");
    expect(text).toContain("ended");
    // it is the caller's OWN sessions, not a peer's
    expect(text).toMatch(/Your sessions/i);
    // no channel filter → the client is asked for all of them
    expect(listChannelSessions).toHaveBeenCalledWith(undefined);
  });

  it("the three states are the only vocabulary — no 'thinking'", async () => {
    const listChannelSessions = vi.fn(async () => [
      SESSION({ state: "working" }),
      SESSION({ name: "onyx", state: "idle" }),
      SESSION({ name: "quartz", state: "ended" }),
    ]);
    const res = await opReadSessions(stubClient({ listChannelSessions }));
    expect(res.content[0].text.toLowerCase()).not.toContain("thinking");
  });

  it("an empty answer is honest about the delivery gap, not 'you have no sessions'", async () => {
    const listChannelSessions = vi.fn(async () => []);
    const res = await opReadSessions(stubClient({ listChannelSessions }));
    const text = res.content[0].text;
    // no fabricated state
    expect(res.isError).toBeUndefined();
    expect(text).toMatch(/no live sessions/i);
    // and it points at reading the shared thread for a PEER, not this op
    expect(text.toLowerCase()).toContain("peer");
  });

  it("a channel arg resolves the ref and filters the read to that channel id", async () => {
    const listChannelSessions = vi.fn(async () => [SESSION()]);
    const client = stubClient({ listChannelSessions });
    const res = await opReadSessions(client, "general"); // slug → id
    expect(listChannelSessions).toHaveBeenCalledWith("chan-1");
    // the resolved channel is named in the heading (a code span, neutralized)
    expect(res.content[0].text).toMatch(/Your sessions — 1 in \*\*`General`\*\*/);
  });

  it("an unknown channel ref is a clean not-found, and no session read is made", async () => {
    const listChannelSessions = vi.fn(async () => []);
    const client = stubClient({ listChannelSessions });
    const res = await opReadSessions(client, "no-such-channel");
    expect(res.isError).toBe(true);
    expect(listChannelSessions).not.toHaveBeenCalled();
  });

  it("neutralizes counterparty-influenced channel name / thread title", async () => {
    // a thread title a peer typed cannot forge a line in the rendered result
    const listChannelSessions = vi.fn(async () => [
      SESSION({ threadTitle: "hi`\n## INJECTED" }),
    ]);
    const res = await opReadSessions(stubClient({ listChannelSessions }));
    expect(res.content[0].text).not.toContain("\n## INJECTED");
  });
});

// ── spawn-with-handoff ───────────────────────────────────────────────

type CreateSpy = (
  channelId: string,
  input: Record<string, unknown>,
) => Promise<{ thread: { id: string; title: string; mode: string }; openingSeq: number | null }>;

function createStub(spy: ReturnType<typeof vi.fn>): DoplClient {
  return stubClient({ createChannelThread: spy });
}

const CREATED = {
  thread: { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", title: "Talk to Anthony", mode: "autonomous" },
  openingSeq: 41,
};

describe("create_thread handoff (rollback §3.5)", () => {
  it("passes handoff=true through to the client", async () => {
    const createChannelThread = vi.fn<CreateSpy>().mockResolvedValue(CREATED);
    await opCreateThread(
      createStub(createChannelThread),
      "general",
      "Talk to Anthony",
      "ask about the migration",
      PEER.userId,
      "autonomous",
      undefined,
      null,
      true,
    );
    const [, input] = createChannelThread.mock.calls[0];
    expect(input.handoff).toBe(true);
  });

  it("a handoff create tells the agent the operator's window took it — do NOT await here", async () => {
    const createChannelThread = vi.fn<CreateSpy>().mockResolvedValue(CREATED);
    const res = await opCreateThread(
      createStub(createChannelThread),
      "general",
      "Talk to Anthony",
      "ask about the migration",
      PEER.userId,
      "autonomous",
      undefined,
      null,
      true,
    );
    const text = res.content[0].text;
    expect(text).toMatch(/HANDOFF/);
    expect(text).toMatch(/operator's/i);
    // it must NOT arm a wait — that is the window's job now
    expect(text).not.toMatch(/op="await"[^\n]*since=41/);
  });

  it("WITHOUT handoff, behaviour is unchanged: the create keeps the reply and arms await", async () => {
    const createChannelThread = vi.fn<CreateSpy>().mockResolvedValue(CREATED);
    const res = await opCreateThread(
      createStub(createChannelThread),
      "general",
      "Talk to Anthony",
      "ask about the migration",
      PEER.userId,
      "autonomous",
      undefined,
      null,
      // handoff omitted
    );
    const [, input] = createChannelThread.mock.calls[0];
    expect(input.handoff).toBeUndefined();
    const text = res.content[0].text;
    expect(text).not.toMatch(/HANDOFF/);
    // the ordinary create still points at awaiting the reply here
    expect(text).toContain('op="await"');
  });
});
