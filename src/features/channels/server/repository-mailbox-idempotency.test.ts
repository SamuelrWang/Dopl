/**
 * **THE TWO MAILBOX IDEMPOTENCY PROBES, AT THE LAYER A SERVICE TEST CANNOT SEE**
 * (2026-09-02, A10/G10).
 *
 * ⚠ **`service-mailbox-idempotency.test.ts` DRIVES A MOCKED REPOSITORY**, so it
 * can only see WHICH function was called — never whether that function narrows by
 * `operator_user_id` at all. Dropping that predicate is the `20260822120000`
 * attack on a third table: `client_msg_id` values are caller-chosen and a
 * colliding one would hand a member another operator's directive back as their
 * own retry, "filing nothing" while a launch they never made stands. Nothing in
 * the suite above would move.
 *
 * ⚠ **AND THE INDEX HAS TO AGREE**, for the reason `20260911120000`'s own header
 * gives: probe and index state one rule, and author-scoping only the read turns a
 * silent convergence into a `23505` the caller sees as a 500.
 *
 * ⚠ BOTH LANES, NOT ONE. `launch_agent` and `direct_agent` are two tables with
 * two repositories and one rule; a copy that drifts is exactly what having two of
 * them costs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { findLaunchDirectiveByClientMsgId } from "./repository-launch";
import { findAgentDirectionByClientMsgId } from "./repository-directions";

const ME = "aaaaaaaa-e29b-41d4-a716-446655440000";
const CHAN = "11111111-1111-4111-8111-111111111111";
const KEY = "launch-retry-7";

type Call = { op: string; args: unknown[] };

function makeAdmin() {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    select: (c: string) => rec("select", [c]),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

function eqFilters(calls: Call[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of calls) if (c.op === "eq") out[String(c.args[0])] = c.args[1];
  return out;
}

const LANES = [
  {
    name: "launch_agent",
    table: "channel_launch_directives",
    probe: findLaunchDirectiveByClientMsgId,
  },
  {
    name: "direct_agent",
    table: "channel_agent_directions",
    probe: findAgentDirectionByClientMsgId,
  },
] as const;

describe("the probe narrows by channel, OPERATOR and key — never two of the three", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(LANES)("$name asks the whole predicate", async ({ table, probe }) => {
    const calls = makeAdmin();

    await probe(ME, CHAN, KEY);

    expect(calls.find((c) => c.op === "from")?.args[0]).toBe(table);
    // ⚠ `toEqual`, so an EXTRA filter fails too. A `status` filter here would let
    // a retry file a SECOND directive the moment the first one lapsed, which is
    // the exact outcome the key exists to make impossible — and it is the
    // "simplification" the repository's own header warns against.
    expect(eqFilters(calls)).toEqual({
      channel_id: CHAN,
      operator_user_id: ME,
      client_msg_id: KEY,
    });
  });
});

describe("the partial unique index states the same predicate", () => {
  const sql = readFileSync(
    path.join(
      import.meta.dirname,
      "..", "..", "..", "..",
      "supabase", "migrations", "20260911120000_launch_direction_client_msg_id.sql"
    ),
    "utf8"
  );

  it.each(LANES)("$name's index is (channel_id, operator_user_id, client_msg_id)", ({ table }) => {
    const m = new RegExp(
      `CREATE UNIQUE INDEX (?:IF NOT EXISTS )?\\w+\\s+ON (?:public\\.)?${table}\\s*\\(([^()]*)\\)`
    ).exec(sql);
    expect(m, `${table}'s idempotency index moved or was renamed`).not.toBeNull();
    expect((m as RegExpExecArray)[1].split(",").map((c) => c.trim())).toEqual([
      "channel_id",
      "operator_user_id",
      "client_msg_id",
    ]);
  });

  it("both are PARTIAL, so an unlabelled request is not constrained", () => {
    // ⚠ Without `WHERE client_msg_id IS NOT NULL` the index would make the key
    // effectively required: two launches with no key at all would collide on a
    // NULL, and NULLs are only DISTINCT because the index never sees them.
    // ⚠ Counted on the CREATE statements, not on the file — a comment in the same
    // file discusses the clause, and a bare text count would pass on prose.
    // ⚠ `[\s\S]` rather than the `s` flag — the root tsconfig targets below es2018.
    const partial = [
      ...sql.matchAll(
        /CREATE UNIQUE INDEX[\s\S]*?WHERE client_msg_id IS NOT NULL;/g
      ),
    ];
    expect(partial).toHaveLength(2);
  });
});
