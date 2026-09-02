/**
 * `AWAIT_UNNAMED_NOTICE` — the third claim of `channel-addressing-rule.test.ts`,
 * split out here on 2026-09-02 at the §1 500-line cap (that file measured 504
 * once the op-collapse migration annotated its cases; INVARIANTS §1: a file at
 * the cap cannot absorb a comment, so the correction is a split).
 *
 * ⚠ THE SEAM IS SUBJECT, NOT ARITHMETIC, and it is the one the parent file's own
 * docblock already drew. Everything left there is what a WRITE reports about who
 * it reached — `addressed=`, `landed=`, the roster rule. This is what a HOLD
 * says about a page of messages SOMEBODY ELSE wrote, which is a different
 * question with a different failure:
 *
 *   ⚠ "NONE of the messages above is addressed to you … do not answer them" —
 *     the canonical reply here is UNADDRESSED (`channel-post.js › postResult`,
 *     `prompt-framing.js › deliveryCall`), so this tells a requester its own
 *     answer is somebody else's traffic.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";
import { AWAIT_UNNAMED_NOTICE } from "./channel-addressing";
import { opAwait } from "./channel-ops-await";

const ME = "u-me";
const PEER = "u-peer";

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

describe("AWAIT_UNNAMED_NOTICE — a wake that names nobody", () => {
  it("does not tell a waiting agent that its own answer belongs to someone else", () => {
    // ⚠ `postResult` posts a responder's reply with no `toUserId` and
    // `deliveryCall` teaches the delivery call with no `to`, so "nothing here
    // is addressed to you" cannot narrow to "none of this is yours".
    expect(AWAIT_UNNAMED_NOTICE).toContain("a reply here is normally posted UNADDRESSED");
    expect(AWAIT_UNNAMED_NOTICE).toContain("that is your reply");
    expect(AWAIT_UNNAMED_NOTICE).not.toContain("Do not answer them");
    expect(AWAIT_UNNAMED_NOTICE).not.toContain("they are context.");
  });

  it("accounts for threading, which the addressing field cannot express", () => {
    expect(AWAIT_UNNAMED_NOTICE).toContain(
      "THREADED into an exchange you are a party to is for you",
    );
  });

  it("still refuses another member's request", () => {
    expect(AWAIT_UNNAMED_NOTICE).toContain("aimed at another member");
    expect(AWAIT_UNNAMED_NOTICE).toContain("adopt an unaddressed message as a task you were assigned");
  });
});

// ── ...and WHEN it fires, a separate claim ───────────────────────────
//
// ⚠ Premise is "somebody ELSE wrote things and none names you". A predicate
// running over the caller's OWN posts fires on a page holding only the caller's
// own request and tells the agent it does not name them. `excludeAuthor` should
// keep own posts out; this is the second line of defence, because the notice
// must be false-free on whatever it is handed.

describe("AWAIT_UNNAMED_NOTICE — over messages SOMEONE ELSE wrote", () => {
  function awaitClient(messages: Array<Record<string, unknown>>): DoplClient {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    return {
      listChannels: vi.fn(async () => [CHANNEL]),
      awaitChannelMessages: vi.fn(async () => ({ messages, timedOut: false })),
    } as unknown as DoplClient;
  }

  function message(
    seq: number,
    authorUserId: string,
    toUserId?: string,
  ): Record<string, unknown> {
    return {
      id: `m-${seq}`,
      seq,
      channelId: "chan-1",
      authorUserId,
      authorKind: "agent",
      kind: "message",
      body: "the body",
      metadata: toUserId ? { to_user_id: toUserId } : {},
      clientMsgId: null,
      createdAt: "2026-07-31T00:00:00Z",
    };
  }

  async function noticeFor(
    messages: Array<Record<string, unknown>>,
    selfUserId: string | null = ME,
  ): Promise<string> {
    const res = await opAwait(awaitClient(messages), "general", 7, undefined, selfUserId);
    return res.content[0].text;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says NOTHING when every message on the page is the caller's own", async () => {
    const text = await noticeFor([message(8, ME, PEER)]);
    expect(text).not.toContain("NONE of the messages above NAMES you");
  });

  it("still fires when a peer wrote something that names nobody", async () => {
    expect(await noticeFor([message(8, PEER)])).toContain(
      "NONE of the messages above NAMES you",
    );
  });

  it("stays silent when a peer's message DOES name the caller", async () => {
    expect(await noticeFor([message(8, PEER, ME)])).not.toContain(
      "NONE of the messages above NAMES you",
    );
  });

  it("judges the peer's messages alone — the caller's own can't suppress it", async () => {
    // Mixed page — the notice is about theirs; mine changes nothing.
    expect(await noticeFor([message(8, ME, PEER), message(9, PEER)])).toContain(
      "NONE of the messages above NAMES you",
    );
  });

  it("says nothing at all when the caller's own id is unknown", async () => {
    expect(await noticeFor([message(8, PEER)], null)).not.toContain(
      "NONE of the messages above NAMES you",
    );
  });
});
