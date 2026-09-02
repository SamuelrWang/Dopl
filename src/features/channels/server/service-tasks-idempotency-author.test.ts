/**
 * IDEMPOTENCY IS A SAME-AUTHOR RETRY CONTRACT — THE THREAD HALF (2026-09-02,
 * C14). The message half shipped on 2026-08-22 and is pinned by
 * `service-writes-idempotency-author.test.ts`; this file is the same rule on
 * `channel_tasks`, pinned at the two layers a service test over a mocked
 * repository cannot see.
 *
 * ── THE VULNERABILITY ────────────────────────────────────────────────────────
 * `createTask`'s short-circuit read `(channel_id, client_msg_id)` and the unique
 * index behind it said the same, so "I already sent this, give me back what you
 * stored" was a contract with the whole ROOM. A member who used a key another
 * member had used was handed back THEIR thread — and the served MCP schema
 * taught it as behaviour ("a key another member used hands you back THEIR
 * thread"), which makes it a documented redirect rather than a discovered one.
 * The keys are derived: `service-tasks-fanout.ts › addresseeClientMsgId` mints
 * `${base}:${toUserId}` over ids every channel member can read.
 *
 * ── WHY THE INDEX IS ASSERTED HERE TOO ───────────────────────────────────────
 * Author-scoping only the READ moves the failure rather than fixing it: the
 * probe misses, the INSERT hits a still channel-scoped unique index, and the
 * race repair — also author-scoped — finds nothing and rethrows a `23505` the
 * caller sees as a 500. The service tests run against a MOCKED repository and
 * would be perfectly green over exactly that.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import * as repoTasks from "./repository-tasks";

const ME = "aaaaaaaa-e29b-41d4-a716-446655440000";
const KEY = "fanout-7:bbbbbbbb-e29b-41d4-a716-446655440000";

// ── LAYER 1: the query shape that actually reaches PostgREST ────────────────
//
// ⚠ THE FILTER STRING IS THE ONLY PLACE THIS IS VISIBLE. A service test over a
// mocked repository only sees WHICH function was called, never whether it
// narrows by author at all.

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

describe("the thread idempotency probe belongs to its creator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("narrows by channel, key AND creator", async () => {
    const calls = makeAdmin();

    await repoTasks.findOwnTaskByClientId("chan-1", ME, KEY);

    expect(calls.find((c) => c.op === "from")?.args[0]).toBe("channel_tasks");
    expect(eqFilters(calls)).toEqual({
      channel_id: "chan-1",
      client_msg_id: KEY,
      created_by: ME,
    });
  });

  it("has no channel-scoped sibling left to be used as a probe by mistake", () => {
    // ⚠ THE MESSAGE TABLE KEPT ONE FOR A REASON THAT NO LONGER EXISTS HERE. Its
    // cross-author read served `storedOpeningSeq`, the arm a create took when it
    // converged on somebody else's thread; that arm went with this change, so a
    // second door would be an orphan and orphans read as live.
    expect(Object.keys(repoTasks)).not.toContain("findTaskByClientId");
  });
});

// ── LAYER 2: the database agrees, or none of the above is enforced ──────────

describe("the unique index states the same rule as the query", () => {
  const sql = readdirSync(join(process.cwd(), "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(process.cwd(), "supabase", "migrations", f), "utf8"))
    .join("\n");

  it("channel_tasks' idempotency index carries the creator, and the pair index is dropped", () => {
    const created = [
      ...sql.matchAll(
        /CREATE UNIQUE INDEX (?:IF NOT EXISTS )?(\w+)\s+ON (?:public\.)?channel_tasks\s*\(([^()]*)\)/g
      ),
    ].map((m) => ({ name: m[1], cols: m[2].split(",").map((c) => c.trim()) }));

    const triple = created.find((i) => i.name === "channel_tasks_client_msg_author_key");
    expect(triple, "20260913120000 no longer creates the author-scoped index").toBeTruthy();
    expect(triple?.cols).toEqual(["channel_id", "client_msg_id", "created_by"]);

    // The channel-scoped one must be GONE, not merely joined by a wider sibling —
    // it is the constraint that turns a foreign pre-claim into a 23505.
    expect(sql).toMatch(/DROP INDEX IF EXISTS public\.channel_tasks_client_msg_key;/);
  });
});
