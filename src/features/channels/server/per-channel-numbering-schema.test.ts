/**
 * `20261122120000_channel_per_channel_numbering.sql`, READ AS THE CONTRACT IT IS.
 *
 * ⚠ **THIS IS NOT A REPLAY, AND IT CANNOT BE.** Docker is unavailable on this
 * machine, and the file is HELD — `supabase/migrations-held/` is excluded from
 * `db push`, `db reset` and the CI replay by construction, so this SQL has never
 * been executed anywhere and nothing here claims it has. The
 * `artifact-spans-schema.test.ts` / `credit-wallets-schema.test.ts` posture, for
 * their reason.
 *
 * ⚠ **WHAT IS OWED.** A behavioural probe inside a rolled-back transaction (the
 * `20260827120000` precedent) is OWED for two claims a text test cannot reach:
 *
 *   1. that two concurrent posters really do get distinct consecutive numbers,
 *      and
 *   2. that the backfill really produces a dense 1..n run.
 *
 * Both are asserted by the migration's own closing `DO $$` block, which runs at
 * apply time — so they are checked where it matters, just not here. What this
 * suite proves is that the file still SAYS the things those guarantees rest on.
 * Each is a silent, expensive failure if it drifts:
 *
 *   • **The advisory lock is taken BEFORE both aggregates and the INSERT.** That
 *     ordering IS the race-freedom argument; move the lock down and two posters
 *     read the same `MAX`.
 *   • **Both aggregates are channel-fenced**, so neither can scan the table.
 *   • **The thread counter keys on the RAW TEXT tag**, never a join to
 *     `channel_threads` — 43 of 96 live tags have no row there.
 *   • **The backfill keeps its `CASE`.** Without it every untagged row is
 *     numbered as though the main room were one giant thread.
 *   • **`seq` is not touched.** The account-wide cursor and the workspace hold
 *     are legal only because it stays a table-wide identity.
 *   • **The signature is unchanged**, so `CREATE OR REPLACE` keeps the function's
 *     identity and `service_role`'s EXECUTE grant survives.
 *
 * ⚠ Deploy state is a MEASUREMENT: `supabase migration list`, joined on the NAME,
 * never on the filename prefix (INVARIANTS §12, F-304). This file is held, so the
 * expected measurement is that it is ABSENT from production.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const NAME = "20261122120000_channel_per_channel_numbering.sql";
const HELD_DIR = resolve(process.cwd(), "supabase", "migrations-held");
const APPLIED_DIR = resolve(process.cwd(), "supabase", "migrations");

const sql = readFileSync(resolve(HELD_DIR, NAME), "utf8");

/**
 * Comments stripped. The header quotes its own rollback and its release
 * checklist at length, and a scan that kept them would pin prose.
 */
const statements = sql
  .split("\n")
  .map((line) => (line.trimStart().startsWith("--") ? "" : line))
  .join("\n");

/**
 * String literals stripped too, for ABSENCE assertions only.
 *
 * ⚠ The closing `DO $$` block RAISEs messages containing the words "thread_seq",
 * "CASE was lost" and "channel_seq" — assertions ABOUT the properties, not the
 * properties. A scan that kept them would read a guard as the thing it guards.
 * Presence assertions that need a quoted identifier (`->> 'threadId'`) use
 * {@link statements} instead, where the quotes survive.
 */
const body = statements.replace(/'(?:[^']|'')*'/g, "''");

/** The RPC body only, so the backfill's statements cannot satisfy an ordering claim. */
const fnBody = (() => {
  const open = statements.indexOf("AS $function$");
  const close = statements.indexOf("$function$;", open);
  expect(open, "the migration must define the RPC with $function$ quoting").toBeGreaterThan(-1);
  expect(close, "the RPC's dollar-quote must close").toBeGreaterThan(open);
  return statements.slice(open, close);
})();

