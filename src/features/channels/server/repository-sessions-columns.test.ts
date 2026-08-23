/**
 * THE RECONCILE'S THREE COLUMN LISTS, PINNED AGAINST EACH OTHER.
 *
 * ⚠ **SPLIT OUT OF `repository-sessions.test.ts` AT THE 500-LINE CAP**
 * (2026-08-23). That file is about BEHAVIOUR under a mocked client; this one is
 * a static read of the repository's SOURCE plus a compile-time key set, which is
 * a different kind of test and reads better on its own.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { SessionStateUpsert } from "./collab-dto";

/**
 * EVERY KEY OF {@link SessionStateUpsert}, AS A VALUE — and it is a
 * `Record<keyof …, true>` rather than a string array ON PURPOSE: TypeScript
 * refuses this declaration if a key is missing OR invented, so the list cannot
 * quietly fall behind the type it claims to enumerate. A `string[]` would be a
 * second, driftable statement of the same thing, which is precisely the failure
 * mode this suite exists to catch one level down.
 */
const UPSERT_KEYS: Record<keyof SessionStateUpsert, true> = {
  session_key: true,
  channel_id: true,
  task_id: true,
  name: true,
  state: true,
  channel_name: true,
  thread_title: true,
  detail: true,
  tool_label: true,
  model: true,
  context_used: true,
  context_window: true,
  tokens_spent: true,
  started_at: true,
  last_activity_at: true,
  template_name: true,
};

const upsertKeys = () => Object.keys(UPSERT_KEYS);

/**
 * THE THREE STATEMENTS OF "WHAT A SESSION ROW IS", PINNED AGAINST EACH OTHER.
 *
 * `SESSION_DIFF_COLUMNS` (what the reconcile SELECTs), `sessionRowMatches` (what
 * it COMPARES) and {@link SessionStateUpsert} (what the service WRITES) are the
 * same list written three times, and the reconcile is silently wrong if they
 * disagree:
 *
 *   - **In the type but not the SELECT** → the stored value reads back as
 *     `undefined`, compares unequal against every reported value, and makes
 *     EVERY row look changed on EVERY push. `updated_at` is the read's ORDER BY
 *     and the MCP result's "last reported" stamp, so the ordering goes arbitrary
 *     while still looking plausible.
 *   - **In the type but not the COMPARE** → a push carrying nothing but that
 *     column is discarded as a no-op. The value FREEZES at whatever it was on
 *     the row's first write, while the row keeps claiming to be current.
 *
 * ⚠ **THE REPOSITORY'S OWN DOCBLOCK CLAIMED THIS TEST EXISTED AND IT DID NOT**
 * (found 2026-08-23, while adding `template_name` — the eighth operator-only
 * column and the third column added since the claim was written). The doc was
 * describing the guarantee it wanted rather than one anybody had built. Written
 * now, so the sentence is true.
 *
 * ⚠ **BOTH ARE READ OUT OF THE SOURCE TEXT**, not exported for the test. The
 * idiom is `schema-sql.test.ts`'s: exporting a private constant to test it makes
 * the constant part of a public surface, and neither of these is one. If a
 * refactor moves either declaration, this fails LOUDLY on the extraction rather
 * than passing over nothing.
 */
describe("the reconcile's three column lists cannot drift", () => {
  const SOURCE = readFileSync(
    new URL("./repository-sessions.ts", import.meta.url),
    "utf8"
  );

  /** Every column named by the `SESSION_DIFF_COLUMNS` string concatenation. */
  function selectedColumns(): string[] {
    const decl = /const SESSION_DIFF_COLUMNS\s*=([\s\S]*?);/.exec(SOURCE);
    expect(decl, "SESSION_DIFF_COLUMNS is no longer declared in this file").toBeTruthy();
    return [...decl![1].matchAll(/"([^"]*)"/g)]
      .map((m) => m[1])
      .join("")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
  }

  /** Every column `sessionRowMatches` reads off the STORED row. */
  function comparedColumns(): string[] {
    const fn = /function sessionRowMatches\([\s\S]*?\n}/.exec(SOURCE);
    expect(fn, "sessionRowMatches is no longer declared in this file").toBeTruthy();
    return [...new Set([...fn![0].matchAll(/stored\.([a-z_]+)/g)].map((m) => m[1]))];
  }

  /** The write shape's own keys, minus the one the reconcile keys ON. */
  function comparableUpsertKeys(): string[] {
    return upsertKeys().filter((k) => k !== "session_key");
  }

  it("every column the service WRITES is one the reconcile SELECTs", () => {
    const selected = new Set(selectedColumns());
    for (const key of upsertKeys()) {
      expect(
        selected.has(key),
        `SessionStateUpsert carries "${key}" and SESSION_DIFF_COLUMNS does not select it — every row would read as changed on every push`
      ).toBe(true);
    }
  });

  it("every column the service WRITES is one the reconcile COMPARES", () => {
    // ⚠ `session_key` is the reconcile's KEY, not a compared field — two rows
    // being compared always share it by construction.
    const compared = new Set(comparedColumns());
    for (const key of comparableUpsertKeys()) {
      expect(
        compared.has(key),
        `SessionStateUpsert carries "${key}" and sessionRowMatches never reads it — a push carrying only that column would be discarded as a no-op and the value would freeze`
      ).toBe(true);
    }
  });

  it("and neither list names a column the write shape does not have", () => {
    const keys = new Set(upsertKeys());
    for (const column of selectedColumns()) {
      expect(keys.has(column), `SESSION_DIFF_COLUMNS selects "${column}", which is not a SessionStateUpsert key`).toBe(true);
    }
    for (const column of comparedColumns()) {
      expect(keys.has(column), `sessionRowMatches compares "${column}", which is not a SessionStateUpsert key`).toBe(true);
    }
  });

  it("the extraction is real — it finds the columns rather than an empty set", () => {
    // ⚠ Without this, a regex that stopped matching would make all three cases
    // above vacuously true.
    expect(selectedColumns().length).toBeGreaterThanOrEqual(15);
    expect(comparedColumns().length).toBeGreaterThanOrEqual(14);
    expect(selectedColumns()).toContain("template_name");
    expect(comparedColumns()).toContain("template_name");
  });
});
