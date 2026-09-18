/**
 * `20261003120000_credit_events_channel.sql`, read as the contract it is.
 *
 * Not a replay — Docker is unavailable here. What SQL text proves is that the
 * file still says what rule B is built on: a nullable channel column that is
 * `SET NULL` rather than CASCADE, an index whose column order matches the one
 * scan that reads it, the ruling in the header, and that nothing is dropped or
 * backfilled. Behavioural probes are owed (CI's `rls-redteam` job is the replay,
 * INVARIANTS §14).
 *
 * Deploy state is a MEASUREMENT: `supabase migration list`, joined on the
 * NAME, never on the filename prefix (INVARIANTS §12, F-304).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(process.cwd(), "supabase", "migrations");
const NAME = "20261003120000_credit_events_channel.sql";
const sql = readFileSync(resolve(MIGRATIONS, NAME), "utf8");
/** Header prose with the `--` line noise folded out, so a rule that wraps across
 *  two comment lines still reads as one sentence. */
const prose = sql.replace(/\n--\s*>?\s*/g, " ");
/** The statements only — what applying the file actually runs. */
const live = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("the header carries what an operator needs before applying it", () => {
  it("says WRITTEN, NOT APPLIED — this directory's standing gate", () => {
    expect(sql).toContain("WRITTEN, NOT APPLIED");
  });

  it("tells the reader to re-derive by NAME, not by filename prefix (F-304)", () => {
    expect(sql).toContain("supabase migration list");
    expect(prose).toContain("JOIN ON THE NAME");
  });

  it("states the apply order and the file it depends on", () => {
    expect(prose).toMatch(/APPLY ORDER:/);
    expect(prose).toContain("20260930120000");
  });

  it("🔒 carries SAMUEL'S RULE B, and both halves of it", () => {
    // A header naming only the channel half would leave the fallback looking like
    // an implementation detail rather than the ruling it is.
    expect(prose).toContain("charge the CALLING CHANNEL's container");
    expect(prose).toContain(
      "with no calling channel, charge the RESOURCE's container"
    );
    expect(prose).toContain("2026-09-13");
  });

  it("🔒 says NULL means Desktop agent and that legacy rows CANNOT be backfilled", () => {
    // The accepted cost, stated rather than discovered by a reader who finds a
    // month of spend under one label.
    expect(prose).toContain("Desktop agent");
    expect(prose).toContain("cannot recover a channel");
  });

  it("carries a COMPLETE rollback, as PROSE", () => {
    for (const stmt of [
      "DROP INDEX IF EXISTS public.credit_usage_events_payer_wallet_channel_idx",
      "DROP COLUMN IF EXISTS channel_id",
    ]) {
      expect(prose, stmt).toContain(stmt);
    }
    // A live DROP here would delete the attribution this file exists to add.
    expect(live).not.toMatch(/^\s*(DROP|DELETE|TRUNCATE)/im);
  });
});

describe("🔒 the column is additive, nullable, and SET NULL", () => {
  it("adds ONE nullable uuid column referencing channels", () => {
    expect(live).toContain(
      "ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL"
    );
  });

  it("🔒 is NOT NOT-NULL and carries NO default — NULL is the Desktop-agent value", () => {
    const stmt = live.slice(live.indexOf("ALTER TABLE public.credit_usage_events"));
    const addColumn = stmt.slice(0, stmt.indexOf(";"));
    expect(addColumn).not.toMatch(/NOT NULL/);
    expect(addColumn).not.toMatch(/DEFAULT/);
  });

  it("🔒 never CASCADEs — a deleted channel's spend still totals into the wallet", () => {
    // Revert detector: `ON DELETE CASCADE` would delete already-charged spend the
    // moment a channel was removed, and the /home plot would stop matching the
    // counter for past months.
    expect(live).not.toMatch(/channel_id[^;]*ON DELETE CASCADE/);
  });

  it("backfills nothing — no UPDATE, no derivation from origin_workspace_id", () => {
    expect(live).not.toMatch(/\bUPDATE\b/i);
    expect(live).not.toMatch(/\bINSERT\b/i);
  });

  it("COMMENTs the column, because its meaning is not derivable from its name", () => {
    expect(live).toContain(
      "COMMENT ON COLUMN public.credit_usage_events.channel_id IS"
    );
    expect(live).toContain("RULE B");
  });
});

describe("🔒 the index matches the scan that reads the column", () => {
  /**
   * The column order is the assertion: equality predicates first
   * (`payer_user_id`, `wallet`, `channel_id`), then `created_at` as the range AND
   * the sort — which is `repository-overview.ts › scanCreditEvents` exactly. Any
   * other order leaves the index existing but unusable for that scan.
   */
  it("is (payer_user_id, wallet, channel_id, created_at DESC)", () => {
    expect(live).toContain(
      "CREATE INDEX IF NOT EXISTS credit_usage_events_payer_wallet_channel_idx\n  ON public.credit_usage_events (payer_user_id, wallet, channel_id, created_at DESC);"
    );
  });

  it("🔒 does NOT put `period_start` in it, and says why", () => {
    // The histogram never filters or orders by `period_start`, and a column the
    // predicate does not mention stops the scan using anything after it.
    const idx = live.slice(live.indexOf("CREATE INDEX"));
    expect(idx).not.toContain("period_start");
    expect(prose).toContain("`period_start` IS DELIBERATELY NOT IN IT");
  });

  it("keeps the payer+period index rather than replacing it", () => {
    expect(prose).toContain("credit_usage_events_payer_period_idx");
    expect(live).not.toContain("DROP INDEX");
  });
});

describe("ordering", () => {
  it("has a unique version and sorts after every file it depends on", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => f.startsWith("20261003120000"))).toEqual([NAME]);
    // Not a style rule: this file ALTERs `credit_usage_events` and references
    // `channels`, so both must sort before it. `wallet` is the index's second
    // column, which is what puts `20260930120000` on this list.
    for (const dependency of [
      "20260725120000_channels.sql",
      "20260901130000_credit_usage_events.sql",
      "20260930120000_credit_wallets.sql",
    ]) {
      expect(files).toContain(dependency);
      expect(dependency.slice(0, 14) < "20261003120000").toBe(true);
    }
  });
});
