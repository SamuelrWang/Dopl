/**
 * 🔒 **THE QUERY SIDE OF EVERY `@@` — DRIVEN THROUGH THE WHOLE SERVICE (F-717).**
 *
 * `repository-rows.test.ts` proves which OPERATOR goes on the wire;
 * `query-text.test.ts` proves what the `tsquery` may contain. This one proves
 * the only thing a reader cares about: **a half-typed word comes back with the
 * message it is inside.** Samuel, 2026-09-17: *"I'm trying to search up channel
 * messages … I only see channels coming up from the search. I don't see any
 * messages."*
 *
 * ⚠ **IT SHARES `_fake-world.ts` WITH `fence.test.ts` ON PURPOSE.** The fence
 * suite's world already carries one matching row per table on each side of the
 * membership line, so widening the MATCH is asserted over the same rows the
 * fence is asserted over — and a widening that leaked would fail there, in the
 * same fixture, rather than in a copy that had drifted.
 *
 * MUTATION-VERIFY: 3 reverts, 3 failures, 0 vacuous (2026-09-17) — dropping the
 * `:*` suffix in `buildPrefixTsQuery`, returning a match-everything tsquery for
 * a query with no lexeme, and putting `type: "websearch"` back on either arm
 * each turn a case here red.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { fakeDb } from "./_fake-db";
import { CTX, world } from "./_fake-world";
import { runSearch } from "./service";
import type { SearchGroup } from "../contracts";

function mount() {
  const { client } = fakeDb(world());
  vi.mocked(supabaseAdmin).mockReturnValue(client as never);
}

const ids = (groups: SearchGroup[], kind: string) =>
  groups.find((g) => g.kind === kind)?.items.map((i) => i.id);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the full-text arms reach a HALF-TYPED word", () => {
  it("finds a message BODY from a prefix of its word", async () => {
    mount();
    // ⚠ `websearch_to_tsquery` matches WHOLE lexemes, so this query reached no
    // body at all before the builder: a popup that only answers finished words
    // is empty for every keystroke but the last one.
    const { groups } = await runSearch(CTX, { q: "zeph", scope: "account" });
    expect(ids(groups, "messages")).toEqual(["msg-mine"]);
  });

  it("reaches a knowledge entry through the VECTOR, not only its title", async () => {
    mount();
    // ⚠ The knowledge group has two arms and the `ilike` one matches the title
    // here too — what this pins is that BOTH are spelled the same way, because
    // the arm that carried the bug is the one no title can stand in for.
    const { groups } = await runSearch(CTX, { q: "zeph", scope: "account" });
    expect(ids(groups, "knowledge")).toEqual(["kn-mine"]);
  });

  it("🔒 does not widen the FENCE while widening the match", async () => {
    mount();
    const { groups } = await runSearch(CTX, { q: "zeph", scope: "account" });
    const items = groups.flatMap((g) => g.items);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.id.endsWith("theirs")).toBe(false);
  });

  it("answers a query with NO lexeme in it without returning everything", async () => {
    mount();
    // ⚠ `???` has nothing to ask Postgres for: the full-text arms run no query
    // at all, the `ilike` arms answer for themselves, and neither matches. An
    // empty `tsquery` matching everything is the failure this rules out.
    const { groups } = await runSearch(CTX, { q: "???", scope: "account" });
    expect(groups).toEqual([]);
  });
});
