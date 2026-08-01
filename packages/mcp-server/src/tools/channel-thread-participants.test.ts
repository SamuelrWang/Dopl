/**
 * THE THREAD PARTICIPANT SET — `op="create_thread"`'s `participants` seed, and
 * the set `op="get_thread"` renders back.
 *
 * What these pin, and why each one is worth a test:
 *
 *  - A SEED IS RESOLVED AGAINST THE ROSTER THE ROUTE CHECKS. `participants`
 *    arrives as `"agent:<handle>"` / `"user:<email>"` and must leave as
 *    `{kind, id}` refs resolved against the CHANNEL roster. Resolving against
 *    the WORKSPACE roster (as this used to) put a live, titled, empty,
 *    unanswerable thread in the channel and then reported "No thread was
 *    opened" — the B2 case.
 *  - A REFUSAL SAYS WHETHER A ROOM EXISTS. A pre-call refusal says nothing was
 *    created; a 400 that DOES get through may have left a thread behind, so it
 *    sends the caller to look rather than retry blind.
 *  - `as_agent` IS REFUSED HERE, not silently dropped. `TaskCreateSchema` has
 *    nowhere to put it, and an agent-attributed opening request classifies as
 *    `agent-escalation` on the receiving desktop — notify-only, spawning
 *    nothing, which is the one thing create_thread exists to do.
 *  - THE SET IS RENDERED BY BOTH NAMES — an agent by handle AND id, a person by
 *    member ref — an EMPTY set says pair-gated rather than saying nothing, and
 *    an unnameable agent still renders by id when the roster fetch fails.
 *
 * THE OTHER HALF: post-time addressing (`to_agent` / `as_agent` / `to_agents` /
 * `intent`) stays in `channel-agent-addressing.test.ts`, which this was split
 * out of at the §2 500-line cap — see that file's header for why the seam runs
 * here. Mutating a set AFTER the thread exists (`join_thread` / `leave_thread`)
 * is a third suite, `channel-ops-participants.test.ts`. The harness this shares
 * with the addressing half is `agent-addressing-fixtures.ts`.
 *
 * The @dopl/client is hand-stubbed; nothing transports.
 */

import { describe, it, expect, vi } from "vitest";
import type { RegisterTool } from "./respond";
import { registerChannelTool } from "./channel";
import { opCreateThread } from "./channel-ops-threads";
import { opGetThread } from "./channel-ops-read";
import { apiError, stubClient, textOf } from "./agent-addressing-fixtures";

