/**
 * WHAT THE WRITE OPS TELL AN AGENT TO DO NEXT — the FACTS an `op="send"` /
 * `op="send" thread="new"` leaves in the agent's context. Two ways it sends the
 * agent somewhere it cannot go:
 *
 *   ⚠ Offering the CHANNEL's open threads in the not-threaded warning. A thread
 *     accepts writes only from its creator or target (`resolvePostMetadata`
 *     403s the rest), so that is a burned operator approval plus two agent
 *     turns per unthreaded post, and other pairs' titles in the caller's context.
 *
 * ⚠ HALF THIS FILE IS A "MOVED, NOT DELETED" GUARD (T10/T12, 2026-09-02). A post
 * used to close with up to five standing paragraphs; they are stated once in
 * `channel-doctrine.ts` and the result is one line of `key=value` facts. Every
 * case that pinned one asserts BOTH halves — out of the RESULT, still in the
 * PRODUCT — so the prose can neither grow back nor quietly vanish.
 *
 * ⚠ THE 400-CLASSIFICATION HALF (the Q9 blocks) MOVED to
 * `channel-post-guidance-refusals.test.ts` on 2026-09-02, at the §1 cap. Same
 * subject seam this file was already cut on once: a SUCCESSFUL write's facts
 * stay here, why an unsuccessful one came back is over there.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opPost } from "./channel-ops-write";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { registerChannelTool } from "./channel";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import type { RegisterTool } from "./respond";

const CHANNEL = { id: "chan-1", slug: "eng", name: "eng", visibility: "private" };
const BOB = { userId: "u-bob", email: "bob@x.com", displayName: "Bob", status: "active" };

function stubClient(overrides: Record<string, unknown>): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listWorkspaceMembers: vi.fn(async () => [BOB]),
    ...overrides,
  } as unknown as DoplClient;
}

/**
 * Q13 · THE NOT-THREADED NOTE IS GONE, AND SO IS THE READ IT PAID FOR (T10).
 *
 * ⚠ THE DEFECT THIS BLOCK GUARDS IS NOW STRUCTURALLY IMPOSSIBLE, which beats the
 * filter it used to pin. `threadLinkageNote` made a SECOND API call per post
 * (`listChannelThreads`) to offer threads the caller might have meant, and the
 * filter existed so the offer could not name one the caller would be 403'd out
 * of — leaking other pairs' ids and titles on the way. No offer: nothing to
 * filter, nothing to leak, ONE round trip.
 *
 * ⚠ WHAT THE OFFER ANSWERED IS NOT GONE: "did this thread?" is `landed=`, which
 * still catches a silent tag drop; the pair-only write gate is doctrine;
 * `op="rooms" action="threads"` finds an id. All three pinned below.
 */
