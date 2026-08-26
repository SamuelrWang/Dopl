/**
 * INVARIANT SUITE — the `channel_resource_grants` RLS POLICIES, read out of
 * `supabase/migrations`. These are database facts no application test can reach,
 * because every knowledge read in this app runs on the SERVICE-ROLE client and
 * never meets a policy.
 *
 * 🔒 WHY THIS FILE EXISTS. `20260827120000_channel_resource_grants.sql` shipped
 * two defects, both defended by the same sentence — *"the SERVICE is the true
 * gate"*:
 *
 *   1. **THE WRITE FLOOR WAS `member`**, where the template it claims to copy
 *      (`team_resource_access_admin_write`) uses `admin`. The service gate is
 *      creator-or-admin, but **PostgREST is a SECOND DOOR** and a workspace
 *      member reaches it with their own JWT, where the service does not exist.
 *      🔒 And a container PEER can be granted `member`
 *      (`home/schema.ts › grantedRole` ∈ guest|viewer|member) — so **the very
 *      party the audience ceiling bounds could write the grant rows layer A
 *      calls "unforgeable DB facts"**: set `guest_write=true` on the operator's
 *      KB, delete grants, insert grants.
 *   2. **`agent_only`'s EXISTENCE LEAKED.** The SELECT policy's viewer+ arm
 *      returned every row, so any workspace viewer could enumerate
 *      `(channel_id, resource_id, level)` for grants the wave's own rule says
 *      must be indistinguishable from absence to anyone outside that audience.
 *
 * Both are corrected by `20260828120000_channel_resource_grants_rls_tighten.sql`,
 * whose header carries the thirteen live probes that ESTABLISH the behaviour
 * (P13 in particular: a `member` INSERT naming a KB and channel it CAN see is
 * refused at 42501 by `WITH CHECK`, not merely by the enforce trigger).
 *
 * ⚠ WHAT THIS SUITE PINS IS THE FINAL STATE AFTER REPLAY, not one file. Policies
 * are OR-ed, so a `DROP` in a later migration is as load-bearing as the
 * `CREATE` — a test that read only the newest file would pass while the
 * member-floored policy sat there granting writes. Files are read in FILENAME
 * order, which is apply order.
 *
 * ⚠ MUTATION-VERIFIED: deleting the `DROP POLICY … member_write` line, or
 * lowering `'admin'` back to `'member'`, or removing the `level = 'visible'`
 * filter, each turns an assertion below red. Counts in this milestone's report.
 *
 * ⚠ COMMENTS ARE STRIPPED LINE-WISE before matching, because these migration
 * headers quote their own SQL at length (the rollback prose, the verification
 * SELECTs, and — in the tightening migration — the OLD policy bodies verbatim).
 * A scan that did not strip them would pin a paragraph. The strip is line-level
 * rather than the hand scanner `channels/schema-sql.test.ts` carries: that one
 * exists to protect `--` sequences inside string literals, and no migration
 * touching this table has one. If that ever changes, take the hand scanner.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "supabase",
  "migrations"
);

const TABLE = "channel_resource_grants";

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** Every migration, filename-sorted (= apply order), comments removed. */
const FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    sql: stripLineComments(readFileSync(join(MIGRATIONS, name), "utf8")),
  }));

/** The statement starting at `from`, up to the first `;` at paren depth 0. */
function statementAt(sql: string, from: number): string {
  let depth = 0;
  for (let i = from; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    else if (sql[i] === ";" && depth === 0) return sql.slice(from, i + 1);
  }
  return sql.slice(from);
}

/**
 * REPLAY the migrations and answer with the policies that are LIVE on the table
 * at the end — `CREATE POLICY` inserts, `DROP POLICY` removes, later wins.
 * That is the only reading that can tell "tightened" from "tightened, and the
 * loose one left behind beside it".
 */
