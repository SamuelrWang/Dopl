/**
 * A TINY POSTGREST OVER `credit_usage_events` + `workspaces`, with the two
 * behaviours Samuel #2935 turns on: a table select is CLIPPED at `max_rows` and
 * says NOTHING about it, and `rpc()` runs the `home_credit_usage_bins` aggregate
 * the migration defines.
 *
 * ⚠ **IT APPLIES THE CEILING RATHER THAN RECORDING IT** (INVARIANTS §14, and the
 * discipline `search/server/_fake-db.ts` sets): a chainable recorder proves a
 * query was WRITTEN and can never prove a total is EXACT, because nothing in it
 * ever drops a row. The clip is the subject of this finding, so the fake has to
 * perform it.
 *
 * ⚠ **ITS OWN MODULE** because the suite that uses it reached the §1 500-line cap
 * — the seam is the one `_fake-db.ts` already has a name for: the FAKE vs the
 * CASES. ⚠ `_`-prefixed and not a `.test.ts`, so it carries no cases of its own
 * and vitest does not collect it.
 *
 * ⚠ **THE RPC APPLIES THE WALLET FENCE ITSELF**, exactly as the SQL does — both
 * arms, the half-open window and the channel tri-state — so a caller that stopped
 * passing the payer would silently sum another wallet here too, and the fence
 * case goes red rather than green-by-omission.
 * ⚠ `bigint` comes back as a STRING and `timestamptz` as `+00:00`, the wire's own
 * worst cases, which is what the repository's `Number(...)` and `Date`
 * normalising exist for.
 * ⚠ **THE TABLE READ IS NEWEST-FIRST BEFORE IT IS CLIPPED**, because that
 * ordering IS the bug: clip an unordered set and the bars are merely wrong, clip
 * a descending one and the whole month collapses onto today.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { supabaseAdmin } from "@/shared/supabase/admin";

/** ⚠ THE REAL CEILING, READ FROM THE REAL FILE. A literal `1000` would keep
 *  passing the day somebody moved the config — the "fix" this finding forbids. */
export const MAX_ROWS = (() => {
  const toml = readFileSync(
    join(process.cwd(), "supabase", "config.toml"),
    "utf8"
  );
  const match = /^\s*max_rows\s*=\s*(\d+)\s*$/m.exec(toml);
  if (!match) throw new Error("supabase/config.toml no longer states max_rows");
  return Number(match[1]);
})();

export const VIEWER = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
/** A container the reader OWNS of kind home/link — the LEGACY arm's attribution. */
export const OWNED_WS = "33333333-3333-4333-8333-333333333333";
export const FOREIGN_WS = "44444444-4444-4444-8444-444444444444";
export const CHAN_A = "55555555-5555-4555-8555-555555555555";
export const CHAN_B = "66666666-6666-4666-8666-666666666666";

/** Mid-October, so `range: "month"` plots the whole calendar month. */
export const NOW = new Date("2026-10-10T12:00:00.000Z");

/**
 * PROD'S OWN OCTOBER, MEASURED 2026-10-10 — the shape that produced the bug.
 * ⚠ Total 4,288, and **Oct 10 alone exceeds `max_rows`**: that is what made a
 * newest-first clip HIDE the other seven days rather than merely thin them.
 * Quiet days (3, 6) are absent on purpose — the axis must still carry them.
 */
export const OCTOBER: ReadonlyArray<readonly [day: number, credits: number]> = [
  [1, 422],
  [2, 977],
  [4, 337],
  [5, 28],
  [7, 6],
  [8, 319],
  [9, 24],
  [10, 2175],
];
export const OCTOBER_TOTAL = OCTOBER.reduce((sum, [, n]) => sum + n, 0);

export interface LedgerRow {
  origin_workspace_id: string | null;
  user_id: string | null;
  wallet: string;
  payer_user_id: string | null;
  channel_id: string | null;
  amount: number;
  created_at: string;
}

export function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    origin_workspace_id: OWNED_WS,
    user_id: VIEWER,
    wallet: "personal",
    payer_user_id: VIEWER,
    channel_id: CHAN_A,
    amount: 1,
    created_at: "2026-10-10T10:00:00.000Z",
    ...over,
  };
}

