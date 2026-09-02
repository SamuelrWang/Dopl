import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { agentIsAnotherMembers, agentInstanceOwner } from "./repository-agent-owner";
import { SESSION_PROJECTION_FRESH_MS } from "../constants";

/**
 * **"THAT AGENT IS ANOTHER MEMBER'S" — WHEN THE SERVER MAY SAY IT** (2026-09-02,
 * A9 — guardrail G3, finding F-418).
 *
 * ⚠ **EVERY CASE HERE IS ABOUT WHEN IT MUST *NOT* SAY IT.** The surface has
 * always promised *"an id belonging to another member is REFUSED outright and no
 * request is filed"*, and the code filed the row anyway — but F-418 also records,
 * in capitals, why the obvious fix is a liveness bug: `channel_sessions` is a
 * PROJECTION the desktop pushes on state change, so intersecting an agent id with
 * it converts a benign `no-session` answer into a hard 400 for every legitimate
 * call sent while the push is behind. That is the ORDINARY state in the seconds
 * after a launch.
 *
 * ⚠ **SO THE RULE IS ASYMMETRIC: a POSITIVE, FRESH row refuses; nothing else
 * does.** Absent, quiet, stale, unparseable and unavailable all answer `false`,
 * and the machine — the only authority — answers `no-session`.
 */

const WS = "ws-1";
const ME = "user-1";
const OTHER = "user-2";
const AGENT = "a1b2c3d4";
const NOW = Date.parse("2026-09-02T12:00:00Z");

type Call = { op: string; args: unknown[] };
type Row = { user_id?: string; updated_at?: string };

function makeAdmin(rows: Row[], error: { code?: string; message: string } | null = null) {
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
    order: (c: string, o: unknown) => rec("order", [c, o]),
    limit: (n: number) => rec("limit", [n]),
    then: (resolve: (r: { data: Row[] | null; error: unknown }) => void) =>
      resolve({ data: error ? null : rows, error }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

const fresh = (ms = 1_000) => new Date(NOW - ms).toISOString();
const stale = () => new Date(NOW - SESSION_PROJECTION_FRESH_MS - 1).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agentInstanceOwner — the read", () => {
  it("selects the stamp beside the owner, newest first, bounded to one", () => {
    // ⚠ THE STAMP IS NOT DECORATION. Without it in the SELECT no caller could
    // bound the row's age, and every one of them would be back to refusing on a
    // fact that may be hours old.
    const calls = makeAdmin([{ user_id: OTHER, updated_at: fresh() }]);
    return agentInstanceOwner(WS, AGENT).then((out) => {
      expect(out).toEqual({ userId: OTHER, updatedAt: fresh() });
      expect(calls.find((c) => c.op === "select")?.args[0]).toBe("user_id, updated_at");
      expect(calls.filter((c) => c.op === "eq").map((c) => c.args)).toEqual([
        ["workspace_id", WS],
        ["name", AGENT],
      ]);
      expect(calls.find((c) => c.op === "limit")?.args[0]).toBe(1);
    });
  });

  it("answers null when nothing reports the id", async () => {
    makeAdmin([]);
    expect(await agentInstanceOwner(WS, AGENT)).toBeNull();
  });

  it("degrades a MISSING RELATION to null — fail-open, as its docblock argues", async () => {
    makeAdmin([], { code: "PGRST205", message: "relation does not exist" });
    expect(await agentInstanceOwner(WS, AGENT)).toBeNull();
  });

  it("still THROWS every other error — unknown is not empty", async () => {
    makeAdmin([], { code: "42501", message: "permission denied" });
    await expect(agentInstanceOwner(WS, AGENT)).rejects.toBeTruthy();
  });
});

describe("agentIsAnotherMembers — refuses only on a positive, FRESH fact", () => {
  it("TRUE for a fresh row owned by someone else", async () => {
    makeAdmin([{ user_id: OTHER, updated_at: fresh() }]);
    expect(await agentIsAnotherMembers(WS, AGENT, ME, NOW)).toBe(true);
  });

  it("FALSE for a fresh row that is the caller's own", async () => {
    makeAdmin([{ user_id: ME, updated_at: fresh() }]);
    expect(await agentIsAnotherMembers(WS, AGENT, ME, NOW)).toBe(false);
  });

  it("FALSE when NOTHING reports the id — absence is not evidence", async () => {
    // ⚠ F-418's whole warning. A launched agent whose machine has not pushed yet
    // is indistinguishable, here, from an id that never existed.
    makeAdmin([]);
    expect(await agentIsAnotherMembers(WS, AGENT, ME, NOW)).toBe(false);
  });

  it("FALSE for a STALE row, however clearly it names another member", async () => {
    // ⚠ An old row says the agent WAS seen. By then an id may have been recycled
    // onto another machine, and refusing on it would block a legitimate call with
    // a sentence that is no longer true.
    makeAdmin([{ user_id: OTHER, updated_at: stale() }]);
    expect(await agentIsAnotherMembers(WS, AGENT, ME, NOW)).toBe(false);
  });

  it("TRUE on the freshness boundary, FALSE one millisecond past it", async () => {
    makeAdmin([
      { user_id: OTHER, updated_at: new Date(NOW - SESSION_PROJECTION_FRESH_MS + 1).toISOString() },
    ]);
    expect(await agentIsAnotherMembers(WS, AGENT, ME, NOW)).toBe(true);
    makeAdmin([
      { user_id: OTHER, updated_at: new Date(NOW - SESSION_PROJECTION_FRESH_MS).toISOString() },
    ]);
    expect(await agentIsAnotherMembers(WS, AGENT, ME, NOW)).toBe(false);
  });

  it("FALSE for an unparseable or absent stamp — the direction that refuses LESS", async () => {
    makeAdmin([{ user_id: OTHER, updated_at: "not-a-date" }]);
    expect(await agentIsAnotherMembers(WS, AGENT, ME, NOW)).toBe(false);
    makeAdmin([{ user_id: OTHER }]);
    expect(await agentIsAnotherMembers(WS, AGENT, ME, NOW)).toBe(false);
  });

  it("FALSE when the projection table is unavailable", async () => {
    makeAdmin([], { code: "PGRST205", message: "relation does not exist" });
    expect(await agentIsAnotherMembers(WS, AGENT, ME, NOW)).toBe(false);
  });
});
