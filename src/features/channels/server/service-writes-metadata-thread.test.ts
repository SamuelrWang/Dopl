/**
 * THREAD PARTICIPATION on a post — both id shapes, plus the calm-terminal flags
 * riding on the same decision.
 *
 * ⚠ A stamped `metadata.threadId` puts a message inside a thread's card AND routes
 * it to the responder's session window, and every channel member can SEE every
 * thread id (reads are channel-transparent by design). Ungated, the legacy
 * `thread-{channelId}-{seq}` shape lets a third member stamp another pair's
 * exchange, land a message in their card, or flip its outcome via a lifecycle
 * kind.
 *
 * ⚠ The rule: VALIDATE VIA THE OPENER, STRIP ON FAIL, NEVER 403. A legacy id is
 * checked against its opening request's {author, to_user_id} pair; a caller
 * outside that pair loses the TAG, not the message. Strip rather than the UUID
 * branch's 403 is wire compat — installed desktops post these ids, some against
 * openers carrying no addressee at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-sessions");
vi.mock("./repository-messages");
vi.mock("./repository-threads");

// ⚠ `repoMessages` and `repoThreads` are still named HERE because the cases below assert on them
// directly; `repo` and `repoSessions` are only FILLED IN, which now happens in the fixtures, so
// naming them here would be an unused import. The four `vi.mock` calls above still cover all
// four — they are hoisted per module graph and must stay in this file.
import * as repoMessages from "./repository-messages";
import * as repoThreads from "./repository-threads";
import { ThreadForbiddenError } from "./errors";
import { postMessage } from "./service-writes";
// ⚠ THE FIXTURE LAYER MOVED, NOT A SINGLE CASE (§2 split, 2026-10-11): this file reached 567
// lines against a 500-line `error` cap. All 23 cases are still here — a cap-driven split of a
// test file risks dropping one in transit, so what left is the layer that cannot be dropped
// silently. `vi.mock` stays above, hoisted per module graph. Same shape as
// `_service-writes-metadata-escalation-fixtures.ts`, which split on this cap on 2026-09-14.
import {
  USER,
  PEER,
  THIRD,
  THREAD_ID,
  LEGACY_ID,
  ctx,
  desktopCtx,
  threadRow,
  opener,
  capturedMetadata,
  has,
  installThreadMocks,
} from "./_service-writes-metadata-thread-fixtures";

beforeEach(installThreadMocks);

describe("postMessage — legacy thread tag, kept for the exchange's own pair", () => {
  it("keeps the tag for the ADDRESSEE of the opening request (the responder's reply)", async () => {
    await postMessage(ctx, "dm", { body: "on it", metadata: { threadId: LEGACY_ID } });

    expect(capturedMetadata().threadId).toBe(LEGACY_ID);
    expect(repoMessages.findMessageBySeq).toHaveBeenCalledWith("chan-1", 7);
    // No thread row exists for a legacy id, so none of the four server-stamped
    // thread keys appear — a titleless legacy card is the tell.
    expect(has(capturedMetadata(), "threadTitle")).toBe(false);
  });

  it("keeps the tag for the AUTHOR of the opening request (the requester's follow-up)", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: USER, metadata: { to_user_id: THIRD } })
    );

    await postMessage(ctx, "dm", {
      body: "any progress?",
      metadata: { threadId: LEGACY_ID },
    });

    expect(capturedMetadata().threadId).toBe(LEGACY_ID);
  });

  it("keeps it on a LIFECYCLE post — the compat case the strip exists to protect", async () => {
    // ⚠ Installed desktops post legacy ids for thread_started/finished/failed and
    // must keep threading — which is why the gate strips instead of 403ing.
    await postMessage(desktopCtx, "dm", {
      body: "Session ended",
      kind: "thread_finished",
      metadata: { threadId: LEGACY_ID },
    });

    expect(capturedMetadata().threadId).toBe(LEGACY_ID);
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });
});

describe("postMessage — legacy thread tag, STRIPPED for everyone else (Q10)", () => {
  /** Every strip case must still deliver the message, untagged. */
  async function expectStripped(threadId: string, body = "landing elsewhere") {
    // Usage data only — mockClear, not mockReset, so a case may assert over
    // several ids in a row.
    vi.mocked(repoMessages.insertMessage).mockClear();

    await postMessage(ctx, "dm", { body, metadata: { threadId } });

    const meta = capturedMetadata();
    expect(has(meta, "threadId")).toBe(false);
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
    return meta;
  }

  it("SECURITY: a third member cannot stamp another pair's exchange", async () => {
    // The forgery: C posts `thread_failed` carrying A-and-B's legacy id, landing
    // in their card and flipping their session status.
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: PEER, metadata: { to_user_id: THIRD } })
    );

    await expectStripped(LEGACY_ID, "not my thread");
  });

  it("strips an id that names ANOTHER channel, without touching the DB", async () => {
    await expectStripped("thread-chan-2-7");
    await expectStripped(`thread-${THREAD_ID}-7`);

    // ⚠ Prefix mismatch decided from the id ALONE — a foreign id can never probe
    // this channel's seq space.
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("strips a malformed seq and a tag that is not a legacy id at all", async () => {
    for (const bad of [
      "thread-chan-1-abc",
      "thread-chan-1-",
      "thread-chan-1-0", // seqs start at 1
      "thread-chan-1--3",
      "thread-chan-1-7.5",
      "thread-chan-1-99999999999999999999", // past integer precision
      "eng-thread", // a plain typo used to report "THREADED"
    ]) {
      await expectStripped(bad);
    }
    // The shape decides — no read.
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("SECURITY: fails closed when the opener is missing", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(null);

    await expectStripped(LEGACY_ID);
  });

  it("SECURITY: fails closed when the opener is UNADDRESSED and someone else wrote it", async () => {
    // Old row with no `to_user_id` — the only known party is its author.
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: PEER, metadata: {} })
    );

    await expectStripped(LEGACY_ID);
  });

  it("strips a blank / non-string tag rather than storing it", async () => {
    await postMessage(ctx, "dm", { body: "hi", metadata: { threadId: "   " } });

    expect(has(capturedMetadata(), "threadId")).toBe(false);
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("a stripped tag does not disturb the rest of the fold", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: PEER, metadata: { to_user_id: THIRD } })
    );
    vi.mocked(repoMessages.insertMessage).mockClear();

    // ⚠ Addressed explicitly: with DM auto-address retired, `to_user_id` here
    // proves the VALIDATED field survived the strip beside a refused tag.
    await postMessage(ctx, "dm", {
      body: "landing elsewhere",
      toUserId: PEER,
      metadata: { threadId: LEGACY_ID },
    });

    const meta = capturedMetadata();
    expect(has(meta, "threadId")).toBe(false);
    expect(meta.to_user_id).toBe(PEER);
    expect(has(meta, "threadMode")).toBe(false);
  });
});

