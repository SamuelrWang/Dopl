/**
 * 🔒 THE TWO CREDENTIAL AXES, ON EVERY ROW A MINTER WRITES (F-587).
 *
 * `20260917120000_mcp_token_credential_axes` separates WHICH container a
 * credential may act in (`container_id`) from WHOSE reach it inherits
 * (`subject_user_id`), and `mcp-access-token.ts › validateAccessToken` reads the
 * new columns with a `?? legacyAxes(row)` fallback for rows the backfill has not
 * reached.
 *
 * ⚠ **THE FALLBACK IS WHY THREE MINTERS COULD SHIP WITHOUT WRITING EITHER AXIS
 * AND NOTHING NOTICED.** `issueTokens` (OAuth), `issueDeviceToken` and
 * `issuePlaygroundToken` left both columns NULL, and their rows also carry no
 * `workspace_id` / `workspace_lock_kind` — so the fallback answered "unfenced,
 * and a person", which is correct. **The bill arrives in B13**, which drops the
 * legacy pair: with nothing behind the `??`, every device and OAuth credential
 * in existence reads as a SHARED one, denied every private row. That is the
 * CLOSING direction — silent, with no error anywhere, and the tell is every
 * operator's own agent 404ing on their own knowledge base at once.
 *
 * TWO HALVES, and they are different claims:
 *   - the MINTERS write both axes (this file, over a builder stub);
 *   - the DATABASE refuses the one row shape the fallback gets WRONG — the
 *     `NULL/NULL` "shared and unfenced" combination, for which `legacyAxes`
 *     answers `user_id`. That is a CHECK, asserted here off the migration text
 *     because there is no database on this branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

/**
 * ⚠ **EVERY CASE LOADS THE MODULES FRESH, AND THAT IS NOT TIDINESS.**
 * `mcp-access-token.ts`'s `axisColumnsPresent` flag is module-scoped and STICKY
 * by design — one 42703 anywhere costs one extra round trip once per process,
 * not once per call. A file that imported the minters statically would have its
 * first fallback case silently disarm every later case.
 */
async function load() {
  vi.resetModules();
  const [{ supabaseAdmin }, oauth, playground] = await Promise.all([
    import("@/shared/supabase/admin"),
    import("./mcp-oauth"),
    import("@/features/playground/server/token"),
  ]);
  return {
    supabaseAdmin,
    minters: {
      "issueTokens (OAuth)": (userId: string) =>
        oauth.issueTokens({ userId, clientId: "c1", scopes: [] }),
      issueDeviceToken: (userId: string) =>
        oauth.issueDeviceToken({ userId, deviceLabel: "mbp" }),
      issuePlaygroundToken: (userId: string) =>
        playground.issuePlaygroundToken({ userId, ttlSeconds: 60 }),
    } satisfies Record<string, (userId: string) => Promise<unknown>>,
  };
}

type MinterName = keyof Awaited<ReturnType<typeof load>>["minters"];

/** Chainable thenable builder; records every `insert` payload. */
function makeAdmin(insertError: { code: string } | null = null) {
  const inserts: Array<Record<string, unknown>> = [];
  let insertsSeen = 0;
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    from: () => builder,
    upsert: () => builder,
    update: () => builder,
    eq: () => builder,
    is: () => builder,
    insert: (v: Record<string, unknown>) => {
      inserts.push(v);
      insertsSeen += 1;
      // Only the FIRST insert of a run can raise the undefined-column error;
      // the retry must succeed or the helper would loop.
      const error = insertError && insertsSeen === 1 ? insertError : null;
      return { ...builder, then: (r: (x: unknown) => void) => r({ data: null, error }) };
    },
    then: (r: (x: { data: null; error: null }) => void) => r({ data: null, error: null }),
  });
  return { builder, inserts };
}

