import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { recordDeliveryAcks, weakerOrEqual } from "./service-writes-delivery";
import type { ChannelContext } from "./service-shared";

vi.mock("./repository");
vi.mock("./repository-messages");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";

/**
 * **THE WAKE ACK** (2026-09-02, A9) — what a machine did with a message, and the
 * three rules that make it safe to write from a desktop: the SESSION BINDING,
 * MEMBERSHIP, and MONOTONICITY.
 *
 * ⚠ **THE SESSION BINDING WAS MISSING AND MONOTONICITY IS WHAT MADE THAT
 * SERIOUS** (closed 2026-09-02, review D3). With membership as the only fence,
 * any member of a room could stamp `delivery: "woken"` on any `seq` in it — and
 * because the write only ever moves UP the rank, `woken` is the top, and the
 * machine that really handled the message can never correct it. A false receipt
 * was permanent by design.
 */

const CTX: ChannelContext = {
  userId: "user-1",
  workspaceId: "ws-1",
} as ChannelContext;

const CHAN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** A session key as the desktop mints it — `<channelId>:<taskId>:<agentId>`. */
const KEY = `${CHAN}::a1b2c3d4`;
const OTHER_KEY = `${OTHER}::e5f6a7b8`;

/** The live set this same push reconciled, as the route hands it over. */
const reported = (...keys: string[]) =>
  keys.map((k) => ({ sessionKey: k, channelId: k.split(":")[0] }));

const ack = (over: Partial<{ sessionKey: string; channelId: string; seq: number; delivery: "woken" | "idle" | "refused" | "delivered" }> = {}) => ({
  sessionKey: KEY,
  channelId: CHAN,
  seq: 42,
  delivery: "woken" as const,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findMembership).mockResolvedValue({ role: "member" } as never);
  vi.mocked(repoMessages.stampDelivery).mockResolvedValue(true);
  // ⚠ THE SERVER'S OWN ANSWER TO "WHO WAS THIS FOR" — fence (3), F-593.
  // `null` is the DEFERRING value ("the server did not resolve the agent half"),
  // which is the default here because most cases below are about the other two
  // fences and must not be filtered by this one.
  vi.mocked(repoMessages.findRecipientAgentIds).mockResolvedValue(null);
});

describe("weakerOrEqual — the one ranking of the outcome vocabulary", () => {
  it("lets `woken` overwrite everything, itself included", () => {
    // ⚠ ITSELF INCLUDED, so a re-pushed receipt is idempotent rather than a
    // no-op that reads as a lost one — the push retries whole payloads.
    expect(weakerOrEqual("woken").sort()).toEqual(
      ["delivered", "idle", "none", "refused", "unreachable", "woken"].sort()
    );
  });

  it("does NOT let `refused` overwrite a wake another machine reported", () => {
    // ⚠ THE CASE THE RANK EXISTS FOR. Two operators can hold live agents on one
    // thread, so two machines report on one message; the one that fed nothing is
    // exactly as likely to push second as the one that woke an agent.
    expect(weakerOrEqual("refused")).not.toContain("woken");
    expect(weakerOrEqual("refused")).not.toContain("delivered");
    expect(weakerOrEqual("refused")).not.toContain("idle");
  });

  it("ranks `refused` above `none` — somebody was addressed and turned away", () => {
    expect(weakerOrEqual("refused")).toContain("none");
    expect(weakerOrEqual("idle")).toContain("refused");
  });
});

