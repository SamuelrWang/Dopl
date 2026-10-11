/**
 * THE FIXTURES BEHIND THE WORKSPACE OVERVIEW'S `max_rows` SUITES (Samuel #2935)
 * — an oversized month, the four aggregates performed honestly, and one `mount`.
 *
 * ⚠ **A HELPER MODULE, NOT A SUITE, FOR THE REASON `home/server/
 * _fake-credit-db.ts` IS ONE**: three files assert against the SAME oversized
 * month (the series, the rails, the token strip), and a month seeded three ways
 * is three chances for one of them to stop exceeding the ceiling the finding
 * depends on. ⚠ And it keeps each suite inside the 500-line cap (§1).
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT** (`shared/testing/
 * postgrest-cap.ts`, INVARIANTS §14) — a chainable recorder proves a query was
 * WRITTEN and can never prove a total is EXACT, because nothing in it ever drops
 * a row. `MAX_ROWS` is read out of `supabase/config.toml`, never written beside it.
 * ⚠ **THE RPC HANDLER AGGREGATES WITHOUT CLIPPING, BECAUSE THE SERVER DOES**:
 * `max_rows` bounds a response body, and one row per group is nowhere near it.
 * ⚠ **IT IS ALSO WHY EVERY SUITE ASSERTS THE FENCE AS ARGUMENTS AND AS CLAUSE
 * TEXT** — a handler that summed every wallet would pass every total.
 */

import { vi } from "vitest";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { fakePostgrest, type Row } from "@/shared/testing/postgrest-cap";
import { overviewWindows } from "@/features/overview-series/windows";


export const WS = "11111111-1111-4111-8111-111111111111";
export const FOREIGN_WS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CHAN_A = "33333333-3333-4333-8333-333333333333";
export const CHAN_B = "44444444-4444-4444-8444-444444444444";
export const ME = "22222222-2222-4222-8222-222222222222";
export const PEER = "55555555-5555-4555-8555-555555555555";

/** Mid-October, so `month` is a 31-bin window with 10 days of history. */
export const NOW = new Date("2026-10-10T12:00:00.000Z");
export const SINCE = "2026-10-01T00:00:00.000Z";
export const UNTIL = "2026-11-01T00:00:00.000Z";

/**
 * 🔒 **THE MONTH THAT DOES NOT FIT, AND THE SHAPE OF THE BUG.** 2,400 burns
 * across Oct 1-10 with **1,400 of them on Oct 10 alone** — so a newest-first clip
 * at 1,000 never reaches Oct 1-9, exactly the measured prod case the /home half of
 * this sweep recorded (4,288 credits, 2,175 on one day).
 */
export const PER_DAY: ReadonlyArray<[day: number, burns: number]> = [
  [1, 300],
  [2, 200],
  [4, 150],
  [5, 120],
  [8, 130],
  [9, 100],
  [10, 1_400],
];
export const MONTH_TOTAL = PER_DAY.reduce((sum, [, n]) => sum + n, 0);

export function burn(over: Partial<Row> = {}): Row {
  return {
    origin_workspace_id: WS,
    user_id: ME,
    wallet: "seat",
    channel_id: CHAN_A,
    amount: 1,
    created_at: "2026-10-10T10:00:00.000Z",
    ...over,
  };
}

/** The month's ledger, oldest first. ⚠ Minutes apart so `created_at` sorts. */
export function octoberLedger(): Row[] {
  const rows: Row[] = [];
  for (const [day, count] of PER_DAY) {
    const base = Date.parse(
      `2026-10-${String(day).padStart(2, "0")}T00:00:00.000Z`
    );
    for (let i = 0; i < count; i++) {
      rows.push(
        burn({
          created_at: new Date(base + i * 1_000).toISOString(),
          // Two channels and two people, so the rails have something to split.
          channel_id: i % 2 === 0 ? CHAN_A : CHAN_B,
          user_id: i % 3 === 0 ? PEER : ME,
        })
      );
    }
  }
  return rows;
}