describe("Q13 · the not-threaded note, and the round-trip it cost", () => {
  const ME = "u-me";
  const thread = (id: string, createdBy: string, targetUserId: string) =>
    ({ id, title: `T ${id}`, status: "open", createdBy, targetUserId });
  const listThreads = vi.fn(async () => ({ threads: [] as unknown[], truncated: false }));

  /** A successful post with no thread, in a channel holding `threads`. */
  async function noteFor(
    threads: Array<Record<string, unknown>>, authorUserId: string | null = ME,
  ): Promise<string> {
    listThreads.mockClear();
    listThreads.mockResolvedValue({ threads, truncated: false });
    const res = await opPost(stubClient({
      postChannelMessage: vi.fn(async () => ({
        id: "m1", seq: 9, kind: "message", metadata: {}, authorUserId,
      })),
      listChannelThreads: listThreads,
    }), "eng", "here is the answer", {});
    expect(res.isError).toBeFalsy();
    return res.content[0].text;
  }

  it("names NO thread, and pays for no second read to find one", async () => {
    // ⚠ THE FACT SURVIVED THE PARAGRAPH: `landed=room` is the whole of "NOT
    // THREADED", read off the STORED message rather than the request. The
    // caller's OWN writable thread is not offered either — the offer is what the
    // extra request bought, and the request is gone.
    const text = await noteFor([
      thread("t-mine", ME, "u-b"),
      thread("t-cd", "u-c", "u-d"),
      thread("t-ce", "u-c", "u-e"),
    ]);
    expect(text).toContain("landed=room");
    expect(text).not.toContain("NOT THREADED");
    expect(text).not.toContain("t-mine");
    expect(text).not.toContain('re-post it with thread="<that id>"');
    expect(listThreads).not.toHaveBeenCalled();
  });

  it("leaks no thread the caller is only the TARGET of, either", async () => {
    // ⚠ The old filter counted BOTH provenances (opened-by-me and addressed-to-me)
    // so the offer could not name an unwritable thread. Neither reaches the
    // result now; the provenance question is `op="rooms" action="threads"`'s.
    const text = await noteFor([thread("t-for-me", "u-c", ME)]);
    expect(text).not.toContain("t-for-me");
    expect(text).toContain("landed=room");
  });

  it("⚠ NEVER PUTS ANOTHER PAIR'S IDS OR TITLES IN THE CALLER'S CONTEXT", async () => {
    // ⚠ THE PRIVACY HALF, NOW UNCONDITIONAL RATHER THAN FILTERED. An offer naming
    // somebody else's exchange was a burned operator approval plus two agent
    // turns, and its titles were peer-typed text nobody asked for. The RULE the
    // filter mirrored is standing doctrine, stated once.
    const text = await noteFor([thread("t-cd", "u-c", "u-d"), thread("t-ce", "u-c", "u-e")]);
    expect(text).not.toContain("t-cd");
    expect(text).not.toContain("t-ce");
    expect(text).not.toContain("they belong to other members");
    expect(CHANNEL_DOCTRINE).toContain(
      // ⚠ PUNCTUATION DRIFT FROM THE DOCTRINE REWRITE, not a moved rule: the
      // sentence reads "…post into it; a third member's post is refused" now.
      // Same claim, same section, re-pointed at the shipped wording.
      "Only those two can post into it; a third member's post is refused",
    );
  });

  it("stays terse when the channel has no threads at all", async () => {
    const text = await noteFor([]);
    expect(text).not.toContain("NOT THREADED");
    expect(text.split("\n")).toHaveLength(1);
  });

  // ⚠ INVERTED 2026-08-18 (wiring plan Phase 4), then RETIRED 2026-09-02. This
  // case passed a LEGACY `closed` row: first asserting the note stayed silent (a
  // `status === "open"` filter), then that it WAS offered (threads do not close,
  // so withholding the caller's own postable exchange was the failure). No row of
  // any status is offered now — the whole lookup is gone.
  it("offers no LEGACY closed thread of the caller's own either", async () => {
    const text = await noteFor([{ ...thread("t-old", ME, "u-b"), status: "closed" }]);
    expect(text).toContain("landed=room");
    expect(text).not.toContain("t-old");
  });

  it("says the same thing when the post carries no author to check against", async () => {
    // ⚠ Unreachable through the route (it stamps author_user_id = ctx.userId).
    // The filter had to fail CLOSED rather than "offer them all"; with no offer
    // the missing author changes nothing, which is the strongest form of failing
    // closed. ⚠ And the REMEDY moved rather than disappearing — one call finds a
    // thread id, stated where the protocol is, not under every unthreaded post.
    const text = await noteFor([thread("t-mine", ME, "u-b")], null);
    expect(text).toContain("landed=room");
    expect(text).not.toContain("t-mine");
    // ⚠ RE-POINTED AT THE SURFACE THAT CARRIES IT (B8). The remedy is one call,
    // and the doctrine stopped SPELLING calls it can point at — `op="rooms"`
    // owns the place, and the action that finds a thread id is published on the
    // shape the agent is filling in. The join is unbroken: delete the action and
    // there is no way to find an id; delete the rooms section and nothing says
    // where to look.
    expect(CHANNEL_DOCTRINE).toContain('op="rooms" — WHAT THIS PLACE IS');
    expect(CHANNEL_INPUT_SHAPE.action.description).toContain('"threads"');
    expect(CHANNEL_INPUT_SHAPE.action.safeParse("threads").success).toBe(true);
  });
});