/** One credit per call, spread through each day — the ledger's real shape. */
export function octoberLedger(): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const [day, credits] of OCTOBER) {
    for (let i = 0; i < credits; i++) {
      const minute = i % 60;
      const hour = Math.floor(i / 60) % 24;
      rows.push(
        row({
          created_at: `2026-10-${String(day).padStart(2, "0")}T${String(
            hour
          ).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
        })
      );
    }
  }
  return rows;
}

export type Call = { op: string; args: unknown[] };

/** The bin key the SQL's `date_trunc(..., created_at AT TIME ZONE 'UTC')` lands on. */
function binKey(createdAt: string, bucket: unknown): string {
  const at = new Date(createdAt);
  return (
    bucket === "hour"
      ? new Date(
          Date.UTC(
            at.getUTCFullYear(),
            at.getUTCMonth(),
            at.getUTCDate(),
            at.getUTCHours()
          )
        )
      : new Date(
          Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
        )
  ).toISOString();
}

/** `isPersonalWalletBurn`, as the migration's `WHERE` states it. */
function isReaders(
  r: LedgerRow,
  payer: unknown,
  owned: ReadonlySet<string>
): boolean {
  if (r.payer_user_id === payer && r.wallet === "personal") return true;
  return (
    r.wallet === "workspace" &&
    r.origin_workspace_id !== null &&
    owned.has(r.origin_workspace_id)
  );
}

export function fakeDb(
  rows: LedgerRow[],
  opts: { rpcMissing?: boolean } = {}
): { calls: Call[] } {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  let selected: Array<Record<string, unknown>> = [];
  let limit = Number.POSITIVE_INFINITY;
  let descending = false;

  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };

  Object.assign(builder, {
    from: (t: string) => {
      limit = Number.POSITIVE_INFINITY;
      descending = false;
      selected =
        t === "workspaces"
          ? [{ id: OWNED_WS, owner_id: VIEWER, kind: "link" }]
          : (rows as unknown as Array<Record<string, unknown>>);
      return rec("from", [t]);
    },
    select: (c: string) => rec("select", [c]),
    // ⚠ RECORDED, NOT INTERPRETED — a fake that parsed the `.or()` string would
    // assert its own parser. Its text is pinned by the degrade's arms case.
    or: (f: string) => rec("or", [f]),
    eq: (c: string, v: unknown) => {
      selected = selected.filter((r) => r[c] === v);
      return rec("eq", [c, v]);
    },
    is: (c: string, v: unknown) => {
      selected = selected.filter((r) => r[c] === v);
      return rec("is", [c, v]);
    },
    in: (c: string, v: unknown[]) => {
      const set = new Set(v);
      selected = selected.filter((r) => set.has(r[c]));
      return rec("in", [c, v]);
    },
    gte: (c: string, v: string) => {
      selected = selected.filter((r) => String(r[c]) >= v);
      return rec("gte", [c, v]);
    },
    lt: (c: string, v: string) => {
      selected = selected.filter((r) => String(r[c]) < v);
      return rec("lt", [c, v]);
    },
    order: (c: string, o?: { ascending?: boolean }) => {
      descending = o?.ascending === false;
      return rec("order", [c, o]);
    },
    limit: (n: number) => {
      limit = n;
      return rec("limit", [n]);
    },
    // ⚠ THE CLIP, AND IT IS SILENT — no error, no marker, just fewer rows. The
    // server's ceiling wins over whatever the caller asked for.
    then: (resolve: (r: unknown) => void) => {
      const ordered = descending
        ? [...selected].sort((a, b) =>
            String(b.created_at).localeCompare(String(a.created_at))
          )
        : selected;
      return resolve({
        data: ordered.slice(0, Math.min(limit, MAX_ROWS)),
        error: null,
      });
    },
  });

  const client = {
    ...builder,
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ op: "rpc", args: [name, args] });
      if (opts.rpcMissing) {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: "function does not exist" },
        });
      }
      const owned = new Set((args.p_owned_container_ids as string[]) ?? []);
      const bins = new Map<string, number>();
      for (const r of rows) {
        if (!isReaders(r, args.p_payer_user_id, owned)) continue;
        if (r.created_at < String(args.p_since)) continue;
        if (r.created_at >= String(args.p_until)) continue;
        if (args.p_channel_scope === "unattributed" && r.channel_id !== null)
          continue;
        if (
          args.p_channel_scope === "channel" &&
          r.channel_id !== args.p_channel_id
        )
          continue;
        const key = binKey(r.created_at, args.p_bucket);
        bins.set(key, (bins.get(key) ?? 0) + r.amount);
      }
      return Promise.resolve({
        data: [...bins.entries()].map(([k, credits]) => ({
          bin_start: k.replace(".000Z", "+00:00"),
          credits: String(credits),
        })),
        error: null,
      });
    },
  };
  vi.mocked(supabaseAdmin).mockReturnValue(client as never);
  return { calls };
}

export function total(points: Array<{ count: number }>): number {
  return points.reduce((sum, p) => sum + p.count, 0);
}