/** `n` MCP calls over the month, alternating between two `(tool, op)` pairs. */
export function mcpCalls(n: number): Row[] {
  const base = Date.parse(SINCE);
  return Array.from({ length: n }, (_, i) => ({
    workspace_id: WS,
    tool: i % 4 === 0 ? "dopl_map" : "dopl_search",
    op: i % 4 === 0 ? "" : "knowledge",
    created_at: new Date(base + i * 60_000).toISOString(),
  }));
}

/** `n` messages over the month, split across the two channels. */
export function messages(n: number): Row[] {
  const base = Date.parse(SINCE);
  return Array.from({ length: n }, (_, i) => ({
    workspace_id: WS,
    channel_id: i % 2 === 0 ? CHAN_A : CHAN_B,
    kind: "message",
    created_at: new Date(base + i * 60_000).toISOString(),
  }));
}

/** `n` token-spend runs for `user`, one minute apart. ⚠ Every row carries the
 *  full primary key, because the paging order is tie-broken down to it. */
export function runs(n: number, user = ME): Row[] {
  const base = Date.parse("2026-09-20T00:00:00.000Z");
  return Array.from({ length: n }, (_, i) => ({
    workspace_id: WS,
    user_id: user,
    session_key: `run-${String(i).padStart(6, "0")}`,
    started_at: new Date(base + i * 60_000).toISOString(),
    tokens: 10,
  }));
}

/* ---------------------------- the applied database ----------------------- */

/** `isWorkspaceSeatBurn`, as the SQL spells it — the fence the aggregates push
 *  down. ⚠ Written ONCE here so the four handlers cannot drift from each other. */
function seatBurn(row: Row, channelIds: readonly string[]): boolean {
  if (row.wallet !== "seat" && row.wallet !== "workspace") return false;
  if (row.origin_workspace_id === WS) return true;
  return (
    typeof row.channel_id === "string" && channelIds.includes(row.channel_id)
  );
}

/** One RPC call's argument object, as the fake records it. */
export type Args = Record<string, unknown>;

/**
 * The five group-bys, performed over the SAME seeded rows and WITHOUT a clip —
 * `/private/.../rpc-workspaces.sql` in TypeScript.
 *
 * ⚠ It is the only way to test the applied side at all (the shared harness does
 * not interpret RPC), and it is why the fence is ALSO asserted as ARGUMENTS and
 * as PostgREST clause TEXT on the degrade path: a handler that summed every
 * wallet would pass every total below.
 */
function aggregate(tables: { ledger: Row[]; calls: Row[]; msgs: Row[] }) {
  return (name: string, args: Args): { data: unknown; error: unknown } => {
    const channelIds = (args.p_channel_ids as string[]) ?? [];
    if (name === "workspace_credit_usage_bins") {
      const bins = new Map<string, number>();
      for (const row of tables.ledger) {
        const at = String(row.created_at);
        if (!seatBurn(row, channelIds)) continue;
        if (at < String(args.p_since) || at >= String(args.p_until)) continue;
        if (args.p_channel_id && row.channel_id !== args.p_channel_id) continue;
        const key =
          args.p_bucket === "hour" ? at.slice(0, 13) + ":00:00" : at.slice(0, 10);
        bins.set(key, (bins.get(key) ?? 0) + Number(row.amount));
      }
      return {
        // ⚠ `+00:00`, as PostgREST renders a `timestamptz` — the repository must
        // normalise it through `Date` or every bin reads 0 against a `…Z` key.
        data: [...bins].map(([key, credits]) => ({
          bin_start:
            args.p_bucket === "hour" ? `${key}+00:00` : `${key}T00:00:00+00:00`,
          // ⚠ A bigint crosses the wire as a STRING.
          credits: String(credits),
        })),
        error: null,
      };
    }
    if (name === "workspace_credit_usage_tally") {
      const byChannel = new Map<string | null, [number, number]>();
      const byPerson = new Map<string | null, [number, number]>();
      for (const row of tables.ledger) {
        if (!seatBurn(row, channelIds)) continue;
        if (String(row.created_at) < String(args.p_since)) continue;
        for (const [map, key] of [
          [byChannel, (row.channel_id ?? null) as string | null],
          [byPerson, (row.user_id ?? null) as string | null],
        ] as const) {
          const [credits, events] = map.get(key) ?? [0, 0];
          map.set(key, [credits + Number(row.amount), events + 1]);
        }
      }
      const rows = [
        ...[...byChannel].map(([key, v]) => ({ dimension: "channel", key, v })),
        ...[...byPerson].map(([key, v]) => ({ dimension: "person", key, v })),
      ];
      return {
        data: rows.map((r) => ({
          dimension: r.dimension,
          tally_key: r.key,
          credits: String(r.v[0]),
          events: String(r.v[1]),
        })),
        error: null,
      };
    }
    if (name === "workspace_mcp_tool_tally") {
      const byPair = new Map<string, number>();
      for (const row of tables.calls) {
        if (row.workspace_id !== args.p_workspace_id) continue;
        if (String(row.created_at) < String(args.p_since)) continue;
        if (row.tool === "channel" && String(row.op).startsWith("await")) continue;
        if (String(row.tool).startsWith("mcp:")) continue;
        const key = `${row.tool}\u0000${row.op}`;
        byPair.set(key, (byPair.get(key) ?? 0) + 1);
      }
      return {
        data: [...byPair].map(([key, calls]) => ({
          tool_name: key.split("\u0000")[0],
          op_name: key.split("\u0000")[1],
          calls: String(calls),
        })),
        error: null,
      };
    }
    if (name === "workspace_message_channel_tally") {
      const byChannel = new Map<string, number>();
      for (const row of tables.msgs) {
        if (row.workspace_id !== args.p_workspace_id) continue;
        if (row.kind !== "message") continue;
        if (String(row.created_at) < String(args.p_since)) continue;
        const key = String(row.channel_id);
        byChannel.set(key, (byChannel.get(key) ?? 0) + 1);
      }
      return {
        data: [...byChannel].map(([key, count]) => ({
          billed_channel_id: key,
          messages: String(count),
        })),
        error: null,
      };
    }
    throw new Error(`unexpected rpc: ${name}`);
  };
}

