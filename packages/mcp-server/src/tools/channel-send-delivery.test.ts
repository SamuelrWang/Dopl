/**
 * **`op="send"` — THE ONE RECIPIENT FIELD, AND THE ONE ACK** (slice B8,
 * 2026-09-02; Samuel's rulings B1 and B9).
 *
 * Three claims, and each of them replaced a whole op or a whole param:
 *
 *   1. **`to` GOES OUT AS GIVEN, IN THE UNION FIELD.** It names a member (email
 *      or user id) OR one of the caller's own agents (`@agent-<id>` / `@handle`),
 *      and the SERVER resolves it once at the door. This tool no longer resolves
 *      the member half itself: two resolvers over one field is how a `@handle`
 *      this side cannot see came back as "not a member" instead of the 400 that
 *      lists the live handles.
 *   2. **`delivery=` IS THE ACK, AND IT IS THE ONLY ONE.** Six verdicts, rendered
 *      on the send's own result. It is what the `ping` mailbox row used to be,
 *      which is why that lane could retire rather than be renamed.
 *   3. **AN UNRESOLVED `@name` IS REFUSED.** Never a silent `delivery=none` —
 *      that is the invisible-delivery failure the addressing contract exists to
 *      prevent, and it is worse here than anywhere because the author believes
 *      they addressed somebody.
 *
 * ⚠ **THE REFUSALS ARE MUTATION-VERIFIED.** Each one is driven twice: once with
 * the condition that must refuse, and once with that condition removed, proving
 * the guard fires on the CONDITION rather than on the call shape. A refusal test
 * that only ever sees the failing input passes just as well when the guard is
 * unconditional — which is a different bug wearing the same green tick.
 *
 * ⚠ `channel-` filename prefix, like every other file the parity split-scan and
 * the removed-vocabulary source scan walk.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";

import { registerChannelTool } from "./channel";
import { callTool, stub } from "./narration-fixtures";

const CHANNEL = {
  id: "ch-1",
  workspaceId: "ws-1",
  slug: "eng",
  name: "Eng",
  topic: "",
  visibility: "private" as const,
  createdBy: "u1",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const THREAD = "33333333-3333-4333-8333-333333333333";

const DIRECTORY = {
  getWorkspaceList: async () => [],
  resolveWorkspaceRef: async () => null,
  noWorkspaceError: async () => ({ content: [], isError: true }),
  lockedWorkspaceId: () => null,
};

/** One stored message, with whatever delivery/recipient shape a case needs. */
function message(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "m1",
    seq: 7,
    kind: "message",
    authorUserId: "u1",
    metadata: {},
    recipientUserIds: [],
    recipientAgentIds: [],
    delivery: null,
    deliveryAt: null,
    ...over,
  };
}

function sendStub(post: unknown): DoplClient {
  return stub({
    listChannels: vi.fn(async () => [CHANNEL]),
    getChannel: vi.fn(async () => CHANNEL),
    postChannelMessage: post,
  });
}

async function send(
  client: DoplClient,
  args: Record<string, unknown>,
): Promise<string> {
  return callTool(
    (r, c) => registerChannelTool(r, c, undefined, false, DIRECTORY),
    client,
    "dopl_channel",
    { op: "send", channel: "eng", body: "hello", ...args },
  );
}

// ── 1. the union field ────────────────────────────────────────────────

describe("`to` is ONE field over two namespaces, sent AS GIVEN", () => {
  for (const [what, ref] of [
    ["a member by email", "ada@example.com"],
    ["a member by user id", "22222222-2222-4222-8222-222222222222"],
    ["one of your own agents by handle", "@agent-k3wpf7c5"],
    ["one of your own agents by name", "@builder"],
  ] as const) {
    it(`${what} rides \`to\`, and nothing is resolved client-side`, async () => {
      const post = vi.fn(async () => message({ recipientUserIds: ["u2"] }));
      const listWorkspaceMembers = vi.fn();
      const client = stub({
        listChannels: vi.fn(async () => [CHANNEL]),
        getChannel: vi.fn(async () => CHANNEL),
        postChannelMessage: post,
        listWorkspaceMembers,
      });
      await send(client, { to: ref });
      expect(post.mock.calls[0][1].to).toBe(ref);
      // ⚠ **`toUserId` IS THE SERVER'S TO STAMP, NOT THIS TOOL'S.** A member
      // resolved at the door BECOMES that field before any fence runs, so there
      // is one addressee path and one membership check — sending both is
      // `CHANNEL_CHAT_ADDRESSED`, two answers to one question.
      expect(post.mock.calls[0][1]).not.toHaveProperty("toUserId");
      // ⚠ AND THE ROUND TRIP IS GONE WITH THE RESOLUTION: a send no longer walks
      // the roster to find out who it is talking to.
      expect(listWorkspaceMembers).not.toHaveBeenCalled();
    });
  }

  it("omitted, it sends nothing at all — chat is exactly 'no `to`'", async () => {
    const post = vi.fn(async () => message());
    await send(sendStub(post), {});
    expect(post.mock.calls[0][1].to).toBeUndefined();
  });
});