describe("postMessage — first-class (UUID) thread tag is unchanged", () => {
  it("SECURITY: still REFUSES a non-participant outright (403, not a strip)", async () => {
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(
      threadRow({ created_by: PEER, target_user_id: THIRD })
    );

    await expect(
      postMessage(ctx, "dm", {
        body: "landing in someone else's thread",
        metadata: { threadId: THREAD_ID },
      })
    ).rejects.toBeInstanceOf(ThreadForbiddenError);

    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("keeps threading (and the stamped thread keys) for a participant", async () => {
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(threadRow());

    await postMessage(ctx, "dm", { body: "here it is", metadata: { threadId: THREAD_ID } });

    const meta = capturedMetadata();
    expect(meta.threadId).toBe(THREAD_ID);
    expect(meta.threadTitle).toBe("Wire the listener");
  });
});

/**
 * Calm-terminal flags (declined/dropped/interrupted/capped/ended) decide whether
 * the OTHER side's card reads as a calm, operator-chosen ending or a red
 * failure. Reserved keys riding on one question: did the thread tag survive?
 */
describe("postMessage — calm-terminal flags follow the tag decision", () => {
  it("stamps the flag for a participant of a LEGACY exchange (the decline echo)", async () => {
    await postMessage(desktopCtx, "dm", {
      body: "Request declined",
      kind: "thread_failed",
      metadata: { threadId: LEGACY_ID, declined: true },
    });

    const meta = capturedMetadata();
    expect(meta.declined).toBe(true);
    expect(meta.threadId).toBe(LEGACY_ID);
    // One resolver, one read — tag gate and flags share the lookup.
    expect(repoMessages.findMessageBySeq).toHaveBeenCalledTimes(1);
  });

  it("stamps the flag for the AUTHOR of the legacy opening request", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: USER, metadata: { to_user_id: THIRD } })
    );

    await postMessage(desktopCtx, "dm", {
      body: "Session ended",
      kind: "thread_failed",
      metadata: { threadId: LEGACY_ID, ended: true },
    });

    expect(capturedMetadata().ended).toBe(true);
  });

  it("SECURITY: strips the flags WITH the tag when the exchange is two OTHER people's", async () => {
    // ⚠ The spoof: a third member stamps someone else's exchange id with
    // `declined: true` and their card reads "This request was declined." The tag
    // goes too, so the flag has nothing left to attach to.
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: PEER, metadata: { to_user_id: THIRD } })
    );

    await postMessage(desktopCtx, "dm", {
      body: "Request declined",
      kind: "thread_failed",
      metadata: { threadId: LEGACY_ID, declined: true, dropped: true },
    });

    const meta = capturedMetadata();
    expect(has(meta, "declined")).toBe(false);
    expect(has(meta, "dropped")).toBe(false);
    expect(has(meta, "threadId")).toBe(false);
    // Stripped, but the message still posts (visible, attributable).
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("SECURITY: fails closed when the legacy opener cannot be resolved", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(null);

    await postMessage(desktopCtx, "dm", {
      body: "Request interrupted",
      kind: "thread_failed",
      metadata: { threadId: LEGACY_ID, interrupted: true },
    });

    const meta = capturedMetadata();
    expect(has(meta, "interrupted")).toBe(false);
    expect(has(meta, "threadId")).toBe(false);
  });

  it("stamps the flag on a FIRST-CLASS thread the poster participates in", async () => {
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(threadRow());

    await postMessage(desktopCtx, "dm", {
      body: "Turn limit reached",
      kind: "thread_failed",
      metadata: { threadId: THREAD_ID, capped: true },
    });

    const meta = capturedMetadata();
    expect(meta.capped).toBe(true);
    expect(meta.threadTitle).toBe("Wire the listener");
    // A first-class id the poster does not participate in is refused above.
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("strips a truthy-but-not-true flag even from a participant", async () => {
    // ⚠ Renderers read `=== true`; normalizing here keeps the stored wire clean
    // rather than relying on every reader staying strict.
    await postMessage(desktopCtx, "dm", {
      body: "Crashed",
      kind: "thread_failed",
      metadata: { threadId: LEGACY_ID, capped: "true", ended: 1 },
    });

    const meta = capturedMetadata();
    expect(has(meta, "capped")).toBe(false);
    expect(has(meta, "ended")).toBe(false);
    expect(meta.threadId).toBe(LEGACY_ID);
  });

  it("strips flags on a post with no thread id at all", async () => {
    await postMessage(desktopCtx, "dm", {
      body: "not a real outcome",
      kind: "thread_failed",
      metadata: { declined: true },
    });

    expect(has(capturedMetadata(), "declined")).toBe(false);
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });
});