interface Seed {
  ledger?: Row[];
  calls?: Row[];
  msgs?: Row[];
  spend?: Row[];
  channels?: string[];
  /** Answer RPCs as a database the migration has not reached — all of them, or
   *  only the ones a predicate names. */
  rpcMissing?: boolean | ((name: string) => boolean);
}

export function mount(seed: Seed = {}) {
  const ledger = seed.ledger ?? [];
  const calls = seed.calls ?? [];
  const msgs = seed.msgs ?? [];
  const tables = {
    credit_usage_events: ledger,
    mcp_tool_calls: calls,
    channel_messages: msgs,
    workspace_token_spend: seed.spend ?? [],
    channels: (seed.channels ?? [CHAN_A, CHAN_B]).map((id) => ({
      id,
      workspace_id: WS,
      deleted_at: null,
    })),
    workspace_members: [
      { workspace_id: WS, user_id: ME, role: "admin", status: "active" },
      { workspace_id: WS, user_id: PEER, role: "member", status: "active" },
    ],
    profiles: [
      { id: ME, email: "me@x.dev", display_name: "Ada", avatar_url: null },
      { id: PEER, email: "peer@x.dev", display_name: "Grace", avatar_url: null },
    ],
  };
  const applied = aggregate({ ledger, calls, msgs });
  const absent = seed.rpcMissing;
  const fake = fakePostgrest(tables, {
    rpc: (name, args) =>
      absent === true || (typeof absent === "function" && absent(name))
        ? undefined
        : applied(name, args),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}

export const VISIBLE = [
  { id: CHAN_A, name: "General" },
  { id: CHAN_B, name: "Shipping" },
];

export const monthBins = () => overviewWindows("month", NOW);

/**
 * The fake's builder, typed just enough to spell the SHAPE THESE READS REPLACED.
 * ⚠ The two control cases exist to prove the harness clips a one-statement read;
 * without a chain type they would have to be written through `never` casts, which
 * is how a control stops compiling the thing it is controlling for.
 */
export interface Chain {
  from: (table: string) => Chain;
  select: (cols: string) => Chain;
  eq: (col: string, value: unknown) => Chain;
  in: (col: string, values: readonly unknown[]) => Chain;
  order: (col: string, opts: { ascending: boolean }) => Chain;
  limit: (n: number) => PromiseLike<{ data: Row[]; error: unknown }>;
}
export const chain = (client: unknown) => client as Chain;

