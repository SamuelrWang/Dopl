import { describe, it, expect } from "vitest";
import { readCode } from "@/shared/testing/source-text";
import type { SessionStateUpsert } from "./collab-dto";

/** Every key of {@link SessionStateUpsert}; `Record<keyof …, true>` makes tsc refuse a missing or invented key. */
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
  identity_name: true,
  display_name: true,
  color: true,
  turns: true,
  tokens_delta: true,
  stale: true,
  denied_calls: true,
  last_denied_tool: true,
  last_wake_seq: true,
  last_wake_at: true,
};

const upsertKeys = () => Object.keys(UPSERT_KEYS);

/**
 * `SESSION_DIFF_COLUMNS` (what the reconcile selects), `sessionRowMatches` (what it compares) and
 * {@link SessionStateUpsert} (what the service writes) must list the same columns. Missing from the
 * select, every row reads as changed on every push; missing from the compare, a push changing only that
 * column is dropped and the value freezes. Read as comment-stripped source text, so a moved or renamed
 * declaration fails loudly.
 */
describe("the reconcile's three column lists cannot drift", () => {
  const SOURCE = readCode(new URL("./repository-sessions-columns.ts", import.meta.url));

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
    // `session_key` is the reconcile's key, not a compared field.
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
    // Floors, not equalities: this catches a regex that matches nothing, not a new column.
    expect(selectedColumns().length).toBeGreaterThanOrEqual(22);
    expect(comparedColumns().length).toBeGreaterThanOrEqual(21);
    expect(selectedColumns()).toContain("identity_name");
    expect(comparedColumns()).toContain("identity_name");
    // `last_wake_at` is the column an orchestrator polls; a frozen one reads as a redirect that never landed.
    expect(selectedColumns()).toContain("last_wake_at");
    expect(comparedColumns()).toContain("last_wake_at");
  });
});