describe("the file is HELD, and ordered after everything applied", () => {
  it("🔒 lives in migrations-held/ and NOT in migrations/ — the hold is the filesystem", () => {
    // `migrations-held.test.ts` pins this across the whole held set; this is the
    // anchor for THIS file, because every other assertion here is worthless if
    // the file quietly moved and became applied.
    expect(existsSync(resolve(HELD_DIR, NAME))).toBe(true);
    expect(existsSync(resolve(APPLIED_DIR, NAME))).toBe(false);
  });

  it("🔒 its version sorts after every applied AND held migration", () => {
    const versionOf = (n: string) => n.split("_")[0];
    const mine = versionOf(NAME);
    const others = [
      ...readdirSync(APPLIED_DIR),
      ...readdirSync(HELD_DIR).filter((f) => f !== NAME),
    ].filter((f) => f.endsWith(".sql"));

    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      expect(
        mine > versionOf(other),
        `${NAME} must sort after ${other}; it does not.`
      ).toBe(true);
    }
  });

  it("🔒 every ALTER TABLE is IF EXISTS — the held-file order-proof rule", () => {
    const alters = [
      ...statements.matchAll(/ALTER\s+TABLE\s+(IF\s+EXISTS\s+)?(?:public\.)?([a-z_]+)/gi),
    ];
    expect(alters.length).toBeGreaterThan(0);
    for (const [, guard, table] of alters) {
      expect(guard, `ALTER TABLE ${table} without IF EXISTS`).toBeTruthy();
    }
  });
});

describe("the columns it adds", () => {
  it("adds channel_seq and thread_seq, both guarded", () => {
    expect(body).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+channel_seq\s+BIGINT/i);
    expect(body).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+thread_seq\s+BIGINT/i);
  });

  it("🔒 channel_seq becomes NOT NULL; thread_seq stays nullable", () => {
    // An identity every row carries, versus "not in a thread" as a real state.
    expect(body).toMatch(/ALTER\s+COLUMN\s+channel_seq\s+SET\s+NOT\s+NULL/i);
    expect(body).not.toMatch(/ALTER\s+COLUMN\s+thread_seq\s+SET\s+NOT\s+NULL/i);
  });

  it("🔒 does not touch `seq` — no rewrite, no renumber, no drop", () => {
    // The whole design rests on `seq` keeping its meaning: the account-wide
    // cursor (`repository-account.ts › listAccountMessagesAfter`) and the
    // workspace hold are legal only because it is a table-wide identity.
    expect(body).not.toMatch(/SET\s+seq\s*=/i);
    expect(body).not.toMatch(/DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?seq\b/i);
    expect(body).not.toMatch(/ALTER\s+COLUMN\s+seq\b/i);
    expect(body).not.toMatch(/RESTART\s+(WITH\s+)?\d*/i);
  });

  it("🔒 drops nothing at all — it is the one additive held file", () => {
    // `migrations-held.test.ts` › "the hold is COMPLETE" keys off a list of
    // objects a held file protects. This file protects none, and that list must
    // stay empty for it or the gate is asserting something untrue.
    expect(body).not.toMatch(/DROP\s+(TABLE|FUNCTION|COLUMN)\b/i);
  });
});

describe("the backfill", () => {
  it("🔒 keeps the CASE that stops the main room being numbered as one thread", () => {
    // ⚠ THE TRAP, MEASURED. Dry-run read-only on production 2026-10-12: without
    // this `CASE`, `PARTITION BY (channel_id, metadata->>'threadId')` collapses
    // every untagged row into ONE null partition and numbers the main room
    // 1..1941. Delete the CASE and this test, and the migration's own 6d block,
    // both fire.
    const threadWindow = /CASE\s+WHEN\s+metadata\s*\?\s*'threadId'\s+THEN\s+row_number\(\)\s+OVER\s*\(\s*PARTITION\s+BY\s+channel_id,\s*metadata\s*->>\s*'threadId'/i;
    expect(statements).toMatch(threadWindow);
  });

  it("🔒 numbers the channel by a channel-only partition", () => {
    expect(statements).toMatch(
      /row_number\(\)\s+OVER\s*\(\s*PARTITION\s+BY\s+channel_id\s+ORDER\s+BY\s+seq\s*\)/i
    );
  });

  it("🔒 orders by seq, never by created_at", () => {
    // `created_at` can tie, and `seed-channels-demo.sql` deliberately backdates
    // it; `seq` is the authoritative arrival order.
    const windows = [...statements.matchAll(/row_number\(\)\s+OVER\s*\([^)]*\)/gi)];
    expect(windows.length).toBe(2);
    for (const [w] of windows) {
      expect(w).toMatch(/ORDER\s+BY\s+seq/i);
      expect(w).not.toMatch(/created_at/i);
    }
  });

  it("🔒 runs BEFORE the NOT NULL and before the indexes", () => {
    // Set NOT NULL first and the migration fails on every existing row; build the
    // unique index first and it indexes a column that is still entirely NULL.
    const backfill = body.search(/UPDATE\s+public\.channel_messages/i);
    const notNull = body.search(/ALTER\s+COLUMN\s+channel_seq\s+SET\s+NOT\s+NULL/i);
    const index = body.search(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(backfill).toBeGreaterThan(-1);
    expect(notNull).toBeGreaterThan(backfill);
    expect(index).toBeGreaterThan(notNull);
  });
});

describe("the unique indexes — the ratchet on the lock", () => {
  it("🔒 (channel_id, channel_seq) is UNIQUE", () => {
    // Also the covering index for `MAX(channel_seq) WHERE channel_id = ?`.
    expect(body).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+channel_messages_channel_no_key\s+ON\s+public\.channel_messages\s*\(\s*channel_id,\s*channel_seq\s*\)/i
    );
  });

  it("🔒 the thread index is UNIQUE and PARTIAL on thread_seq IS NOT NULL", () => {
    expect(statements).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+channel_messages_thread_no_key\s+ON\s+public\.channel_messages\s*\(\s*channel_id,\s*\(metadata\s*->>\s*'threadId'\),\s*thread_seq\s*\)\s*WHERE\s+thread_seq\s+IS\s+NOT\s+NULL/i
    );
  });
});

