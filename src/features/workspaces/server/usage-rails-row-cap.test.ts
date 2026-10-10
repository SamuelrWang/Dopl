/**
 * 🔒 **THE WORKSPACE OVERVIEW'S THREE RAILS, OVER A MONTH BIGGER THAN ONE
 * POSTGREST PAGE (Samuel #2935, the `max_rows` sweep).** `getWorkspaceUsage`
 * hauled `credit_usage_events`, `mcp_tool_calls` and `channel_messages` at
 * `WORKSPACE_SCAN_LIMIT` (10,000) and folded each in JS; `supabase/config.toml ›
 * max_rows` clips a select at 1,000 and raises NOTHING, so every rail — and the
 * `scanned` denominator printed beside the shares — described the newest 1,000
 * rows of a calendar month under a label reading the month.
 *
 * ⚠ **AND THE CLIP WAS SILENT**, which is the half that made it a ghost: this
 * module's `clipped()` computed `rows.length >= limit`, and `1000 >= 10000` is
 * FALSE, so the floor reported itself COMPLETE.
 *
 * The fix is a `GROUP BY` per rail (`repository-usage-tally.ts`), which puts the
 * ceiling out of reach: one row per channel, per member, per `(tool, op)` pair.
 * The hauls survive as the degrade while the migration is unapplied — which is
 * the LIVE path, so it is driven here too.
 *
 * ⚠ Fixtures, the fake's clip and the honest RPC handler: `_fake-usage-db.ts`.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - skip the aggregates and keep the hauls → the three rail-total cases fail.
 *  - revert `clipped()` to compare against the asked `limit` → the three
 *    "hauls exactly 1000" cases fail.
 *  - drop the wallet `.in()` or either `.or()` arm → the fence-text cases fail.
 *  - sum both grouping sets' `events` → the `scanned` assertions double.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { MAX_ROWS } from "@/shared/testing/postgrest-cap";
import {
  CHAN_A,
  CHAN_B,
  ME,
  MONTH_TOTAL,
  NOW,
  PEER,
  SINCE,
  VISIBLE,
  WS,
  burn,
  mcpCalls,
  messages,
  mount,
  octoberLedger,
} from "./_fake-usage-db";
import type { Args } from "./_fake-usage-db";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { fakePostgrest } from "@/shared/testing/postgrest-cap";
import {
  scanWorkspaceCreditEvents,
  scanWorkspaceMcpCalls,
  scanWorkspaceMessageChannels,
} from "./repository-usage";
import { getWorkspaceUsage } from "./service-usage";

beforeEach(() => vi.clearAllMocks());

describe("the three rails, over the same oversized month", () => {
  const seed = () => ({
    ledger: octoberLedger(),
    calls: mcpCalls(1_500),
    msgs: messages(1_300),
  });

  it("totals the rails from the WHOLE month and reports no clip", async () => {
    mount(seed());

    const usage = await getWorkspaceUsage(WS, VISIBLE, NOW);

    // Every burn lands in one of the two visible channels, so the by-channel rail
    // sums to the month — the plot's own total.
    expect(usage.channels.reduce((n, r) => n + r.credits, 0)).toBe(MONTH_TOTAL);
    expect(usage.people.reduce((n, r) => n + r.credits, 0)).toBe(MONTH_TOTAL);
    expect(usage.tools.reduce((n, r) => n + r.calls, 0)).toBe(1_500);
    expect(usage.channels.reduce((n, r) => n + r.messages, 0)).toBe(1_300);
    // ⚠ THE DENOMINATOR IS EXACT NOW, not "however many rows survived".
    expect(usage.scanned).toBe(MONTH_TOTAL);
    expect(usage.truncated).toBe(false);
    expect(usage.since).toBe(SINCE);
  });

  it("splits the rails by key rather than piling the month on one row", async () => {
    mount(seed());

    const usage = await getWorkspaceUsage(WS, VISIBLE, NOW);

    expect(usage.channels.map((r) => r.name).sort()).toEqual([
      "General",
      "Shipping",
    ]);
    for (const row of usage.channels) expect(row.credits).toBeGreaterThan(0);
    expect(usage.people).toHaveLength(2);
    expect(usage.tools.map((r) => `${r.tool}:${r.op}`).sort()).toEqual([
      "dopl_map:",
      "dopl_search:knowledge",
    ]);
  });

  it("reads three GROUP BYs and hauls none of the three tables", async () => {
    const { calls } = mount(seed());

    await getWorkspaceUsage(WS, VISIBLE, NOW);

    expect(
      calls.filter((c) => c.op === "rpc").map((c) => c.args[0])
    ).toEqual([
      "workspace_credit_usage_tally",
      "workspace_mcp_tool_tally",
      "workspace_message_channel_tally",
    ]);
    for (const table of [
      "credit_usage_events",
      "mcp_tool_calls",
      "channel_messages",
    ]) {
      expect(
        calls.filter((c) => c.op === "from" && c.args[0] === table),
        table
      ).toHaveLength(0);
    }
  });

  it("names this container and the credit period on every tally", async () => {
    const { calls } = mount(seed());

    await getWorkspaceUsage(WS, VISIBLE, NOW);

    for (const rpc of calls.filter((c) => c.op === "rpc")) {
      const args = rpc.args[1] as Args;
      expect(args.p_workspace_id, String(rpc.args[0])).toBe(WS);
      expect(args.p_since, String(rpc.args[0])).toBe(SINCE);
      // ⚠ NO `p_until`: the rails' window is the credit period and no control
      // moves it, so an `until` here would be a second window nobody asked for.
      expect(args.p_until, String(rpc.args[0])).toBeUndefined();
    }
    const credit = calls.find(
      (c) => c.op === "rpc" && c.args[0] === "workspace_credit_usage_tally"
    );
    expect((credit?.args[1] as Args).p_channel_ids).toEqual([CHAN_A, CHAN_B]);
  });

  /** 🔒 The rail prints a NAME, so a channel the caller cannot open gets no row —
   *  while its burns still count on the plot above. The aggregate must not become
   *  the thing that leaks it. */
  it("keeps an invisible channel off the rail though the aggregate saw it", async () => {
    mount(seed());

    const usage = await getWorkspaceUsage(WS, [VISIBLE[0]], NOW);

    expect(usage.channels.map((r) => r.channelId)).toEqual([CHAN_A]);
    // ⚠ And the denominator still describes the whole month, which is why this
    // rail does not sum to the series by construction.
    expect(usage.scanned).toBe(MONTH_TOTAL);
  });

  it("drops a payer the roster does not carry, and never fetches their profile", async () => {
    const gone = "99999999-9999-4999-8999-999999999999";
    mount({
      ...seed(),
      ledger: [...octoberLedger(), burn({ user_id: gone, amount: 500 })],
    });

    const usage = await getWorkspaceUsage(WS, VISIBLE, NOW);

    expect(usage.people.map((r) => r.userId).sort()).toEqual([ME, PEER].sort());
    expect(usage.people.some((r) => r.userId === gone)).toBe(false);
  });
});