describe("recordDeliveryAcks", () => {
  it("stamps a receipt for a session this push reported, in a channel the caller is in", async () => {
    const out = await recordDeliveryAcks(CTX, [ack()], reported(KEY));
    expect(out).toEqual({ stamped: 1 });
    // ⚠ THE WHOLE ARGUMENT LIST, NOT A PREFIX. A `.slice(0, 3)` here would drop
    // the monotonic filter AND the workspace fence — the two arguments that make
    // the write safe — so the case would stay green over a stamp that clobbered
    // a stronger receipt in another tenant's row.
    expect(vi.mocked(repoMessages.stampDelivery).mock.calls[0]).toEqual([
      "ws-1",
      CHAN,
      42,
      "woken",
      weakerOrEqual("woken"),
    ]);
  });

  it("SKIPS a receipt naming NO session of this machine's — the D3 fence", async () => {
    // 🔒 THE ATTACK. Membership alone let any member of the room stamp a
    // permanent `woken` on any seq. The claimant must hold the session it is
    // reporting for, and the live set is the one this same push just reconciled.
    await expect(
      recordDeliveryAcks(CTX, [ack()], reported(OTHER_KEY))
    ).resolves.toEqual({ stamped: 0 });
    expect(vi.mocked(repoMessages.stampDelivery)).not.toHaveBeenCalled();
    // ⚠ AND IT DOES NOT EVEN ASK ABOUT MEMBERSHIP — a receipt bound to nothing
    // is refused before it costs a read.
    expect(vi.mocked(repo.findMembership)).not.toHaveBeenCalled();
  });

  it("SKIPS a receipt whose session is in a DIFFERENT room than the one it names", async () => {
    // ⚠ A live session in room A does not license a receipt in room B, even
    // though the caller is a member of both.
    await expect(
      recordDeliveryAcks(CTX, [ack({ channelId: OTHER })], reported(KEY))
    ).resolves.toEqual({ stamped: 0 });
    expect(vi.mocked(repoMessages.stampDelivery)).not.toHaveBeenCalled();
  });

  it("SKIPS a receipt for a channel the caller is not in — it does not throw", async () => {
    // ⚠ Zod validates the ARRAY on this endpoint, so throwing would take the
    // whole session push down with it: an unretryable 400 that leaves
    // `read_sessions` answering [] for the machine's LIVE sessions. The
    // projection is what a whole tool reads; the receipt loses the tie.
    // ⚠ AND THE MEMBERSHIP READ IS NOT REDUNDANT BEHIND THE BINDING:
    // `reportSessionStates` writes the session set with no membership check of
    // its own, so a machine can declare a session in a room it is not in.
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    await expect(
      recordDeliveryAcks(CTX, [ack({ seq: 1 })], reported(KEY))
    ).resolves.toEqual({ stamped: 0 });
    expect(vi.mocked(repoMessages.stampDelivery)).not.toHaveBeenCalled();
  });

  it("asks for membership ONCE per distinct channel", async () => {
    await recordDeliveryAcks(
      CTX,
      [
        ack({ seq: 1, delivery: "idle" }),
        ack({ seq: 2 }),
        ack({ sessionKey: OTHER_KEY, channelId: OTHER, seq: 3, delivery: "refused" }),
      ],
      reported(KEY, OTHER_KEY)
    );
    expect(vi.mocked(repo.findMembership).mock.calls.map((c) => c[0])).toEqual([
      CHAN,
      OTHER,
    ]);
  });

  it("counts only the rows that actually moved", async () => {
    // A stamp the rank refused reports `false`; the caller is told what landed,
    // not what it asked for.
    vi.mocked(repoMessages.stampDelivery)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    expect(
      await recordDeliveryAcks(
        CTX,
        [ack({ seq: 1 }), ack({ seq: 2, delivery: "refused" })],
        reported(KEY)
      )
    ).toEqual({ stamped: 1 });
  });

  it("writes nothing at all for an empty list", async () => {
    expect(await recordDeliveryAcks(CTX, [], reported(KEY))).toEqual({ stamped: 0 });
    expect(vi.mocked(repo.findMembership)).not.toHaveBeenCalled();
  });
});

