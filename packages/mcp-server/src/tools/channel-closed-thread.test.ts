/**
 * CLOSING A THREAD STOPS ITS PASSIVE ROUTING; IT DOES NOT SEAL IT. Two halves
 * pinned here:
 *
 *  1. the PROPOSAL result claims NO finality — the thread is untouched and
 *     still live — while forwarding the summary, rendering the peer-typed title
 *     as a code span under the untrusted header (a thread's TARGET may propose,
 *     so the title is routinely not the caller's), and riding the marker seq
 *     out rather than guessing it;
 *  2. the POST result WARNS when the server reports a closed thread, and ⚠ NEVER
 *     REFUSES: a 403 breaks the legitimate "one last word after the close echo"
 *     pattern, and its remedy (reopen) has no op on this tool.
 *
 * ⚠ Scope of the claim is itself pinned: "no session is woken for it any more"
 * is FALSE. The desktop skips the passive thread-lane wake off a status cache
 * lagging up to ~5 min, an older build does not skip it, and an ADDRESSED post
 * starts its addressee whatever the status. Both surfaces must say PASSIVE and
 * leave addressing standing.
 *
 * Server half (`threadClosed` raised at all, message still lands) is pinned in
 * `src/features/channels/server/service-writes-metadata-closed.test.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opPost } from "./channel-ops-write";
import { closeThreadIsHumansToMake, opProposeClose } from "./channel-ops-threads";
import { UNTRUSTED_THREAD_HEADER } from "./channel-render";

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

const THREAD_ID = "79ce5325-f53e-4d00-a1c0-f48875000bc0";

function stubClient(overrides: Record<string, unknown>): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listChannelThreads: vi.fn(async () => []),
    ...overrides,
  } as unknown as DoplClient;
}

/** The stored message a post resolves to, with the F6 notice on it. */
function posted(threadClosed: boolean) {
  return {
    id: "m1",
    seq: 356,
    kind: "message",
    authorUserId: "u-me",
    metadata: { taskId: THREAD_ID, taskTitle: "Wire the listener" },
    threadClosed,
  };
}

/**
 * Typed propose spy — generics type `.mock.calls` for arg assertions. A
 * proposal WRITES the marked note the operator's prompt renders from, so it
 * moves the channel cursor and the caller must be told where.
 */
type ProposeSpy = (
  channelId: string,
  threadId: string,
  input: Record<string, unknown>,
) => Promise<{
  thread: { title: string };
  markerSeq: number | null;
  outcome: string;
}>;

describe("opProposeClose — summary (Feature 3c, re-targeted by DECISION 2)", () => {
  it("forwards `summary` to the client and surfaces it in the confirmation", async () => {
    const proposeChannelThreadClose = vi.fn<ProposeSpy>();
    proposeChannelThreadClose.mockResolvedValue({
      thread: { title: "Ship it" },
      markerSeq: null,
      outcome: "completed",
    });
    const client = stubClient({ proposeChannelThreadClose });

    const res = await opProposeClose(client, "general", "thread-uuid", "completed", "Shipped v2 to prod");

    const [channelId, threadId, input] = proposeChannelThreadClose.mock.calls[0];
    expect(channelId).toBe("chan-1");
    expect(threadId).toBe("thread-uuid");
    expect(input).toEqual({ outcome: "completed", summary: "Shipped v2 to prod" });
    expect(res.content[0].text).toContain("Shipped v2 to prod");
  });

  it("omits the summary note when none is given", async () => {
    const proposeChannelThreadClose = vi.fn<ProposeSpy>();
    proposeChannelThreadClose.mockResolvedValue({
      thread: { title: "Ship it" },
      markerSeq: null,
      outcome: "failed",
    });
    const client = stubClient({ proposeChannelThreadClose });

    const res = await opProposeClose(client, "general", "thread-uuid", "failed");

    const [, , input] = proposeChannelThreadClose.mock.calls[0];
    expect(input).toEqual({ outcome: "failed", summary: undefined });
    // ⚠ Peer-typed title as a code span under the thread header — a thread's
    // TARGET may propose, so this echo routinely renders a title the caller
    // never wrote.
    const text = res.content[0].text;
    expect(text.startsWith(
      `${UNTRUSTED_THREAD_HEADER}\n\nProposed closing thread **\`Ship it\`** in **\`General\`** as failed.`
    )).toBe(true);
    expect(text).toContain("NOTHING IS CLOSED");
    // Must not carry a summary note it was given none of.
    expect(text).not.toContain("as failed — ");
  });
});