/**
 * `session_ended` — THE ONE FLAG WHOSE GATE IS THE SESSION, NOT THE THREAD
 * (2026-10-11).
 *
 * ⚠ **THE REGRESSION IT PINS.** The re-stamp ran only
 * `if (calmFlags.length > 0 && typeof metadata.threadId === "string")`, so a
 * CHANNEL-LEVEL session — slot key `<channel>::<agent>`, which carries no thread
 * tag by construction — had its `session_ended` stripped and NEVER re-stamped.
 * Prod said so exactly: every `thread_progress` row whose `metadata.session_id` is
 * `<channel>::<agent>` carries `session_ended` NULL, every
 * `<channel>:<thread>:<agent>` row carries `'true'`. The flag is documented in
 * `service-writes-metadata-markers.ts` as explicitly NOT a thread outcome — it
 * is about ONE SESSION ending — so the thread tag was never the right question.
 *
 * ⚠ **AND IT IS STILL UNFORGEABLE**, which is the half that may not be traded
 * for the fix: `session_id` is deleted from caller metadata and re-stamped from
 * `ctx.sessionId` (the `X-Dopl-Session-Id` header, never the payload), so NO
 * SESSION ID => NO STAMP.
 */
describe("postMessage — session_ended answers to the SESSION, not the thread", () => {
  /** A ROOM slot: channel + agent, the shape with no thread in it at all. */
  const CHANNEL_SLOT = "chan-1::a1b2c3d4";

  it("REGRESSION: SURVIVES with a session id and NO thread tag (the channel-level session)", async () => {
    await postMessage(
      { ...desktopCtx, sessionId: CHANNEL_SLOT },
      "dm",
      {
        body: "Session ended",
        kind: "thread_progress",
        metadata: { session_ended: true },
      }
    );

    const meta = capturedMetadata();
    expect(meta.session_ended).toBe(true);
    expect(meta.session_id).toBe(CHANNEL_SLOT);
    // No tag was sent and none was invented — the point is that it is not needed.
    expect(has(meta, "threadId")).toBe(false);
    // The session gate costs no thread lookup.
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("SECURITY: DROPPED when the request carried no session id, tag or no tag", async () => {
    // Nothing identifies the session being narrated, so there is nothing to narrate with.
    await postMessage(desktopCtx, "dm", {
      body: "Session ended",
      kind: "thread_progress",
      metadata: { session_ended: true },
    });
    expect(has(capturedMetadata(), "session_ended")).toBe(false);

    vi.mocked(repoMessages.insertMessage).mockClear();
    await postMessage(desktopCtx, "dm", {
      body: "Session ended",
      kind: "thread_progress",
      metadata: { threadId: LEGACY_ID, session_ended: true },
    });
    expect(has(capturedMetadata(), "session_ended")).toBe(false);
    // The tag itself still resolves normally — only the flag is withheld.
    expect(capturedMetadata().threadId).toBe(LEGACY_ID);
  });

  it("a THREAD-gated flag still needs the tag, session id or not", async () => {
    // ⚠ THE OTHER FIVE DID NOT MOVE. `interrupted` describes a THREAD outcome, so a session id
    // buys it nothing: widening it here would be the forgery the strip list exists to stop.
    await postMessage(
      { ...desktopCtx, sessionId: CHANNEL_SLOT },
      "dm",
      {
        body: "Request interrupted",
        kind: "thread_failed",
        metadata: { interrupted: true, session_ended: true },
      }
    );

    const meta = capturedMetadata();
    expect(has(meta, "interrupted")).toBe(false);
    // Same post, same gate list, opposite answers — which is the whole split.
    expect(meta.session_ended).toBe(true);
  });

  it("the thread-tagged session keeps stamping it, exactly as before", async () => {
    // The arm that already worked in prod, pinned so the fix cannot be read as a swap.
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(threadRow());

    await postMessage(
      { ...desktopCtx, sessionId: `chan-1:${THREAD_ID}:a1b2c3d4` },
      "dm",
      {
        body: "Session ended",
        kind: "thread_progress",
        metadata: { threadId: THREAD_ID, session_ended: true },
      }
    );

    const meta = capturedMetadata();
    expect(meta.session_ended).toBe(true);
    expect(meta.threadId).toBe(THREAD_ID);
  });
});