/** The `mcp_tokens` insert payload — the last one, after any retry. */
function tokenRow(inserts: Array<Record<string, unknown>>): Record<string, unknown> {
  const rows = inserts.filter((r) => "access_token_hash" in r);
  return rows[rows.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

const MINTERS: MinterName[] = [
  "issueTokens (OAuth)",
  "issueDeviceToken",
  "issuePlaygroundToken",
];

describe.each(MINTERS)("%s writes both axes", (name) => {
  it("🔒 stores `subject_user_id = user_id` and `container_id = null`", async () => {
    const { supabaseAdmin, minters } = await load();
    const { builder, inserts } = makeAdmin();
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    await minters[name]("user-9");

    const row = tokenRow(inserts);
    // `subject_user_id` is the M-10 axis: NULL means "nobody in particular" and
    // is denied every private row. These credentials are one person's.
    expect(row.subject_user_id).toBe("user-9");
    // …and `container_id` is UNFENCED, stated rather than absent. `undefined`
    // would leave the column NULL by omission, which reads the same today and
    // says nothing to the next reader about which of the four shapes this is.
    expect(row).toHaveProperty("container_id");
    expect(row.container_id).toBeNull();
    // 🔒 The DB's own `mcp_tokens_subject_is_owner_check` — a credential never
    // acts as somebody else.
    expect(row.subject_user_id).toBe(row.user_id);
  });

  it("falls back to a row WITHOUT the axis columns on 42703, rather than failing the mint", async () => {
    // ⚠ THESE ARE THE SIGN-IN PATHS. A bare INSERT naming a column the migration
    // has not created 42703s and NOBODY gets a credential — the `20260825150000`
    // trap, total rather than per-feature. The retry is safe because the legacy
    // pair on the same row (absent → unfenced, a person) says the same thing.
    const { supabaseAdmin, minters } = await load();
    const { builder, inserts } = makeAdmin({ code: "42703" });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    await expect(minters[name]("user-9")).resolves.toBeDefined();

    const row = tokenRow(inserts);
    expect(row).not.toHaveProperty("subject_user_id");
    expect(row).not.toHaveProperty("container_id");
    expect(row.user_id).toBe("user-9");
  });
});

describe("the database refuses the shape the fallback reads wrong", () => {
  const SQL = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "supabase",
      "migrations",
      "20260917120000_mcp_token_credential_axes.sql"
    ),
    "utf8"
  );

  it("🔒 pins the SUBJECT axis to the legacy pair, not only the container axis", () => {
    // ⚠ `subject_user_id IS NULL` meant two things — "predates the backfill" and
    // "deliberately shared" — and a `??` cannot tell them apart. For
    // `container_id NULL, subject NULL`, `legacyAxes` answers `hasPerson = true`
    // and hands back the OWNER: the one shape that must read as nobody read as
    // the account holder. The CHECK is the verification block's own identity
    // assertion, promoted from an apply-time count to a constraint.
    expect(SQL).toMatch(/ADD CONSTRAINT mcp_tokens_subject_axis_agree_check/);
    expect(SQL).toMatch(
      /\(subject_user_id IS NULL\)\s*\n?\s*=\s*\(workspace_id IS NOT NULL AND workspace_lock_kind IS DISTINCT FROM 'container_session'\)/
    );
    // Its sibling on the container axis is untouched — the two are separate
    // claims and the missing one was the dangerous half to omit.
    expect(SQL).toMatch(/ADD CONSTRAINT mcp_tokens_axes_agree_check/);
  });

  it("⚠ retires with the legacy columns in B13, and says so", () => {
    // Once `workspace_id` / `workspace_lock_kind` are gone there is one lane to
    // read, `NULL/NULL` becomes representable, and the constraint that forbids
    // it must go in the SAME change — otherwise B13 makes a legal shape
    // unstorable rather than making it readable.
    expect(SQL).toMatch(/B13 drops the\s*\n?--\s*legacy columns and (?:that|this) constraint/);
  });
});
