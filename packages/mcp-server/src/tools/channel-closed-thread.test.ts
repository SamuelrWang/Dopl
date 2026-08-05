/**
 * F6 — CLOSING A THREAD STOPS ITS PASSIVE ROUTING; IT DOES NOT SEAL IT.
 *
 * The write path gated on thread MEMBERSHIP and never on thread STATUS, so a
 * thread closed at #355 accepted #356, #361, #362, #363 and #365 with no refusal
 * and no warning — while THIS tool's close result said "Closed thread <title> …
 * as <outcome>." and stopped, i.e. asserted a finality the server does not
 * enforce. Two halves, both pinned here:
 *
 *  1. the CLOSE result now says what closing really changes (the PASSIVE lane),
 *     and says outright that a later post is still accepted;
 *
 * THE SCOPE OF THAT CLAIM IS ITSELF PINNED, because the first correction
 * overshot: "no session is woken for it any more" is not true either. The
 * desktop skips the passive thread-lane wake off a status cache that lags by up
 * to ~5 minutes, an older build does not skip it at all, and an ADDRESSED post
 * starts its addressee whatever the status is. So both surfaces have to say
 * PASSIVE and have to leave addressing standing.
 *  2. the POST result carries the warning when the server reports the thread was
 *     closed — WARN, NEVER REFUSE. A 403 would break the legitimate "one last
 *     word after the close echo" pattern, and its remedy (reopen) has no op on
 *     this tool, so a refusal would point the agent at something it cannot do.
 *
 * The server half — that `threadClosed` is raised at all, and that the message
 * still lands — is pinned in
 * `src/features/channels/server/service-writes-metadata-closed.test.ts`.
 *
 * `opCloseThread`'s SUMMARY behaviour (Feature 3c) moved here from
 * `channel-ops.test.ts` in the same change — a §2 split at the 500-line cap, on
 * the seam that this file already is: every assertion about a close result now
 * lives in one place instead of two that would have to be re-worded together.
 *
 * DECISION 2 (2026-08-04) RE-TARGETS THE FIRST HALF, and deliberately does not
 * delete it. An agent may no longer CLOSE a thread — closing settles the shared
 * exchange for both members and is its operator's judgment — so the op it
 * reaches is `propose_close`, and every property the close result had to have is
 * a property the PROPOSAL result has to have: the summary is forwarded and
 * echoed, the peer-typed title is a code span under the untrusted header (a
 * thread's TARGET may propose on it, so the title is routinely not the caller's),
 * and the marker seq rides out rather than being guessed. What CHANGED is the
 * claim: the close result had to stop overclaiming finality, and the proposal
 * result has to claim none at all — the thread is untouched and still live.
 *
 * The post-side half (`opPost`'s closed-thread warning) is unchanged: a thread a
 * HUMAN closed still warns a late poster exactly as before.
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
 * A typed propose spy — the generic types `.mock.calls` for arg assertions.
 *
 * `proposeChannelThreadClose` resolves `{ thread, markerSeq, outcome }`: the
 * proposal WRITES the marked note the operator's prompt is rendered from, so it
 * moves the channel's cursor and the caller has to be told where. In the summary
 * describe below `markerSeq` stays null so the confirmation is pinned on its own.
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
    // Q1 (write sweep) carries over unchanged: the peer-typed title is a code
    // span and the result opens with the thread header — a thread's TARGET may
    // propose on it, so this echo routinely renders a title the caller never
    // wrote.
    const text = res.content[0].text;
    expect(text.startsWith(
      `${UNTRUSTED_THREAD_HEADER}\n\nProposed closing thread **\`Ship it\`** in **\`General\`** as failed.`
    )).toBe(true);
    expect(text).toContain("NOTHING IS CLOSED");
    // …and it must not carry a summary note it was given none of: with a
    // summary the outcome is followed by " — <summary>", never by the period.
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
    // THE CORRECTION F6 MADE TO THE CLOSE COPY, taken to its limit: a close had
    // to stop overclaiming finality, and a proposal must claim none. An agent
    // that reads its own proposal as the end of the exchange goes quiet on a
    // thread that is still routing.
    expect(text).toContain("NOTHING IS CLOSED");
    expect(text).toContain("your operator sees this as a prompt and decides");
    expect(text).toContain("the thread is open and fully live");
    expect(text).toContain("keep working the thread and answer it");
    // Propose ONCE: a repeat collapses into the prompt they already have.
    expect(text).toContain("Do not propose again");
    // The marker seq still rides out — never a guessed cursor.
    expect(text).toContain("Proposal note posted at seq 355");
  });

  it("a marker that did not post says so, and says the thread is untouched", async () => {
    // `markerSeq: null` is the honest "no prompt was raised". It must not be
    // silent: the operator has nothing to act on, and the agent would otherwise
    // wait forever on a confirmation nobody was asked for.
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
    // The op stays in the enum so an agent trained on the old surface gets a
    // sentence instead of a zod "invalid enum value" at the moment it most needs
    // telling what to do. It is a PURE refusal — no round-trip at all.
    const res = closeThreadIsHumansToMake();
    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).toContain("Nothing was closed");
    expect(text).toContain("your OPERATOR's decision, not yours");
    expect(text).toContain('op="propose_close"');
    // It must not read as a permission bug the agent can retry around.
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

    // NOT an error: the post landed, and the result has to say that first.
    expect(res.isError).toBeFalsy();
    expect(text).toContain("Posted to **`General`**");
    expect(text).toContain("THAT THREAD IS CLOSED");
    expect(text).toContain("the post landed anyway");
    expect(text).toContain("stops the thread's PASSIVE routing");
    // The warning tells the agent to stop expecting an UNPROMPTED reply, and
    // NOT that the thread has gone silent: the thread still takes posts, and
    // addressing somebody still starts them.
    expect(text).toContain("does NOT stop the thread accepting posts");
    // F-145 — this assertion USED to pin `to_agent="<handle>" starts that
    // agent`, a param deleted in rollback §1. It was not a stale test over dead
    // copy: it was a test HOLDING LIVE COPY IN PLACE that taught an agent to
    // send an argument the SDK accepts and silently drops. Rewritten, not
    // deleted — the sentence still has to say that a close does not sever
    // addressing, it just has to say it with the one address that exists.
    expect(text).toContain('to="<member>" triggers that member\'s machine');
    expect(text).toContain("There is no way to address an agent by name");
    // It points at the action the agent CAN take, and says plainly that the
    // other one is a human's — this tool has no reopen op.
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
    // `@dopl/client` normalizes a missing envelope key to `false`, so this is
    // belt and braces on the render: an absent notice is never a warning.
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
