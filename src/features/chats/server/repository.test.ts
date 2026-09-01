/**
 * THE CHAT LIST'S CEILING — the query shape that reaches PostgREST, and the rule
 * that decides whether the read admits to being clipped.
 *
 * ⚠ THE CLIP IS MEASURED ON THE RAW ROWS, BEFORE ANY VISIBILITY FILTER, and that
 * is the assertion worth keeping: the service filters this list down afterwards
 * (`service-reads.ts › listChats`), so a page that filters to nothing out of a
 * full read is still a page that did not reach the end of the archive. Measuring
 * after the filter would report it as exhausted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { CHAT_LIST_LIMIT } from "../constants";
import { listVisibleChats, type ChatRowWithCount } from "./repository";

const WS = "ws-1";
const USER = "u-1";

type Call = { op: string; args: unknown[] };

function chatRow(id: string): ChatRowWithCount {
  return { id, chat_messages: [{ count: 0 }] } as unknown as ChatRowWithCount;
}

/** Chainable, thenable Supabase-builder stub — the shape
 *  `channels/server/repository-messages.test.ts` uses, for the same reason. */
function makeAdmin(rows: ChatRowWithCount[]) {
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
    or: (f: string) => rec("or", [f]),
    gte: (c: string, v: unknown) => rec("gte", [c, v]),
    order: (c: string, o: unknown) => rec("order", [c, o]),
    limit: (n: number) => rec("limit", [n]),
    then: (resolve: (r: { data: ChatRowWithCount[]; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

const full = () =>
  Array.from({ length: CHAT_LIST_LIMIT }, (_, i) => chatRow(`c-${i}`));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listVisibleChats", () => {
  it("carries a limit and stays newest-first", async () => {
    const calls = makeAdmin([chatRow("c-1")]);

    await listVisibleChats(WS, USER);

    expect(calls.find((c) => c.op === "limit")?.args).toEqual([CHAT_LIST_LIMIT]);
    expect(calls.find((c) => c.op === "order")?.args).toEqual([
      "updated_at",
      { ascending: false },
    ]);
  });

  it("reports a short read as EXHAUSTED", async () => {
    makeAdmin([chatRow("c-1")]);
    await expect(listVisibleChats(WS, USER)).resolves.toMatchObject({
      truncated: false,
    });
  });

  it("reports a read AT the ceiling as CLIPPED", async () => {
    // ⚠ AT, not over — the query can never return more than the ceiling, so a
    // strict `>` would mean the flag never fires and the bound is invisible.
    makeAdmin(full());
    await expect(listVisibleChats(WS, USER)).resolves.toMatchObject({
      truncated: true,
    });
  });

  it("still applies the retention cutoff, and only when one is given", async () => {
    const windowed = makeAdmin([chatRow("c-1")]);
    await listVisibleChats(WS, USER, "2026-04-17");
    expect(windowed.find((c) => c.op === "gte")?.args).toEqual([
      "session_date",
      "2026-04-17",
    ]);

    const fullHistory = makeAdmin([chatRow("c-1")]);
    await listVisibleChats(WS, USER, null);
    expect(fullHistory.some((c) => c.op === "gte")).toBe(false);
  });
});
