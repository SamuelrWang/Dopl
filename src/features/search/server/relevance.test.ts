/**
 * (2026-09-29) Samuel searched `can't` and got rows that did not contain it, with
 * single letters (`t`) marked all over the snippets. Two bugs, one cause: the
 * apostrophe was treated as a SEPARATOR — the tsquery became `can & t:*` ("the
 * word can anywhere, and any word starting with t anywhere") and the highlighter
 * hunted a one-letter term `t`.
 *
 * Driven through the whole service over the shared fake world, so the tsquery
 * builder, the candidate arms, the relevance filter and the snippet are all in
 * the loop.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { fakeDb } from "./_fake-db";
import { CH_MINE, CTX, WS_MINE, world } from "./_fake-world";
import { runSearch } from "./service";
import type { SearchGroup } from "../contracts";

function message(id: string, body: string, minute: number) {
  return {
    id,
    seq: 100 + minute,
    body,
    kind: "message",
    channel_id: CH_MINE,
    workspace_id: WS_MINE,
    created_at: `2026-09-02T00:${String(minute).padStart(2, "0")}:00Z`,
  };
}

function mount() {
  const tables = world();
  tables.channel_messages = [
    ...(tables.channel_messages ?? []),
    message("m-straight", "I can't make it today", 1),
    message("m-curly", "We can’t ship that yet", 2),
    // Has `can` and plenty of words starting with `t` — the old tsquery's hit.
    message("m-noise", "And we can estimate this through the tests", 3),
    message("m-take", "you can take the rest", 4),
    message("m-cant-in-word", "scan'tly spelled nonsense", 5),
    message("m-dont", "Don't panic", 6),
    message("m-don", "don the hat today", 7),
  ];
  tables.knowledge_entries = [
    ...(tables.knowledge_entries ?? []),
    {
      id: "kn-charge",
      title: "Charge the operator",
      body: "Status: SHIPPED. Charge the operator for navigation trials.",
      knowledge_base_id: "kb-mine",
      workspace_id: WS_MINE,
      updated_at: "2026-09-02T00:00:00Z",
      deleted_at: null,
    },
    {
      id: "kn-cant",
      title: "Why agents can’t post",
      body: "Agents can't post before the wake rule fires.",
      knowledge_base_id: "kb-mine",
      workspace_id: WS_MINE,
      updated_at: "2026-09-02T00:00:00Z",
      deleted_at: null,
    },
  ];
  const { client } = fakeDb(tables);
  vi.mocked(supabaseAdmin).mockReturnValue(client as never);
}

const group = (groups: SearchGroup[], kind: string) =>
  groups.find((g) => g.kind === kind);
const ids = (groups: SearchGroup[], kind: string) =>
  (group(groups, kind)?.items.map((i) => i.id) ?? []).sort();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("🔒 `can't` finds `can't` and nothing else", () => {
  it("returns only the rows that SAY can't, in either apostrophe", async () => {
    mount();
    const { groups } = await runSearch(CTX, { q: "can't", scope: "account" });
    expect(ids(groups, "messages")).toEqual(["m-curly", "m-straight"]);
    expect(ids(groups, "knowledge")).toEqual(["kn-cant"]);
  });

  it("answers the curly spelling the same as the straight one", async () => {
    mount();
    const { groups } = await runSearch(CTX, { q: "can’t", scope: "account" });
    expect(ids(groups, "messages")).toEqual(["m-curly", "m-straight"]);
    expect(ids(groups, "knowledge")).toEqual(["kn-cant"]);
  });

  it("marks the WORD, contiguously — never a stray letter", async () => {
    mount();
    const { groups } = await runSearch(CTX, { q: "can't", scope: "account" });
    const snippets = (group(groups, "messages")?.items ?? []).map((i) => i.snippet ?? "");
    expect(snippets).toContain("I <mark>can&#39;t</mark> make it today");
    expect(snippets).toContain("We <mark>can’t</mark> ship that yet");
    for (const s of snippets) {
      for (const marked of s.match(/<mark>(.*?)<\/mark>/g) ?? []) {
        expect(marked.replace(/<\/?mark>/g, "").length).toBeGreaterThan(1);
      }
    }
  });

  it("don't behaves the same way", async () => {
    mount();
    const { groups } = await runSearch(CTX, { q: "don't", scope: "account" });
    // `don the hat today` has `don` and a `t…` word — the old `don & t:*` hit.
    expect(ids(groups, "messages")).toEqual(["m-dont"]);
  });
});

describe("plain, multi-word and short queries stay word-anchored", () => {
  it("a plain word matches as a word prefix, not mid-word", async () => {
    mount();
    const { groups } = await runSearch(CTX, { q: "ship", scope: "account" });
    // `shipped` and `ship` both start with it; nothing mid-word.
    expect(ids(groups, "messages")).toEqual(["m-curly", "msg-mine"]);
  });

  it("every word of a multi-word query must be in the row", async () => {
    mount();
    const { groups } = await runSearch(CTX, { q: "charge oper", scope: "account" });
    expect(ids(groups, "knowledge")).toEqual(["kn-charge"]);
    expect(group(groups, "messages")).toBeUndefined();
  });

  it("a two-letter query does not match inside words", async () => {
    mount();
    // `ca` sits inside `scan'tly` and `estimate`… only word STARTS count.
    const { groups } = await runSearch(CTX, { q: "ca", scope: "account" });
    expect(ids(groups, "messages")).toEqual([
      "m-curly",
      "m-noise",
      "m-straight",
      "m-take",
    ]);
  });
});
