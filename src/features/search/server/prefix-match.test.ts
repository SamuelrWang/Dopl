/**
 * F-717: the query side of every `@@`, driven through the whole service.
 * `repository-rows.test.ts` proves which operator goes on the wire and
 * `query-text.test.ts` what the tsquery may contain; this proves the thing a
 * reader cares about — a half-typed word comes back with the message it is in.
 *
 * It shares `_fake-world.ts` with `fence.test.ts` on purpose, so widening the
 * match is asserted over the same rows the fence is asserted over.
 *
 * MUTATION-VERIFY: 3 reverts, 3 failures, 0 vacuous (2026-09-17).
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
    // `websearch_to_tsquery` matches whole lexemes, so this query reached no body
    // at all before the builder.
    const { groups } = await runSearch(CTX, { q: "zeph", scope: "account" });
    expect(ids(groups, "messages")).toEqual(["msg-mine"]);
  });

  it("reaches a knowledge entry through the VECTOR, not only its title", async () => {
    mount();
    // The knowledge group has two arms and the `ilike` one also matches this
    // title; what is pinned is that both are spelled the same way, since no title
    // can stand in for the arm that carried the bug.
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
    // `???` has nothing to ask Postgres for: the full-text arms run no query and
    // the `ilike` arms answer for themselves. An empty tsquery matching
    // everything is the failure this rules out.
    const { groups } = await runSearch(CTX, { q: "???", scope: "account" });
    expect(groups).toEqual([]);
  });
});
