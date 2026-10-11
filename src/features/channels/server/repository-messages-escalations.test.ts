/**
 * **THE TYPED-ANSWER CANDIDATE READ'S QUERY SHAPE** — what actually reaches
 * PostgREST on the POST path **that every message pays**.
 *
 * ⚠ **THE PROJECTION IS THE POINT (2026-10-11).** This read was `select("*")`,
 * and `*` returns STORED GENERATED columns: `channel_messages.search_tsv`
 * (`20261007120000`) is roughly body-sized, so the scan carried up to
 * `ESCALATION_SCAN_LIMIT` of them out of Postgres and through a JSON parse for a
 * mapper that never looks at one — the exact cost `dto-rows.ts ›
 * CHANNEL_MESSAGE_COLS` was cut for the transcript page reads, on a path with no
 * transcript to show for it.
 *
 * Supabase is mocked with a chainable builder that records every call, the
 * pattern `repository-messages.test.ts` uses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { listRecentEscalations } from "./repository-messages-escalations";
import { CHANNEL_MESSAGE_COLS } from "./dto";

const CHANNEL = "chan-1";

type Call = { op: string; args: unknown[] };

/** Chainable, thenable Supabase-builder stub — records its calls, hits no DB. */
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
    not: (c: string, o: string, v: unknown) => rec("not", [c, o, v]),
    order: (c: string, o: unknown) => rec("order", [c, o]),
    limit: (n: number) => rec("limit", [n]),
    then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
      resolve({ data: [], error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

const opArgs = (calls: Call[], op: string) =>
  calls.find((c) => c.op === op)?.args ?? [];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listRecentEscalations — the projection", () => {
  it("🔒 NAMES ITS COLUMNS AND NEVER SHIPS `search_tsv`", async () => {
    const calls = makeAdmin();

    await listRecentEscalations(CHANNEL);

    const projection = String(opArgs(calls, "select")[0]);
    // 🔒 `*` would return the stored generated tsvector per row, 25 of them, on
    // every POST.
    expect(projection).not.toBe("*");
    expect(projection).not.toContain("search_tsv");
    // 🔒 **THE SHARED CONSTANT, NOT A SECOND LIST.** A copy here is a projection
    // that stops agreeing with `ChannelMessageRow` the next time a column lands,
    // and `dto-rows.ts` carries the argument for naming the optional ones.
    expect(projection).toBe(CHANNEL_MESSAGE_COLS);
    // The service reads these off every candidate — the payload and the stamped
    // mentions, the fallback answerer, the derived agent id, and the row's id.
    for (const column of ["metadata", "author_user_id", "client_msg_id", "id"]) {
      expect(projection.split(",")).toContain(column);
    }
  });

  it("still scans this channel's cards, newest first, bounded", async () => {
    const calls = makeAdmin();

    await listRecentEscalations(CHANNEL);

    expect(opArgs(calls, "from")[0]).toBe("channel_messages");
    expect(opArgs(calls, "eq")).toEqual(["channel_id", CHANNEL]);
    // ⚠ The CARD filter, as a JSON path — not a body or a kind.
    expect(opArgs(calls, "not")).toEqual(["metadata->escalation", "is", null]);
    // `seq` DESC is TOTAL per channel, so "the most recent" has no tie to break.
    expect(opArgs(calls, "order")).toEqual(["seq", { ascending: false }]);
    expect(opArgs(calls, "limit")[0]).toBe(25);
  });

  it("honours an explicit limit", async () => {
    const calls = makeAdmin();

    await listRecentEscalations(CHANNEL, 5);

    expect(opArgs(calls, "limit")[0]).toBe(5);
  });
});
