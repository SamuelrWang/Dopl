/**
 * 🔒 A WEB DEPLOY THAT BEATS ITS MIGRATION MUST NOT BREAK THE SESSION PUSH (2026-10-08).
 * `replaceSessionStates` run end to end against a database with NO `channel_sessions.color_shared`:
 * it must succeed, read every row as exclusive, and write nothing naming the missing column.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  __resetColorSharedCompatForTests,
  colorSharedKnownMissing,
  fitColorShared,
  isMissingColorShared,
} from "./color-shared-compat";
import { replaceSessionStates } from "./repository-sessions";
import type { SessionStateUpsert } from "./collab-dto";

const USER = "11111111-e29b-41d4-a716-446655440000";
const WS = "22222222-e29b-41d4-a716-446655440000";
const CHAN = "33333333-e29b-41d4-a716-446655440000";

const MISSING = {
  code: "42703",
  message: "column channel_sessions.color_shared does not exist",
  details: null,
  hint: null,
};

let clock = 1_000_000;
beforeEach(() => {
  vi.clearAllMocks();
  clock = 1_000_000;
  __resetColorSharedCompatForTests(() => clock);
});

/** A database WITHOUT the column: any select or upsert naming it fails with 42703. */
function oldDatabase(liveColorRows: Array<{ channel_id: string; color: string; state: string }> = []) {
  const calls: Array<{ op: string; arg: unknown }> = [];
  let selected = "";
  let upserted: unknown = null;
  let colorRead = false;
  const builder: Record<string, unknown> = {};
  const chain = (op: string, arg?: unknown) => {
    calls.push({ op, arg });
    return builder;
  };
  Object.assign(builder, {
    from: () => {
      selected = "";
      upserted = null;
      colorRead = false;
      return chain("from");
    },
    select: (c: string) => {
      selected = c;
      return chain("select", c);
    },
    upsert: (rows: unknown) => {
      upserted = rows;
      return chain("upsert", rows);
    },
    delete: () => chain("delete"),
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    limit: () => builder,
    not: () => {
      colorRead = true;
      return builder;
    },
    then: (resolve: (r: unknown) => void) => {
      const namesColumn =
        selected.includes("color_shared") ||
        (Array.isArray(upserted) && upserted.some((r) => "color_shared" in (r as object)));
      if (namesColumn) return resolve({ data: null, error: MISSING });
      if (colorRead) return resolve({ data: liveColorRows, error: null });
      return resolve({ data: [], error: null });
    },
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

function reported(over: Partial<SessionStateUpsert> = {}): SessionStateUpsert {
  return {
    session_key: `${CHAN}:t-1`,
    channel_id: CHAN,
    task_id: null,
    name: "flint",
    state: "working",
    channel_name: "General",
    color: "agent-01",
    ...over,
  } as SessionStateUpsert;
}

describe("the session push on a database the migration has not reached", () => {
  it("succeeds, and writes no row naming the missing column", async () => {
    const calls = oldDatabase();
    await expect(replaceSessionStates(USER, WS, [reported()])).resolves.toMatchObject({ stored: 1 });
    const upserts = calls.filter((c) => c.op === "upsert").map((c) => c.arg as object[]);
    expect(upserts.length).toBeGreaterThan(0);
    expect(upserts.at(-1)?.every((row) => !("color_shared" in row))).toBe(true);
    expect(colorSharedKnownMissing()).toBe(true);
  });

  it("a full room cannot share there: the would-be shared agent goes uncoloured, the push still works", async () => {
    const all = Array.from({ length: 16 }, (_, i) => ({
      channel_id: CHAN,
      color: `agent-${String(i + 1).padStart(2, "0")}`,
      state: "working",
    }));
    const calls = oldDatabase(all);
    await replaceSessionStates(USER, WS, [reported({ color: null })]);
    const last = calls.filter((c) => c.op === "upsert").at(-1)?.arg as Array<Record<string, unknown>>;
    expect(last[0].color).toBeNull();
  });

  it("within the window the full shape is not retried; after it, it is (a migration heals with no deploy)", async () => {
    const calls = oldDatabase();
    await replaceSessionStates(USER, WS, [reported()]);
    const fullSelects = () =>
      calls.filter((c) => c.op === "select" && String(c.arg).includes("color_shared")).length;
    const before = fullSelects();
    await replaceSessionStates(USER, WS, [reported()]);
    expect(fullSelects()).toBe(before);
    clock += 5 * 60 * 1000 + 1;
    await replaceSessionStates(USER, WS, [reported()]);
    expect(fullSelects()).toBeGreaterThan(before);
  });
});

describe("the pieces", () => {
  it("recognises the missing column by code AND name, nothing else", () => {
    expect(isMissingColorShared(MISSING)).toBe(true);
    expect(isMissingColorShared({ code: "PGRST204", message: "Could not find the 'color_shared' column" })).toBe(true);
    expect(isMissingColorShared({ code: "42703", message: "column foo does not exist" })).toBe(false);
    expect(isMissingColorShared({ code: "23505", message: "color_shared" })).toBe(false);
    expect(isMissingColorShared(null)).toBe(false);
  });

  it("leaves rows alone while the column is known to exist", () => {
    const rows = [{ color: "agent-01", color_shared: true }];
    expect(fitColorShared(rows)).toBe(rows);
  });
});