// ── 2. the delivery matrix ────────────────────────────────────────────

describe("`delivery=` is the ack, and it is the only one", () => {
  // ⚠ ALL SIX VERDICTS, INCLUDING THE TWO A HAPPY PATH NEVER PRODUCES. `refused`
  // and `unreachable` are the ones an orchestrator branches on, and a matrix
  // that only covers the reachable half is a matrix that never sees them.
  for (const verdict of [
    "delivered",
    "woken",
    "idle",
    "unreachable",
    "none",
    "refused",
  ]) {
    it(`renders delivery=${verdict} once the machine has acked`, async () => {
      const out = await send(
        sendStub(
          vi.fn(async () =>
            message({ delivery: verdict, deliveryAt: "2026-09-02T00:00:00Z" }),
          ),
        ),
        { to: "ada@example.com" },
      );
      expect(out).toContain(`delivery=${verdict}`);
      // ⚠ AND WITHOUT THE `?` — the bare word means a machine SAID so.
      expect(out).not.toContain(`delivery=${verdict}?`);
    });
  }

  it("marks the server's write-time PREDICTION with `?` until a machine acks", async () => {
    // ⚠ ONE CHARACTER CARRYING THE WHOLE DISTINCTION (A9). `woken?` is what the
    // server expects to happen; `woken` is what the operator's machine reported.
    // An orchestrator that reads the first as the second waits on a turn that
    // may never have started.
    const out = await send(
      sendStub(vi.fn(async () => message({ delivery: "woken", deliveryAt: null }))),
      { to: "@agent-k3wpf7c5" },
    );
    expect(out).toContain("delivery=woken?");
  });

  it("renders `delivery=-` when the server computes none — absent is not `none`", async () => {
    // ⚠ A deployment older than `20260912120000_channel_delivery_verdict` sends
    // no key. `none` is a VERDICT ("nobody was addressed"); an absent field is
    // the absence of one, and collapsing them would tell a caller nobody was
    // reachable when nobody was asked. ⚠ The fact line spells the absence `-`
    // (`channel-facts.ts › NOT_APPLICABLE`) rather than dropping the column, so
    // the line keeps ONE shape — a result read by a model choosing its next
    // action must not change field count between calls.
    const out = await send(sendStub(vi.fn(async () => message())), {});
    expect(out).toContain("delivery=-");
    expect(out).not.toContain("delivery=none");
  });

  it("hands back the cursor and the thread a follow-up call needs", async () => {
    const out = await send(
      sendStub(vi.fn(async () => message({ seq: 41, metadata: { taskId: THREAD } }))),
      { thread: THREAD },
    );
    expect(out).toContain("seq=41");
    expect(out).toContain(`thread=${THREAD}`);
    expect(out).toContain("landed=thread");
  });

  it("`addressed=` is read off the STORED row, not off the argument", async () => {
    // ⚠ THE ONLY HONEST SOURCE once `to` is resolved server-side over two
    // namespaces: the recipient set the server actually wrote. Reading it back
    // off `opts.to` would report `addressed=yes` for a ref the server resolved
    // to nobody — which is the invisible-delivery shape, restated.
    const resolved = await send(
      sendStub(vi.fn(async () => message({ recipientAgentIds: ["k3wpf7c5"] }))),
      { to: "@agent-k3wpf7c5" },
    );
    expect(resolved).toContain("addressed=yes");
    const nobody = await send(
      sendStub(vi.fn(async () => message({ recipientUserIds: [], recipientAgentIds: [] }))),
      { to: "ada@example.com" },
    );
    expect(nobody).toContain("addressed=no");
  });
});

// ── 3. the refusals, each driven both ways ────────────────────────────