/**
 * Phase 11 — THE TWO CAPABILITIES, TAUGHT ONCE AND REPORTED PER CALL. ⚠ Driven
 * through `opPost` rather than against exported strings: a constant nobody
 * splices teaches nothing, and the bug this guards is the wiring going missing,
 * not the wording changing (INVARIANTS §14).
 *
 * ⚠ T12 SPLIT EVERY CASE HERE IN TWO. What the result TAUGHT was standing
 * doctrine (the sparseness bar, what a tag is for, the five causes); what it
 * REPORTED was the server's own resolution. Each case pins the token on the
 * result and the sentence in the doctrine.
 */
/**
 * A post that landed WHERE `taskId` says, with `mentions` as the SERVER stamped
 * them — the point of `tags=` is that it reads the server's resolution, not the
 * request. ⚠ ONE helper for both blocks below: two copies of a stub is how two
 * blocks stop testing the same op.
 */
async function resultOf(
  body: string, taskId?: string, mentions?: unknown,
): Promise<string> {
  const client = stubClient({
    postChannelMessage: vi.fn(async () => ({
      id: "m1", seq: 9, kind: "message", authorUserId: "u-me",
      metadata: {
        ...(taskId ? { taskId } : {}),
        ...(mentions === undefined ? {} : { mentionedUserIds: mentions }),
      },
    })),
  });
  const res = await opPost(client, "eng", body, {
    ...(taskId ? { thread: taskId } : {}),
  });
  expect(res.isError).toBeFalsy();
  return res.content[0].text;
}

