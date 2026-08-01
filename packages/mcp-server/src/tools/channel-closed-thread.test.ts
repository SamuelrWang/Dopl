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
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opPost } from "./channel-ops-write";
import { opCloseThread } from "./channel-ops-threads";
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
 * A typed close spy — the generic types `.mock.calls` for arg assertions.
 *
 * `closeChannelThread` resolves `{ thread, echoSeq }`, not the thread: closing
 * WRITES the task_finished / task_failed marker, so it moves the channel's
 * cursor and the caller has to be told where. The echo line itself is pinned in
 * `channel-thread-scope.test.ts`; in the summary describe below `echoSeq` stays
 * null so the confirmation is pinned on its own.
 */
type CloseSpy = (
  channelId: string,
  threadId: string,
  input: Record<string, unknown>,
) => Promise<{
  thread: { title: string; outcome: string };
  echoSeq: number | null;
}>;

describe("opCloseThread — summary (Feature 3c)", () => {
  it("forwards `summary` to the client and surfaces it in the confirmation", async () => {
    const closeChannelThread = vi.fn<CloseSpy>();
    closeChannelThread.mockResolvedValue({
      thread: { title: "Ship it", outcome: "completed" },
      echoSeq: null,
    });
    const client = stubClient({ closeChannelThread });

    const res = await opCloseThread(client, "general", "thread-uuid", "completed", "Shipped v2 to prod");

    const [channelId, threadId, input] = closeChannelThread.mock.calls[0];
    expect(channelId).toBe("chan-1");
    expect(threadId).toBe("thread-uuid");
    expect(input).toEqual({ outcome: "completed", summary: "Shipped v2 to prod" });
    expect(res.content[0].text).toContain("Shipped v2 to prod");
  });

  it("omits the summary note when none is given", async () => {
    const closeChannelThread = vi.fn<CloseSpy>();
    closeChannelThread.mockResolvedValue({
      thread: { title: "Ship it", outcome: "failed" },
      echoSeq: null,
    });
    const client = stubClient({ closeChannelThread });

    const res = await opCloseThread(client, "general", "thread-uuid", "failed");

    const [, , input] = closeChannelThread.mock.calls[0];
    expect(input).toEqual({ outcome: "failed", summary: undefined });
    // Q1 (write sweep): the peer-typed title is a code span and the result now
    // opens with the thread header — a thread's TARGET may close it, so this
    // echo routinely renders a title the caller never wrote.
    //
    // F6 — the sentence CONTINUES past the outcome now, and what it adds is the
    // point: the old full stop after "as failed." asserted a finality the server
    // does not enforce (the post path never reads thread status, so a closed
    // thread goes on accepting posts). Pinned as a prefix + the routing claim,
    // rather than as the whole paragraph, so re-wording the teaching does not
    // fail a test about the confirmation.
    const text = res.content[0].text;
    expect(text.startsWith(
      `${UNTRUSTED_THREAD_HEADER}\n\nClosed thread **\`Ship it\`** in **\`General\`** as failed.`
    )).toBe(true);
    expect(text).toContain("stops the thread's PASSIVE routing");
    expect(text).toContain("does NOT seal it");
    // …and it must not carry a summary note it was given none of: with a
    // summary the outcome is followed by " — <summary>", never by the period.
    expect(text).not.toContain("as failed — ");
  });
});

describe("opCloseThread — the close result stops claiming finality (F6)", () => {
  it("says the thread stops PASSIVE routing, and that a later post still lands", async () => {
    const closeChannelThread = vi.fn(async () => ({
      thread: { id: THREAD_ID, title: "Wire the listener", outcome: "completed" },
      echoSeq: 355,
    }));
    const client = stubClient({ closeChannelThread });

    const res = await opCloseThread(client, "general", THREAD_ID, "completed");
    const text = res.content[0].text;

    expect(res.isError).toBeFalsy();
    // The confirmation itself is unchanged…
    expect(text).toContain("Closed thread **`Wire the listener`**");
    expect(text).toContain("as completed");
    // …and what follows it is the correction: passive routing, not sealing.
    expect(text).toContain("stops the thread's PASSIVE routing");
    expect(text).toContain("does NOT seal it");
    expect(text).toContain("still accepts posts");
    // The claim is SCOPED: it must not promise a silence nothing enforces, so
    // direct addressing is left standing in the same breath.
    expect(text).toContain("address directly still hears you");
    // And the one action the agent cannot take here is named as a human's.
    expect(text).toContain("Reopening is a human's action in the web app");
    // The echo seq still rides out — never a guessed cursor.
    expect(text).toContain("Close echo posted at seq 355");
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
    expect(text).toContain('to_agent="<handle>" starts that agent');
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