/** A 400 shaped like the route's, carrying one error code. */
function badRequest(code: string, message: string): Error {
  return Object.assign(new Error(message), {
    status: 400,
    code,
    apiMessage: message,
  });
}

describe("the refusals, MUTATION-VERIFIED", () => {
  it("an unresolved `to` is refused with nothing sent — and a resolvable one is not", async () => {
    const refusing = vi.fn(async () => {
      throw badRequest(
        "CHANNEL_RECIPIENT_UNRESOLVED",
        "no member or live agent answers to @nobody; live handles: @builder",
      );
    });
    const refused = await send(sendStub(refusing), { to: "@nobody" });
    expect(refused).toContain("Nothing was sent");
    // ⚠ THE SERVER'S OWN MESSAGE CARRIES THE REMEDY — the live handles and the
    // roster — so the arm adds the one fact that message cannot: no row exists.
    expect(refused).toContain("@builder");
    expect(refused).not.toContain("not a member");

    // MUTATION: the same call, with the condition removed.
    const ok = await send(
      sendStub(vi.fn(async () => message({ recipientAgentIds: ["b1"], delivery: "woken" }))),
      { to: "@builder" },
    );
    expect(ok).toContain("posted");
    expect(ok).not.toContain("Nothing was sent");
  });

  it("a decision body over the card's cap is refused BEFORE the wire — and one under it is sent", async () => {
    const post = vi.fn(async () => message());
    const client = sendStub(post);
    const over = await send(client, {
      kind: "decision",
      summary: "Ship or hold?",
      body: "x".repeat(2001),
      options: [
        { label: "Ship", consequence: "goes out today" },
        { label: "Hold", consequence: "slips a day" },
      ],
    });
    expect(over).toContain("Nothing was posted");
    expect(over).toContain("2001");
    // ⚠ PRE-CALL, so "nothing was posted" is trivially true rather than
    // confusable with a delivery failure.
    expect(post).not.toHaveBeenCalled();

    // MUTATION: one character under the cap goes through.
    const under = await send(client, {
      kind: "decision",
      summary: "Ship or hold?",
      body: "x".repeat(2000),
      options: [
        { label: "Ship", consequence: "goes out today" },
        { label: "Hold", consequence: "slips a day" },
      ],
    });
    expect(under).not.toContain("Nothing was posted");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("a multi-line milestone is refused — and a one-line one is sent", async () => {
    const post = vi.fn(async () => message({ kind: "task_progress" }));
    const client = sendStub(post);
    const over = await send(client, {
      kind: "milestone",
      thread: THREAD,
      body: "step one\nstep two",
    });
    expect(over).toContain("ONE LINE");
    expect(post).not.toHaveBeenCalled();

    const under = await send(client, {
      kind: "milestone",
      thread: THREAD,
      body: "listener wired",
    });
    expect(under).toContain("milestone");
    expect(post).toHaveBeenCalledTimes(1);
    // ⚠ THE KIND IS FIXED AT THE SEAM, never picked by the caller: a milestone
    // stores `task_progress`, and the agent never chooses between two enum
    // values one apart.
    expect(post.mock.calls[0][1].kind).toBe("task_progress");
  });

  it('`thread="new"` needs both `to` and `summary` — and opens the thread once it has them', async () => {
    const createChannelThread = vi.fn(async () => ({
      thread: { id: THREAD, channelId: CHANNEL.id, title: "Wire it" },
      openingSeq: 12,
    }));
    const client = stub({
      listChannels: vi.fn(async () => [CHANNEL]),
      getChannel: vi.fn(async () => CHANNEL),
      listWorkspaceMembers: vi.fn(async () => [
        {
          userId: "u2",
          email: "ada@example.com",
          displayName: "Ada",
          status: "active",
        },
      ]),
      createChannelThread,
    });
    const missing = await send(client, { thread: "new", to: "ada@example.com" });
    expect(missing).toContain("summary");
    expect(createChannelThread).not.toHaveBeenCalled();

    const opened = await send(client, {
      thread: "new",
      to: "ada@example.com",
      summary: "Wire it",
    });
    expect(createChannelThread).toHaveBeenCalledTimes(1);
    // ⚠ `summary` IS THE TITLE on this lane — same field, same cap, same meaning
    // as the one-line intent it carries everywhere else.
    expect(createChannelThread.mock.calls[0][1].title).toBe("Wire it");
    expect(opened).toContain(THREAD);
  });
});