function livePolicies(): Map<string, string> {
  const live = new Map<string, string>();
  const create = new RegExp(
    String.raw`CREATE\s+POLICY\s+(\w+)\s+ON\s+(?:public\.)?${TABLE}\b`,
    "gi"
  );
  const drop = new RegExp(
    String.raw`DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+(?:public\.)?${TABLE}\b`,
    "gi"
  );
  for (const { sql } of FILES) {
    // Order matters WITHIN a file too: the tightening migration drops and
    // re-creates the same policy name in one file.
    const events: Array<{ at: number; kind: "create" | "drop"; name: string }> = [];
    for (const m of sql.matchAll(create)) {
      if (m.index !== undefined) {
        events.push({ at: m.index, kind: "create", name: m[1] });
      }
    }
    for (const m of sql.matchAll(drop)) {
      if (m.index !== undefined) {
        events.push({ at: m.index, kind: "drop", name: m[1] });
      }
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === "drop") live.delete(e.name);
      else live.set(e.name, statementAt(sql, e.at));
    }
  }
  return live;
}

const LIVE = livePolicies();

describe("channel_resource_grants — the replayed RLS state", () => {
  it("finds the table's policies at all (an empty scan must not pass silently)", () => {
    expect(LIVE.size).toBeGreaterThan(0);
  });

  it("🔒 NO live policy admits a WRITE at the `member` floor", () => {
    // Policies are OR-ed. One member-floored ALL/INSERT/UPDATE/DELETE policy
    // anywhere re-opens the door however tight its neighbours are.
    const offenders = [...LIVE].filter(
      ([, body]) =>
        !/\bFOR\s+SELECT\b/i.test(body) &&
        /is_current_workspace_member\(\s*workspace_id\s*,\s*'(?:member|viewer|guest)'/i.test(
          body
        )
    );
    expect(offenders.map(([name]) => name)).toEqual([]);
  });

  it("🔒 the live WRITE policy is at `admin`, matching team_resource_access", () => {
    const writes = [...LIVE].filter(([, body]) => !/\bFOR\s+SELECT\b/i.test(body));
    expect(writes).toHaveLength(1);
    const [, body] = writes[0];
    expect(body).toMatch(
      /USING\s*\(\s*is_current_workspace_member\(\s*workspace_id\s*,\s*'admin'\s*\)\s*\)/i
    );
    expect(body).toMatch(
      /WITH\s+CHECK\s*\(\s*is_current_workspace_member\(\s*workspace_id\s*,\s*'admin'\s*\)\s*\)/i
    );
  });

  it("🔒 the live SELECT policy hides `agent_only` below admin", () => {
    const selects = [...LIVE].filter(([, body]) => /\bFOR\s+SELECT\b/i.test(body));
    expect(selects).toHaveLength(1);
    const [, body] = selects[0];
    // The non-admin arms are gated on the LEVEL, so absence and `agent_only` are
    // one answer through this door exactly as they are through the guest lane.
    expect(body).toMatch(/level\s*=\s*'visible'/i);
    // …and the managing audience still sees everything, or nobody can administer
    // a grant through PostgREST at all.
    expect(body).toMatch(/is_current_workspace_member\(\s*workspace_id\s*,\s*'admin'\s*\)/i);
  });

  it("the guest arm SURVIVED the tightening — a channel member still reads its own grants", () => {
    const [, body] = [...LIVE].find(([, b]) => /\bFOR\s+SELECT\b/i.test(b))!;
    expect(body).toMatch(/is_current_workspace_member\(\s*workspace_id\s*,\s*'guest'\s*\)/i);
    expect(body).toMatch(/is_channel_member\(\s*channel_id\s*\)/i);
    // ⚠ NO `visibility='public'` arm, ever: a lowered floor plus an inherited
    // public arm is how a narrow grant turns into a cross-channel read.
    expect(body).not.toMatch(/visibility\s*=\s*'public'/i);
  });

  it("exactly TWO policies are live — a third is an unreviewed door", () => {
    expect([...LIVE.keys()].sort()).toEqual([
      "channel_resource_grants_admin_write",
      "channel_resource_grants_member_select",
    ]);
  });
});