describe("the SQL CHECK states the same vocabulary", () => {
  it("lists exactly the six outcomes the rank knows", () => {
    // ⚠ THE THIRD STATEMENT OF THIS SET, AND NO TypeScript CAN REACH IT.
    // `closedEnum` closes the TS↔zod gap and nothing else; the column CHECK is a
    // separate authority, and a value it lacks throws 23514 only on a real
    // INSERT. `scripts/check-message-kind-drift.ts` holds the KIND sets this way
    // across four sites; this holds the delivery set across two, here rather
    // than in that gate because the CHECK lives in a different migration and
    // that gate reads exactly one.
    const sql = readFileSync(
      path.join(
        import.meta.dirname,
        "..", "..", "..", "..",
        "supabase", "migrations", "20260912120000_channel_delivery_verdict.sql"
      ),
      "utf8"
    );
    const m = /delivery IS NULL\s*\n\s*OR delivery IN \(([^)]*)\)/.exec(sql);
    expect(m, "the delivery CHECK moved or was renamed").not.toBeNull();
    const values = [...(m as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map(
      (x) => x[1]
    );
    expect(values.sort()).toEqual(
      ["delivered", "idle", "none", "refused", "unreachable", "woken"].sort()
    );
  });

  it("states the same four wake verdicts the enum does", () => {
    const sql = readFileSync(
      path.join(
        import.meta.dirname,
        "..", "..", "..", "..",
        "supabase", "migrations", "20260912120000_channel_delivery_verdict.sql"
      ),
      "utf8"
    );
    const m = /wake_verdict IS NULL OR wake_verdict IN \(([^)]*)\)/.exec(sql);
    expect(m, "the wake_verdict CHECK moved or was renamed").not.toBeNull();
    const values = [...(m as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map(
      (x) => x[1]
    );
    expect(values.sort()).toEqual(["agent", "member", "none", "thread"].sort());
  });
});

describe("🔒 fence (3) — the message was FOR this session (F-593)", () => {
  it("skips a receipt from an agent the message did not address", async () => {
    // ⚠ THE LIE IS PERMANENT, which is why this is a fence and not a report.
    // Fences (1) and (2) say "you hold a live session in that room"; they say
    // nothing about the MESSAGE. `woken` is the top of the monotonic rank, so
    // the machine that really handled it can never correct the stamp.
    vi.mocked(repoMessages.findRecipientAgentIds).mockResolvedValue(["z9y8x7w6"]);
    expect(
      await recordDeliveryAcks(CTX, [ack()], reported(KEY))
    ).toEqual({ stamped: 0 });
    expect(repoMessages.stampDelivery).not.toHaveBeenCalled();
  });

  it("stamps a receipt from an agent the message DID address", async () => {
    vi.mocked(repoMessages.findRecipientAgentIds).mockResolvedValue([
      "z9y8x7w6",
      "a1b2c3d4",
    ]);
    expect(await recordDeliveryAcks(CTX, [ack()], reported(KEY))).toEqual({
      stamped: 1,
    });
  });

  it("`null` DEFERS and `[]` does not refuse — only a NON-EMPTY list is an answer", async () => {
    // `null` = "the server did not resolve the agent half, your own parse
    // decided"; `[]` = "this body named no agent", which every non-`message`
    // kind also stores. Refusing on either would break the lanes the desktop
    // legitimately delivers on its own.
    for (const stored of [null, []]) {
      vi.mocked(repoMessages.stampDelivery).mockClear();
      vi.mocked(repoMessages.findRecipientAgentIds).mockResolvedValue(stored);
      expect(
        await recordDeliveryAcks(CTX, [ack()], reported(KEY)),
        JSON.stringify(stored)
      ).toEqual({ stamped: 1 });
    }
  });

  it("skips a receipt for a seq that has NO ROW — a receipt for nothing", async () => {
    vi.mocked(repoMessages.findRecipientAgentIds).mockResolvedValue(undefined);
    expect(await recordDeliveryAcks(CTX, [ack()], reported(KEY))).toEqual({
      stamped: 0,
    });
  });

  it("an OLDER desktop's two-segment key cannot say which agent it is, and is not refused for it", async () => {
    // INVARIANTS §13: an older build is a supported peer. It falls back to
    // fences (1) and (2), which is exactly what it had before this fence
    // existed — a degrade, never a new refusal aimed at it.
    const legacy = `${CHAN}:`;
    vi.mocked(repoMessages.findRecipientAgentIds).mockResolvedValue(["z9y8x7w6"]);
    expect(
      await recordDeliveryAcks(
        CTX,
        [ack({ sessionKey: legacy })],
        reported(legacy)
      )
    ).toEqual({ stamped: 1 });
  });

  it("asks ONCE per message, however many receipts name it", async () => {
    vi.mocked(repoMessages.findRecipientAgentIds).mockResolvedValue(null);
    await recordDeliveryAcks(
      CTX,
      [ack(), ack({ delivery: "idle" }), ack({ seq: 43 })],
      reported(KEY)
    );
    expect(vi.mocked(repoMessages.findRecipientAgentIds).mock.calls).toHaveLength(2);
  });
});
