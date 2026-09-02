/**
 * ⚠ REWRITTEN DOWN, NOT DELETED (INVARIANTS §14), 2026-08-18 — wiring plan
 * Phase 4. This file used to hold the whole close surface: `opProposeClose`'s
 * result claiming NO finality while forwarding its summary and riding its
 * marker seq out; `closeThreadIsHumansToMake()`'s teaching refusal for
 * `close_thread`; and `opPost`'s closed-thread WARNING, which never refused
 * because a 403 would have broken the legitimate "one last word after the close
 * echo" pattern and pointed at a `reopen` this tool never had. All three are
 * deleted with thread closing.
 *
 * WHAT SURVIVES IS THE ABSENCE, and it is worth a file rather than a footnote:
 * the words are what teach, and an agent that reads "closed" anywhere in a
 * result will look for a state change that cannot happen. `channel-law.test.ts ›
 * REMOVED_VOCABULARY` holds the source-wide half (every string literal in every
 * non-test `channel-*.ts`); this holds the RENDERED half — what a real `post`
 * against a legacy `closed` row actually says back.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opPost } from "./channel-ops-write";

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
    listChannelThreads: vi.fn(async () => ({ threads: [], truncated: false })),
    ...overrides,
  } as unknown as DoplClient;
}

/** The stored message a post resolves to. */
function posted() {
  return {
    id: "m1",
    seq: 356,
    kind: "message",
    authorUserId: "u-me",
    metadata: { taskId: THREAD_ID, taskTitle: "Wire the listener" },
  };
}

describe("opPost — a post into a LEGACY closed thread says nothing about it", () => {
  it("reports an ordinary successful post, with no closed-thread warning", async () => {
    const postChannelMessage = vi.fn(async () => posted());
    const client = stubClient({ postChannelMessage });

    const res = await opPost(client, "general", "one last thing", {
      thread: THREAD_ID,
    });
    const text = res.content[0].text;

    expect(res.isError).toBeFalsy();
    // ⚠ AN ORDINARY SUCCESS IS NOW A FACT LINE (T12). "Posted to **`General`**"
    // is gone with the rest of the narration — the channel is a value the caller
    // passed, and echoing it spliced peer-controlled text (`resolveChannelOr`
    // lists PUBLIC channels the caller was never invited to) into every write.
    // What proves the post succeeded is the seq and the landing, which is what a
    // follow-up call actually needs.
    expect(text.startsWith("posted seq=356 ")).toBe(true);
    expect(text).toContain(`thread=${THREAD_ID} landed=thread`);
    // The vocabulary the note carried, pinned as an absence. Each one taught a
    // state transition that no longer exists.
    expect(text).not.toContain("THAT THREAD IS CLOSED");
    expect(text).not.toContain("PASSIVE routing");
    expect(text).not.toMatch(/reopen/i);
    expect(text).not.toMatch(/propose_close|close_thread/);
  });

  it("ignores a `threadClosed` key a stale server might still send", async () => {
    // ⚠ THE FORWARD-COMPATIBILITY HALF. The web deploy and the installed MCP
    // surface do not ship together (INVARIANTS §13 ship order), so a build of
    // this package can meet a server that still answers the retired field. It
    // must be inert data, not a branch: `@dopl/client` no longer reads it and
    // nothing here may start reading it again.
    const postChannelMessage = vi.fn(async () => ({
      ...posted(),
      threadClosed: true,
    }));
    const client = stubClient({ postChannelMessage });

    const res = await opPost(client, "general", "one last thing", {
      thread: THREAD_ID,
    });

    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).not.toContain("THAT THREAD IS CLOSED");
  });

  it("says nothing about thread state on an ordinary untagged post either", async () => {
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