describe("P11 · what a post's result teaches about what to do NEXT", () => {
  const THREAD = "44444444-4444-4444-4444-444444444444";

  it("a MAIN-ROOM post reports WHERE it landed; the sparseness bar is stated once", async () => {
    // ⚠ The bar must apply to the agent's OWN next turn. "Be sparse" does not; a
    // rule keyed on what it has already done in this run does — and that is
    // checkable by the agent, not the server, so it reads identically in the
    // doctrine and is read there ONCE rather than under every room post.
    const text = await resultOf("the room should know the migration is applied");
    expect(text).toContain("landed=room");
    expect(text).not.toContain("POSTED TO THE ROOM ITSELF");
    // ⚠ **PIN RETIRED: the CONCRETE per-run bar is deleted BY RULING** — wave B
    // §4 (`docs/specs/mcp-v2-wave-b.md:280`) cuts the encouragement prose. The
    // CAPABILITY and its LIMIT survive in the LAW, which is the half that was
    // ever checkable: the bar asked the agent to audit its own run, and what
    // ships now states the permission and bounds it in one clause.
    expect(CHANNEL_DOCTRINE).toContain(
      "You MAY also post to the main room unprompted, SPARSELY",
    );
    expect(CHANNEL_DOCTRINE).toContain("that is a capability, not a habit");
  });

  it("…and NOT the tagging line — the result carries facts, not advice", async () => {
    const text = await resultOf("a room-wide heads-up");
    expect(text).not.toContain("NOBODY IS TAGGED IN THIS POST");
    expect(text.split("\n")).toHaveLength(1);
  });

  it("a THREADED post that tagged nobody says so in two tokens", async () => {
    // ⚠ WHAT A TAG IS FOR is doctrine and every clause survives there. Never a
    // notification promise — the gating is the desktop's (Phase 7) and ships in a
    // separate build, so this package states the INBOX and the direction of
    // travel and no more — and a tag may not read as a second way to ask for a
    // machine.
    const text = await resultOf("here is the draft", THREAD);
    expect(text).toContain("landed=thread");
    expect(text).toContain("tags=-");
    expect(text).not.toContain("NOBODY IS TAGGED IN THIS POST");
    expect(CHANNEL_DOCTRINE).toContain("Tags inbox");
    // ⚠ **PIN RETIRED: the notification-roadmap hedge is deleted BY RULING**
    // (wave B §4) — "the product's direction is" was a promise about a build
    // that had not shipped, and the doctrine carries contracts only. Its
    // load-bearing half is the one below, and it is unchanged: a tag may not
    // read as a second way to ask for a machine.
    expect(CHANNEL_DOCTRINE).not.toContain("the product's direction is");
    // ⚠ RE-POINTED: same claim, the LAW's wording.
    expect(CHANNEL_DOCTRINE).toContain("Tagging is not addressing and starts no agent");
  });

  it("drops the when-to-tag advice once the body carries a tag, and REPORTS instead", async () => {
    const text = await resultOf("@diana confirm the cutover window", THREAD, ["u-diana"]);
    expect(text).not.toContain("NOBODY IS TAGGED IN THIS POST");
    expect(text).toContain("tags=1/1");
  });

  it("reads the tag the way the SERVER's parser does — mid-word `@` counts", async () => {
    // ⚠ `lib/mentions.ts › MENTION_TOKEN_RE` has no leading-boundary rule, so
    // `ops@dopl` is a token to the resolver. Reporting `tags=-` over a body the
    // server reads as a tag is the disagreement this mirrors away.
    const text = await resultOf("mail went to ops@dopl.example", THREAD);
    expect(text).toContain("tags=0/1");
    expect(text).not.toContain("tags=-");
  });

  it("CATCHES THE SILENT FAILURE: an `@` the server resolved to nobody", async () => {
    // ⚠ Why this reads the STAMP and not the body: a misspelled handle posts
    // fine, reaches nobody's inbox, and without the token the agent believes it
    // escalated (INVARIANTS §10). `0/1` is the VERDICT and may never be traded.
    const text = await resultOf("@dia can you decide this", THREAD);
    expect(text).toContain("tags=0/1");
    // ⚠ The five causes and the roster remedy left with the paragraph — one
    // `op="rooms" action="help"` away, pinned there, hedge included: an old server that stamps
    // nothing is indistinguishable from here (INVARIANTS §13), so nothing may
    // assert a delivery failure it cannot prove.
    expect(text).not.toContain("YOUR `@` TAG RESOLVED TO NOBODY");
    // ⚠ RE-POINTED: the remedy names the ROSTER rather than the op that reads
    // it (`op="members"` is `op="rooms" action="members"`), and it still
    // enumerates (2), (3) and (4) BY NUMBER so cause (5) cannot be swept into a
    // repair that would waste the turn.
    expect(CHANNEL_DOCTRINE).toContain("For (2), (3) and (4), check the roster");
    // ⚠ **PIN RETIRED: the old-server hedge is deleted BY RULING** (wave B §4).
    // What INVARIANTS §13 forbids is asserted in its load-bearing direction —
    // nothing in the list claims a delivery failure it cannot prove — in
    // `channel-zero-tag.test.ts`, which owns the copy of this text.
    expect(CHANNEL_DOCTRINE).not.toContain("looks identical from here");
  });

  it("counts the SERVER's set, and a junk value counts as none rather than as trust", async () => {
    expect(await resultOf("@a @b hi", THREAD, ["u-1", "u-2"])).toContain("tags=2/2");
    expect(await resultOf("@a hi", THREAD, "u-1")).toContain("tags=0/1");
    expect(await resultOf("@a hi", THREAD, [7, "u-1"])).toContain("tags=1/1");
  });

  it("the DESCRIPTION's promise about the result is one the result keeps", () => {
    // ⚠ A JOIN, not a prose pin. The description used to send the agent to the
    // post's result for whether a tag resolved ("READ THE POST'S RESULT"); it now
    // makes that promise generally — results report only what the call DID —
    // which is worthless if the tag verdict is not in there. Delete either end
    // and the other becomes a confident lie.
    let described = "";
    const cap: RegisterTool = ((name: string, d: string) => {
      if (name === "dopl_channel") described = d;
    }) as RegisterTool;
    registerChannelTool(cap, {} as DoplClient);
    expect(described).toContain("Results report only what the call DID");
    expect(described).toContain('action="help"');
  });

  it("a tagged MAIN-ROOM post reports the tag AND where it landed, nothing more", async () => {
    // ⚠ Two different LANES once — a report on this call, and standing advice
    // about the next — and keeping the advice off a post that had already tagged
    // somebody took a branch. Two fields on one line cannot get that branch wrong.
    const text = await resultOf("@diana the migration is applied", undefined, ["u-diana"]);
    expect(text).toContain("tags=1/1");
    expect(text).toContain("landed=room");
    expect(text).not.toContain("NOBODY IS TAGGED IN THIS POST");
    expect(text).not.toContain("POSTED TO THE ROOM ITSELF");
  });
});