describe('op="create_thread" — participants (the breakout room)', () => {
  const created = {
    thread: { id: "thread-1", title: "Ship it", mode: "interactive" },
    openingSeq: 41,
  };

  it("resolves the prefix form into {kind, id} refs", async () => {
    const createChannelThread = vi.fn(async () => created);
    const client = stubClient({ createChannelThread });

    const res = await opCreateThread(
      client,
      "general",
      "Ship it",
      "please help",
      "bob@x.com",
      undefined,
      undefined,
      null,
      ["agent:@Quartz", "user:cara@x.com"],
    );

    const [, input] = createChannelThread.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(input.participants).toEqual([
      { kind: "agent", id: "agent-1" },
      { kind: "user", id: "u-cara" },
    ]);
    const text = textOf(res);
    expect(text).toContain("BREAKOUT ROOM");
    expect(text).toContain("2 extra participants");
  });

  it("a prefixless entry is refused and NO thread is opened", async () => {
    const createChannelThread = vi.fn(async () => created);
    const client = stubClient({ createChannelThread });

    const res = await opCreateThread(
      client,
      "general",
      "Ship it",
      "please help",
      "bob@x.com",
      undefined,
      undefined,
      null,
      ["quartz"],
    );

    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('"agent:<handle or agent id>"');
    expect(createChannelThread).not.toHaveBeenCalled();
  });

  it("B2: a WORKSPACE member who is not in the CHANNEL is refused BEFORE the call", async () => {
    // `createTask` inserts the thread row, THEN seeds participants, THEN posts
    // the opening message. `seedThreadParticipants` → `assertIdentityBelongs`
    // 400s `CHANNEL_PARTICIPANT_NOT_MEMBER` for a workspace-only colleague, so
    // resolving the seed against the WORKSPACE roster (as this used to) put a
    // live, titled, empty, unanswerable thread in the channel and then reported
    // "No thread was opened". The roster this resolves against is now the one
    // the route checks, so the call never happens.
    const createChannelThread = vi.fn(async () => created);
    const client = stubClient({ createChannelThread });

    const res = await opCreateThread(
      client,
      "general",
      "Ship it",
      "please help",
      "bob@x.com",
      undefined,
      undefined,
      null,
      ["user:dale@x.com"],
    );

    expect(res.isError).toBe(true);
    expect(createChannelThread).not.toHaveBeenCalled();
    const text = textOf(res);
    expect(text).toContain("No member `dale@x.com` in this channel");
    expect(text).toContain('op="members"');
    expect(text).toContain('op="invite"');
    expect(text).toContain("Nothing was created");
  });

  it("B2: a participant 400 that DOES get through never claims no thread was opened", async () => {
    // The residue case — a membership that changed between the resolve and the
    // call. The thread may exist with no request in it, so the arm has to send
    // the caller to look instead of retrying blind (a retry with the same
    // client_msg_id returns the stored thread and re-seeds nothing).
    const client = stubClient({
      createChannelThread: vi.fn(async () => {
        throw apiError(400, "CHANNEL_PARTICIPANT_NOT_MEMBER");
      }),
    });

    const res = await opCreateThread(
      client,
      "general",
      "Ship it",
      "please help",
      "bob@x.com",
      undefined,
      undefined,
      null,
      ["user:cara@x.com"],
    );

    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).not.toContain("No thread was opened");
    expect(text).toContain("A THREAD MAY HAVE BEEN OPENED ANYWAY");
    expect(text).toContain('op="list_threads"');
    expect(text).toContain("does NOT re-seed the participant set");
  });

  it("S2: `as_agent` on create_thread is REFUSED, not silently dropped", async () => {
    // `TaskCreateSchema` has no `authorAgentId`, so the registrar had nowhere
    // to route this and dropped it — the opening request went out as the bare
    // human's and nothing said so. It is refused rather than wired through
    // because an agent-attributed message addressed to a person classifies as
    // `agent-escalation` on the receiving desktop: notify-only, spawning
    // nothing, which is the one thing create_thread exists to do.
    const createChannelThread = vi.fn(async () => created);
    const client = stubClient({ createChannelThread });

    let handler:
      | ((args: Record<string, unknown>) => Promise<{
          isError?: boolean;
          content: Array<{ text: string }>;
        }>)
      | null = null;
    const capture = ((_n: string, _d: string, _s: unknown, h: unknown) => {
      handler = h as typeof handler;
    }) as unknown as RegisterTool;
    registerChannelTool(capture, client);
    expect(handler).not.toBeNull();

    const res = await handler!({
      op: "create_thread",
      channel: "general",
      title: "Ship it",
      body: "please help",
      to: "bob@x.com",
      as_agent: "quartz",
    });

    expect(res.isError).toBe(true);
    expect(createChannelThread).not.toHaveBeenCalled();
    const text = res.content.map((c) => c.text).join("\n");
    expect(text).toContain("create_thread does not take `as_agent`");
    expect(text).toContain("nothing was created");
    expect(text).toContain('as_agent="<your handle>"');
  });

  it("no participants → the field is omitted and the thread stays pair-gated", async () => {
    const createChannelThread = vi.fn(async () => created);
    const client = stubClient({ createChannelThread });

    const res = await opCreateThread(
      client,
      "general",
      "Ship it",
      "please help",
      "bob@x.com",
    );

    const [, input] = createChannelThread.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(input.participants).toBeUndefined();
    expect(textOf(res)).not.toContain("BREAKOUT ROOM");
  });
});

describe('op="get_thread" — the participant set', () => {
  const THREAD = {
    id: "thread-1",
    channelId: "chan-1",
    workspaceId: "ws-1",
    title: "Ship it",
    status: "open",
    outcome: null,
    mode: "interactive",
    createdBy: "u-me",
    targetUserId: "u-bob",
    createdAt: "2026-07-28T00:00:00Z",
    updatedAt: "2026-07-28T00:00:00Z",
    closedAt: null,
    outcomeSummary: null,
  };

  it("names each participant — an agent by handle AND id, a person by member ref", async () => {
    const client = stubClient({
      getChannelThread: vi.fn(async () => ({
        ...THREAD,
        participants: [
          { id: "p1", threadId: "thread-1", kind: "user", userId: "u-bob", agentId: null },
          { id: "p2", threadId: "thread-1", kind: "agent", userId: null, agentId: "agent-1" },
        ],
      })),
    });

    const text = textOf(await opGetThread(client, "general", "thread-1", "u-me"));

    expect(text).toContain("participants (2)");
    expect(text).toContain("agent `quartz` (`agent-1`)");
    expect(text).toContain("`Bob` (`u-bob`)");
    expect(text).toContain("BREAKOUT ROOM");
  });

  it("an EMPTY set says the thread is pair-gated, rather than saying nothing", async () => {
    const client = stubClient({
      getChannelThread: vi.fn(async () => ({ ...THREAD, participants: [] })),
    });

    const text = textOf(await opGetThread(client, "general", "thread-1", "u-me"));

    expect(text).toContain("participants: none");
    expect(text).toContain("only the member who opened it");
  });

  it("an unnameable agent still renders by id (the roster fetch fails soft)", async () => {
    const client = stubClient({
      listChannelAgents: vi.fn(async () => {
        throw new Error("roster down");
      }),
      getChannelThread: vi.fn(async () => ({
        ...THREAD,
        participants: [
          { id: "p2", threadId: "thread-1", kind: "agent", userId: null, agentId: "agent-1" },
        ],
      })),
    });

    const text = textOf(await opGetThread(client, "general", "thread-1", "u-me"));

    expect(text).toContain("agent `agent-1`");
  });
});