describe("the RPC allocates both numbers under the lock it already holds", () => {
  it("🔒 CONCURRENCY: the advisory lock precedes both aggregates and the INSERT", () => {
    // ⚠ **THIS IS THE RACE-FREEDOM ARGUMENT, AND IT IS AN ORDERING CLAIM.** The
    // lock is per CHANNEL and a thread lives in exactly one channel, so one lock
    // serializes both allocations. Move `pg_advisory_xact_lock` below either
    // SELECT and two concurrent posters can read the same MAX — this test goes
    // red, and in production the unique indexes above would catch it loudly
    // rather than hand two messages one number.
    //
    // ⚠ What a text test cannot prove is that Postgres honours it. That is the
    // owed behavioural probe in this file's header.
    const lock = fnBody.search(/pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*p_channel_id/i);
    const channelMax = fnBody.search(/MAX\s*\(\s*channel_seq\s*\)/i);
    const threadMax = fnBody.search(/MAX\s*\(\s*thread_seq\s*\)/i);
    const insert = fnBody.search(/INSERT\s+INTO\s+public\.channel_messages/i);

    expect(lock).toBeGreaterThan(-1);
    expect(channelMax).toBeGreaterThan(lock);
    expect(threadMax).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(channelMax);
    expect(insert).toBeGreaterThan(threadMax);
  });

  it("🔒 both aggregates are channel-fenced", () => {
    // A `MAX` that forgot `channel_id = p_channel_id` would scan the table and
    // return a global maximum — numbers would be unique but never 1-based, and
    // the migration's own 6c density assertion would never pass again.
    const channelSelect = /SELECT\s+COALESCE\s*\(\s*MAX\s*\(\s*channel_seq\s*\)[\s\S]*?WHERE\s+channel_id\s*=\s*p_channel_id/i;
    const threadSelect = /SELECT\s+COALESCE\s*\(\s*MAX\s*\(\s*thread_seq\s*\)[\s\S]*?WHERE\s+channel_id\s*=\s*p_channel_id/i;
    expect(fnBody).toMatch(channelSelect);
    expect(fnBody).toMatch(threadSelect);
  });

  it("🔒 the thread counter keys on the RAW TEXT tag, never on channel_threads", () => {
    // 43 of 96 distinct tags in production have no `channel_threads` row (31 legacy
    // `thread-<channelId>-<seq>` ids that installed desktops still mint, 12 UUIDs
    // whose thread row is gone — measured 2026-10-12). An FK-keyed counter would
    // silently number none of them.
    expect(fnBody).toMatch(/metadata\s*->>\s*'threadId'\s*=\s*v_thread_tag/i);
    expect(fnBody).not.toMatch(/channel_threads/i);
  });

  it("🔒 thread_seq is allocated only for a tagged post", () => {
    expect(fnBody).toMatch(/IF\s+v_thread_tag\s+IS\s+NOT\s+NULL\s+THEN/i);
  });

  it("🔒 both numbers are written THROUGH the insert, not by a later UPDATE", () => {
    // The delivery-keystone rule (`repository-messages.ts › MessageInsert`): a
    // follow-up UPDATE opens a window where a realtime subscriber sees the row
    // without its number.
    expect(fnBody).toMatch(/channel_seq,\s*thread_seq\s*\)/i);
    expect(fnBody).toMatch(/v_channel_seq,\s*v_thread_seq\s*\)/i);
    expect(fnBody).not.toMatch(/UPDATE\s+public\.channel_messages/i);
  });

  it("🔒 the signature is UNCHANGED, so no DROP and no re-GRANT", () => {
    // `20260912120000` had to drop-then-create because it ADDED parameters. This
    // file adds none, so `CREATE OR REPLACE` keeps the function's identity and
    // `service_role`'s EXECUTE grant survives. A `DROP FUNCTION` here would
    // silently revoke it — the exact failure `20260912120000` had to repair.
    expect(body).not.toMatch(/DROP\s+FUNCTION/i);
    expect(body).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.channel_message_insert/i);
    for (const param of [
      "p_channel_id",
      "p_workspace_id",
      "p_author_user_id",
      "p_author_kind",
      "p_kind",
      "p_body",
      "p_metadata",
      "p_client_msg_id",
      "p_wake_verdict",
      "p_recipient_user_ids",
      "p_recipient_agent_ids",
      "p_delivery",
    ]) {
      expect(body, `${param} must stay in the signature`).toContain(param);
    }
    // No thirteenth parameter: the numbers are derived, never passed in.
    expect(body).not.toMatch(/p_channel_seq|p_thread_seq|p_channel_no|p_thread_no/i);
  });

  it("🔒 keeps SECURITY DEFINER, the pinned search_path, and the rowtype return", () => {
    expect(body).toMatch(/SECURITY\s+DEFINER/i);
    expect(body).toMatch(/SET\s+search_path\s*=\s*public,\s*pg_temp/i);
    expect(body).toMatch(/RETURNS\s+public\.channel_messages/i);
    expect(body).toMatch(/RETURNING\s+\*\s+INTO\s+result/i);
  });
});

