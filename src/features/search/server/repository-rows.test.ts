/**
 * THE QUERY SHAPE — what actually reaches PostgREST, recorded rather than
 * simulated. `_fake-db.ts` proves which ROWS survive; this proves which FILTERS
 * were written, which is the half a filtering fake can never fail on: an
 * operator spelled wrongly still excludes the right rows in a fake written to
 * the same misunderstanding.
 *
 * Same chainable-recorder idiom as
 * `channels/server/repository-account.test.ts`.
 *
 * The properties that fail quietly:
 *  - 🔒 **`ilike` IS A PATTERN MATCH AND THE QUERY IS ESCAPED.** Unescaped, a
 *    search for `100%` matches `100x` and `a_b` matches `axb`.
 *  - 🔒 **`.or()` VALUES ARE QUOTED.** Its grammar splits on `,` and `.`, so an
 *    unquoted value a person typed rewrites the filter's SHAPE — and on three of
 *    these tables that filter IS the visibility fence.
 *  - **THE FULL-TEXT ARM IS `websearch` + `simple` ON BOTH SIDES.** A mismatched
 *    dictionary across `@@` returns nothing and explains nothing.
 *  - **THE SOFT-DELETE / RETIREMENT FILTERS** — `deleted_at`, `dissolved_at`.
 *
 * MUTATION-VERIFY: 4 reverts, 4 failures, 0 vacuous (2026-09-17) — dropping the
 * `escapeLikeLiteral` call, dropping `orLiteral`, switching the message arm's
 * `config` to `english`, and dropping `.is("dissolved_at", null)` each turn a
 * case here red.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  searchArtifacts,
  searchChannels,
  searchMessages,
  searchThreads,
} from "./repository-channel-rows";
import {
  listReadableBases,
  searchAgentTemplates,
  searchChats,
  searchKnowledgeEntries,
  searchMembers,
  searchSkills,
} from "./repository-container-rows";
import { SEARCH_GROUP_TOTAL_CAP } from "../contracts";

const ME = "11111111-1111-1111-1111-111111111111";
const WS = "33333333-3333-3333-3333-333333333333";
const CH = "55555555-5555-5555-5555-555555555555";

type Call = { op: string; args: unknown[] };

/** A chainable recorder — every builder method returns `this` and logs. */
function recorder(results: unknown[][] = []) {
  const calls: Call[] = [];
  const pending = [...results];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    select: (c: string) => rec("select", [c]),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    in: (c: string, v: unknown) => rec("in", [c, v]),
    is: (c: string, v: unknown) => rec("is", [c, v]),
    or: (f: string) => rec("or", [f]),
    ilike: (c: string, v: unknown) => rec("ilike", [c, v]),
    textSearch: (c: string, q: string, o: unknown) =>
      rec("textSearch", [c, q, o]),
    order: (c: string, o: unknown) => rec("order", [c, o]),
    limit: (n: number) => rec("limit", [n]),
    then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
      resolve({ data: pending.shift() ?? [], error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

const of = (calls: Call[], op: string) => calls.filter((c) => c.op === op);
const argOf = (calls: Call[], op: string, column: string) =>
  calls.find((c) => c.op === op && c.args[0] === column)?.args[1];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("🔒 the ilike arms escape the query", () => {
  it.each([
    ["channels", () => searchChannels([CH], "100%_x"), "name"],
    ["threads", () => searchThreads([CH], "100%_x"), "title"],
    ["artifacts", () => searchArtifacts([CH], "100%_x"), "name"],
    ["agent templates", () => searchAgentTemplates([WS], "100%_x", ME), "name"],
    ["skills", () => searchSkills(WS, "100%_x", ME), "name"],
    ["chats", () => searchChats(WS, "100%_x", ME), "title"],
  ])("%s", async (_label, run, column) => {
    const calls = recorder();
    await run();
    // ⚠ The metacharacters the CALLER typed are escaped; only the wrapping `%`
    // are wildcards.
    expect(argOf(calls, "ilike", column)).toBe("%100\\%\\_x%");
  });
});

describe("🔒 the .or() visibility arms are quoted", () => {
  it.each([
    ["knowledge bases", () => listReadableBases([WS], ME), "visibility", "public", "created_by"],
    ["agent templates", () => searchAgentTemplates([WS], "q", ME), "visibility", "workspace", "created_by"],
    ["skills", () => searchSkills(WS, "q", ME), "visibility", "public", "created_by"],
    ["chats", () => searchChats(WS, "q", ME), "visibility", "public", "owner_id"],
  ])("%s", async (_label, run, column, widest, ownerColumn) => {
    const calls = recorder();
    await run();
    expect(of(calls, "or")[0]?.args[0]).toBe(
      `${column}.eq."${widest}",${ownerColumn}.eq."${ME}"`
    );
  });

  it("collapses to a one-armed eq for a credential with nobody behind it", async () => {
    const calls = recorder();
    await searchSkills(WS, "q", null);
    // ⚠ NOT a one-armed `.or()` — a filter shaped like a two-armed one invites
    // the next editor to "complete" it with an owner that stands for nobody.
    expect(of(calls, "or")).toHaveLength(0);
    expect(argOf(calls, "eq", "visibility")).toBe("public");
  });
});

describe("🔒 the full-text arms", () => {
  it("asks for websearch + simple over the message BODY column", async () => {
    const calls = recorder();
    await searchMessages([CH], "zephyr ship");
    // ⚠ `body`, NOT `search_tsv`: `20261007120000_search_fulltext_indexes.sql`
    // is WRITTEN, NOT APPLIED, and naming a column that does not exist yet makes
    // this route broken rather than slow.
    expect(of(calls, "textSearch")[0]?.args).toEqual([
      "body",
      "zephyr ship",
      { type: "websearch", config: "simple" },
    ]);
  });

  it("reads the LIVE generated column for knowledge, with no config", async () => {
    const calls = recorder([[], []]);
    await searchKnowledgeEntries(
      new Map([["kb", { name: "Handbook", containerId: WS }]]),
      "zephyr"
    );
    // ⚠ The dictionary is fixed INSIDE `knowledge_entries.search_tsv`
    // (`20260501020000_knowledge_fulltext.sql`); a second one here would ask
    // PostgREST to build a `to_tsvector` over a value that already is one.
    expect(of(calls, "textSearch")[0]?.args).toEqual([
      "search_tsv",
      "zephyr",
      { type: "websearch" },
    ]);
    // Two arms — the FTS one cannot prefix-match a half-typed word.
    expect(of(calls, "ilike")[0]?.args).toEqual(["title", "%zephyr%"]);
  });

  it("restricts messages to the kind a person actually typed", async () => {
    const calls = recorder();
    await searchMessages([CH], "zephyr");
    expect(argOf(calls, "eq", "kind")).toBe("message");
  });
});

describe("the lifecycle filters", () => {
  it("drops tombstoned channels, dissolved artifacts and deleted rows", async () => {
    const channelCalls = recorder();
    await searchChannels([CH], "q");
    expect(of(channelCalls, "is")[0]?.args).toEqual(["deleted_at", null]);

    const artifactCalls = recorder();
    await searchArtifacts([CH], "q");
    // ⚠ A dissolved card is RETIRED, never deleted — the row survives so an old
    // id still resolves, and listing one would offer a card that folds nothing.
    expect(of(artifactCalls, "is")[0]?.args).toEqual(["dissolved_at", null]);

    const skillCalls = recorder();
    await searchSkills(WS, "q", ME);
    expect(of(skillCalls, "is")[0]?.args).toEqual(["deleted_at", null]);
  });
});

describe("the bounds", () => {
  it("caps every group read at the total ceiling", async () => {
    for (const run of [
      () => searchChannels([CH], "q"),
      () => searchThreads([CH], "q"),
      () => searchArtifacts([CH], "q"),
      () => searchMessages([CH], "q"),
    ]) {
      const calls = recorder();
      await run();
      expect(of(calls, "limit")[0]?.args[0]).toBe(SEARCH_GROUP_TOTAL_CAP);
    }
  });

  it("short-circuits with NO query on an empty fence", async () => {
    const calls = recorder();
    await Promise.all([
      searchChannels([], "q"),
      searchMessages([], "q"),
      searchThreads([], "q"),
      searchArtifacts([], "q"),
      searchAgentTemplates([], "q", ME),
      listReadableBases([], ME),
      searchKnowledgeEntries(new Map(), "q"),
    ]);
    // ⚠ `.in("x", [])` is a legal filter that returns nothing; spending a round
    // trip to learn it is a per-keystroke cost.
    expect(calls).toEqual([]);
  });
});

describe("members", () => {
  it("matches the display name by CONTAINS and the email by PREFIX", async () => {
    const calls = recorder([[{ user_id: ME }], []]);
    await searchMembers(WS, "Mine", "sam");
    // ⚠ A contains-match on an address turns `com` into a roster dump.
    expect(of(calls, "or")[0]?.args[0]).toBe(
      'display_name.ilike."%sam%",email.ilike."sam%"'
    );
    expect(argOf(calls, "eq", "status")).toBe("active");
  });
});