/**
 * WHAT A CHAT POST'S RESULT CLAIMS ABOUT WHO GOT IT (2026-08-22).
 *
 * ⚠ The `intent:"chat"` branch of the since-deleted `channel-post-notes` module
 * returned EARLY and never read `landedThread`, so a threaded chat post was
 * told "no agent was put in front of it" — while `channel-addressing.ts` fact 3
 * says a uuid thread tag is handed straight into the counterparty's running turn,
 * addressing unread.
 *
 * ⚠ **A CHAT POST IS NOW SIMPLY A POST WITH NO `to` (C12, 2026-09-02)**, and
 * `intent=` left the result line with the param — it could only restate
 * `addressed=no`, and two fields for one fact is what let them disagree.
 */
describe("chat + a thread tag — the branch that never read landedThread", () => {
  const THREAD = "44444444-4444-4444-4444-444444444444";
  const LEGACY = "task-dba90694-de4f-4950-83a9-f2d890c9ff3f-345";

  const chatResult = (taskId?: string) => resultOf("thinking out loud", taskId);

  it("an UNTHREADED chat post reports BOTH halves — chat, and room", async () => {
    // CONTROL: the original claim is right for the case it was written for and
    // must not be talked into becoming a request. ⚠ `addressed=no` is now the
    // whole of it — with `intent` deleted, "chat" IS "no `to`", so a deliberate
    // chat and a forgotten `to` are the same call and the surface no longer
    // offers a second field to claim otherwise.
    const text = await chatResult();
    expect(text).toContain("landed=room");
    expect(text).toContain("addressed=no");
    expect(text).not.toContain("no agent was put in front of it");
    expect(CHANNEL_DOCTRINE).toContain("addressing nobody and starting nobody");
  });

  it("a THREADED chat post is NOT reported as having reached nobody", async () => {
    // ⚠ `landed` is read off the STORED message and `addressed` off what the
    // server was given, so the two cannot collapse into one verdict the way the
    // early-returning `intent:"chat"` branch did.
    const text = await chatResult(THREAD);
    expect(text).toContain("landed=thread");
    expect(text).not.toContain("no agent was put in front of it");
    expect(text).not.toContain("CHAT, BUT THREADED");
  });

  it("…and it is handed a cursor rather than told to repeat itself as a request", async () => {
    // ⚠ The cost of the old line: an agent that believes nothing landed repeats
    // itself as a request, against work already running. `await=` is that remedy
    // pre-computed off this write's own seq — a stronger instruction than a
    // paragraph telling the reader to go and find one.
    const text = await chatResult(THREAD);
    expect(text).toContain("await=since:9");
    expect(text).not.toContain("do NOT repeat it as a request");
    // ⚠ RE-POINTED: `THE LOOP:` was the AWAITING block's heading, deleted by
    // ruling (wave B §4, `docs/specs/mcp-v2-wave-b.md:280`). The loop's one
    // surviving contract — re-arm from the seq you were handed, stop when the
    // exchange is done — is what makes the cursor on this result usable, which
    // is exactly what this case pairs it with.
    expect(CHANNEL_DOCTRINE).toContain(
      "Re-arm from the highest seq you were handed and stop when the exchange is done",
    );
  });

  it("a LEGACY tag is AD-HOC — it groups on a card and wakes nobody", async () => {
    // ⚠ Same predicate the non-chat path uses (`isFirstClassThreadId`): only a
    // uuid id reaches a session. A `task-…` label routes nothing, and `adhoc`
    // says so without guessing at the remedy.
    const text = await chatResult(LEGACY);
    expect(text).toContain("landed=adhoc");
    expect(text).not.toContain("landed=thread");
  });
});

/**
 * ⚠ THE ZERO-TAG DIAGNOSTIC IS IN `channel-zero-tag.test.ts` (split 2026-08-24 at
 * the 500-line cap, so the fifth cause could arrive with its incident attached).
 * The seam is SUBJECT: everything here drives `opPost` / `opCreateThread` and
 * asserts what a WRITE leaves in the agent's context; that file asserts the COPY
 * of the standing text — now `channel-doctrine.ts` — and drives no client.
 */