describe("the closing block asserts the outcome rather than trusting it", () => {
  it("🔒 asserts the backfill trap: an untagged row must hold NULL", () => {
    // The assertion that fires if the `CASE` is ever lost.
    expect(statements).toMatch(
      /NOT\s*\(\s*metadata\s*\?\s*'threadId'\s*\)\s+AND\s+thread_seq\s+IS\s+NOT\s+NULL/i
    );
  });

  it("🔒 asserts channel_seq is a dense 1..n run per channel", () => {
    expect(body).toMatch(/HAVING\s+min\(channel_seq\)\s*<>\s*1/i);
    expect(body).toMatch(/max\(channel_seq\)\s*<>\s*count\(\*\)/i);
  });

  it("🔒 asserts thread_seq is a dense 1..n run per thread", () => {
    expect(body).toMatch(/HAVING\s+min\(thread_seq\)\s*<>\s*1/i);
    expect(body).toMatch(/max\(thread_seq\)\s*<>\s*count\(\*\)/i);
  });

  it("🔒 asserts `authenticated` can still SELECT both columns", () => {
    // No GRANT is issued: `channel_messages` holds TABLE-level SELECT for
    // `authenticated` (measured on production 2026-10-12), which covers columns
    // added later — unlike `profiles`, where `20260810120000` revoked it and the
    // `favorited_at` rule applies. This assertion is what catches a future
    // per-column REVOKE sweep taking these two out silently.
    expect(statements).toMatch(/has_column_privilege\(\s*'authenticated'/i);
    expect(statements).toContain("'channel_seq', 'SELECT'");
    expect(statements).toContain("'thread_seq', 'SELECT'");
  });

  it("🔒 asserts both indexes exist by name", () => {
    expect(statements).toContain("'channel_messages_channel_no_key'");
    expect(statements).toContain("'channel_messages_thread_no_key'");
  });
});

describe("the header carries what an operator needs before applying it", () => {
  it("says it is held, and why", () => {
    expect(sql).toMatch(/HELD/);
    expect(sql).toMatch(/NOT APPLIED/i);
  });

  it("🔒 warns that the RPC body must be re-derived before release", () => {
    // The one way releasing this file could do damage: silently reverting a
    // redefinition of `channel_message_insert` applied after `20260912120000`.
    expect(sql).toMatch(/RE-DERIVE THE RPC BODY/i);
    expect(sql).toMatch(/grep -rln channel_message_insert/);
  });

  it("🔒 warns that CHANNEL_MESSAGE_COLS must not name the columns until release", () => {
    // Naming a column the database does not have turns every page read into a
    // PostgREST 42703. This is the ordering hazard of the whole stack.
    expect(sql).toMatch(/CHANNEL_MESSAGE_COLS/);
    expect(sql).toMatch(/42703/);
  });

  it("carries a rollback", () => {
    expect(sql).toMatch(/ROLLBACK/);
    expect(sql).toMatch(/DROP\s+COLUMN\s+IF\s+EXISTS\s+thread_seq/i);
  });
});
