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
 * two rules that make it safe to write from a desktop: MEMBERSHIP, and
 * MONOTONICITY.
 */

const CTX: ChannelContext = {
  userId: "user-1",
  workspaceId: "ws-1",
} as ChannelContext;

const CHAN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findMembership).mockResolvedValue({ role: "member" } as never);
  vi.mocked(repoMessages.stampDelivery).mockResolvedValue(true);
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
  it("stamps a receipt for a channel the caller is in", async () => {
    const out = await recordDeliveryAcks(CTX, [
      { channelId: CHAN, seq: 42, delivery: "woken" },
    ]);
    expect(out).toEqual({ stamped: 1 });
    expect(vi.mocked(repoMessages.stampDelivery).mock.calls[0].slice(0, 3)).toEqual([
      CHAN,
      42,
      "woken",
    ]);
  });

  it("SKIPS a receipt for a channel the caller is not in — it does not throw", async () => {
    // ⚠ Zod validates the ARRAY on this endpoint, so throwing would take the
    // whole session push down with it: an unretryable 400 that leaves
    // `read_sessions` answering [] for the machine's LIVE sessions. The
    // projection is what a whole tool reads; the receipt loses the tie.
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    await expect(
      recordDeliveryAcks(CTX, [{ channelId: CHAN, seq: 1, delivery: "woken" }])
    ).resolves.toEqual({ stamped: 0 });
    expect(vi.mocked(repoMessages.stampDelivery)).not.toHaveBeenCalled();
  });

  it("asks for membership ONCE per distinct channel", async () => {
    await recordDeliveryAcks(CTX, [
      { channelId: CHAN, seq: 1, delivery: "idle" },
      { channelId: CHAN, seq: 2, delivery: "woken" },
      { channelId: OTHER, seq: 3, delivery: "refused" },
    ]);
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
      await recordDeliveryAcks(CTX, [
        { channelId: CHAN, seq: 1, delivery: "woken" },
        { channelId: CHAN, seq: 2, delivery: "refused" },
      ])
    ).toEqual({ stamped: 1 });
  });

  it("writes nothing at all for an empty list", async () => {
    expect(await recordDeliveryAcks(CTX, [])).toEqual({ stamped: 0 });
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