describe("opProposeClose — the result claims NO finality at all (DECISION 2)", () => {
  it("says nothing is closed, the thread is still live, and where the marker landed", async () => {
    const proposeChannelThreadClose = vi.fn(async () => ({
      thread: { id: THREAD_ID, title: "Wire the listener" },
      markerSeq: 355,
      outcome: "completed",
    }));
    const client = stubClient({ proposeChannelThreadClose });

    const res = await opProposeClose(client, "general", THREAD_ID, "completed");
    const text = res.content[0].text;

    expect(res.isError).toBeFalsy();
    expect(text).toContain("Proposed closing thread **`Wire the listener`**");
    expect(text).toContain("as completed");
    // ⚠ A proposal must claim NO finality — an agent that reads its own
    // proposal as the end of the exchange goes quiet on a live thread.
    expect(text).toContain("NOTHING IS CLOSED");
    expect(text).toContain("your operator sees this as a prompt and decides");
    expect(text).toContain("the thread is open and fully live");
    expect(text).toContain("keep working the thread and answer what comes in");
    // ⚠ Proposals are RE-RAISABLE after genuine further exchange (key is
    // thread + outcome + activity anchor), so the copy must teach both halves:
    // an idle retry dedupes, a post-conversation proposal is fresh. Pinned
    // negatively too — "Do not propose again" teaches one-shot-forever.
    expect(text).toContain("collapses into the same prompt");
    expect(text).toContain("a fresh proposal is legitimate");
    expect(text).not.toContain("Do not propose again");
    // ⚠ Marker seq rides out — never a guessed cursor.
    expect(text).toContain("Proposal note posted at seq 355");
  });

  it("a marker that did not post says so, and says the thread is untouched", async () => {
    // ⚠ `markerSeq: null` means no prompt was raised, and must not be silent —
    // the agent would wait forever on a confirmation nobody was asked for.
    const proposeChannelThreadClose = vi.fn(async () => ({
      thread: { id: THREAD_ID, title: "Wire the listener" },
      markerSeq: null,
      outcome: "completed",
    }));
    const client = stubClient({ proposeChannelThreadClose });

    const text = (await opProposeClose(client, "general", THREAD_ID, "completed")).content[0].text;
    expect(text).toContain("did NOT post");
    expect(text).toContain("The thread is untouched");
    expect(text).not.toContain("Proposal note posted at seq");
  });
});

describe("close_thread is answered, not removed (DECISION 2)", () => {
  it("refuses without touching the client, and names propose_close", async () => {
    // ⚠ PURE refusal — no round-trip at all.
    const res = closeThreadIsHumansToMake();
    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).toContain("Nothing was closed");
    expect(text).toContain("your OPERATOR's decision, not yours");
    expect(text).toContain('op="propose_close"');
    expect(text).toContain("the thread stays open and fully live");
  });
});

describe("opPost — the closed-thread warning (F6)", () => {
  it("returns the warning when the server reports the thread was closed", async () => {
    const postChannelMessage = vi.fn(async () => posted(true));
    const client = stubClient({ postChannelMessage });

    const res = await opPost(client, "general", "one last thing", {
      thread: THREAD_ID,
    });
    const text = res.content[0].text;

    // ⚠ NOT an error — the post landed, and the result says that first.
    expect(res.isError).toBeFalsy();
    expect(text).toContain("Posted to **`General`**");
    expect(text).toContain("THAT THREAD IS CLOSED");
    expect(text).toContain("the post landed anyway");
    expect(text).toContain("stops the thread's PASSIVE routing");
    // ⚠ Warning means "stop expecting an UNPROMPTED reply", not "the thread is
    // silent" — it still takes posts, and addressing still starts someone.
    expect(text).toContain("does NOT stop the thread accepting posts");
    // ⚠ Pins that a close does not sever addressing, stated with the ONE
    // address that exists — a removed param pinned here holds live copy in
    // place that teaches an argument the SDK accepts and silently drops.
    expect(text).toContain('to="<member>" triggers that member\'s machine');
    expect(text).toContain("There is no way to address an agent by name");
    // ⚠ Points at the action the agent CAN take — this tool has no reopen op.
    expect(text).toContain('dopl_channel(op="create_thread", channel="chan-1"');
    expect(text).toContain("this tool has no reopen op");
  });

  it("says nothing at all when the thread is open", async () => {
    const postChannelMessage = vi.fn(async () => posted(false));
    const client = stubClient({ postChannelMessage });

    const res = await opPost(client, "general", "still working", {
      thread: THREAD_ID,
    });

    expect(res.content[0].text).not.toContain("THAT THREAD IS CLOSED");
  });

  it("says nothing when the field is absent (an older deployment)", async () => {
    // Belt and braces: `@dopl/client` normalizes a missing key to `false`.
    const postChannelMessage = vi.fn(async () => ({
      id: "m1",
      seq: 12,
      kind: "message",
      authorUserId: "u-me",
      metadata: {},
    }));
    const client = stubClient({ postChannelMessage });

    const res = await opPost(client, "general", "hello");

    expect(res.content[0].text).not.toContain("THAT THREAD IS CLOSED");
  });
});