/**
 * ⚠ **THE THREE DEGRADED HAULS ARE ASSERTED AT THE REPOSITORY, NOT THROUGH
 * `getWorkspaceUsage`, AND THAT IS A HARNESS LIMIT RATHER THAN A PREFERENCE.**
 * The service fires its three arms in one `Promise.all`; the shared fake is ONE
 * mutable builder, so two chains built in the same microtask overwrite each
 * other's state and the suite would be asserting an artefact. The real client
 * mints a builder per `.from()`. The clip and the marker live in these functions
 * anyway, and `service-usage.test.ts` pins the propagation into `scanned` /
 * `truncated` with the repository mocked.
 */
describe("the degraded hauls — clipped at the ceiling, and finally saying so", () => {
  it(`hauls exactly ${MAX_ROWS} of ${MONTH_TOTAL} ledger rows and reports truncated TRUE`, async () => {
    mount({ ledger: octoberLedger(), rpcMissing: true });

    const scan = await scanWorkspaceCreditEvents(WS, [CHAN_A, CHAN_B], SINCE);

    // 🔒 THE REGRESSION: `rows.length >= limit` compared 1,000 against the asked
    // 10,000 and answered "complete".
    expect(scan.rows).toHaveLength(MAX_ROWS);
    expect(scan.truncated).toBe(true);
  });

  it(`hauls exactly ${MAX_ROWS} MCP calls, keeping both pushdown filters`, async () => {
    const { calls } = mount({ calls: mcpCalls(1_500), rpcMissing: true });

    const scan = await scanWorkspaceMcpCalls(WS, SINCE);

    expect(scan.rows).toHaveLength(MAX_ROWS);
    expect(scan.truncated).toBe(true);
    expect(calls.find((c) => c.op === "or")?.args[0]).toBe(
      "tool.neq.channel,op.not.like.await*"
    );
    expect(
      calls.find((c) => c.op === "not" && c.args[0] === "tool")?.args
    ).toEqual(["tool", "like", "mcp:*"]);
  });

  it(`hauls exactly ${MAX_ROWS} message rows and reports truncated TRUE`, async () => {
    mount({ msgs: messages(1_300), rpcMissing: true });

    const scan = await scanWorkspaceMessageChannels(WS, SINCE);

    expect(scan.rows).toHaveLength(MAX_ROWS);
    expect(scan.truncated).toBe(true);
  });

  it("still answers the whole panel on the degrade path", async () => {
    // ⚠ ONE degraded arm, for the concurrency reason above: enough to prove the
    // panel renders and reports its floor rather than throwing.
    mount({
      ledger: octoberLedger(),
      calls: mcpCalls(5),
      msgs: messages(5),
      rpcMissing: (name) => name === "workspace_credit_usage_tally",
    });

    const usage = await getWorkspaceUsage(WS, VISIBLE, NOW);

    expect(usage.truncated).toBe(true);
    expect(usage.scanned).toBe(MAX_ROWS);
    expect(usage.channels.reduce((n, r) => n + r.credits, 0)).toBe(MAX_ROWS);
  });

  it("an un-applied LEDGER is an empty month, not a thrown page", async () => {
    // ⚠ `credit_usage_events` ships unapplied too; 42P01 reads as "nothing yet",
    // which is a truthful month — and distinct from an absent FUNCTION.
    // ⚠ **AND ONLY THE LEDGER AGGREGATES DEGRADE THAT WAY**: `mcp_tool_calls` and
    // `channel_messages` have existed since 2026-07, so a 42P01 from THEIR
    // aggregates is a real fault and must throw rather than read as zero.
    const fake = fakePostgrest(
      { channels: [], workspace_members: [], profiles: [] },
      {
        rpc: (name) =>
          name.startsWith("workspace_credit")
            ? { data: null, error: { code: "42P01", message: "no relation" } }
            : { data: [], error: null },
      }
    );
    vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);

    const usage = await getWorkspaceUsage(WS, VISIBLE, NOW);

    expect(usage.channels.map((r) => r.credits)).toEqual([0, 0]);
    expect(usage.scanned).toBe(0);
    expect(usage.truncated).toBe(false);
  });

  it("throws when a MESSAGE or MCP aggregate answers 42P01 — that table exists", async () => {
    const fake = fakePostgrest(
      { channels: [], workspace_members: [], profiles: [] },
      {
        rpc: (name) =>
          name === "workspace_mcp_tool_tally"
            ? { data: null, error: { code: "42P01", message: "no relation" } }
            : { data: [], error: null },
      }
    );
    vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);

    await expect(getWorkspaceUsage(WS, VISIBLE, NOW)).rejects.toMatchObject({
      code: "42P01",
    });
  });

  it("an EMPTY container is empty lists, never NaN or a missing key", async () => {
    mount();

    const usage = await getWorkspaceUsage(WS, [], NOW);

    expect(usage.channels).toEqual([]);
    expect(usage.people).toEqual([]);
    expect(usage.tools).toEqual([]);
    expect(usage.scanned).toBe(0);
    expect(usage.truncated).toBe(false);
  });
});

