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
 *    unquoted value a person typed rewrites the filter's SHAPE. ⚠ Since F-716
 *    the only `.or()` left in this feature is the MEMBERS one — the four
 *    visibility arms are gone, decided by each feature's own `canSee*` instead.
 *  - 🔒 **THE VISIBILITY PROJECTION.** A predicate reads columns SQL no longer
 *    filters on; a dropped column reads as its fail-closed default and narrows
 *    silently.
 *  - 🔒 **THE FULL-TEXT ARM NAMES `simple` ON THE QUERY SIDE (F-717).** The
 *    generated column fixes the VECTOR's dictionary and says nothing about the
 *    QUERY's; omitted, PostgREST falls to the server's
 *    `default_text_search_config` and a mismatched dictionary across `@@`
 *    returns nothing and explains nothing. One case asserts the OPERATOR
 *    postgrest-js actually renders, because that is the half the recorder
 *    cannot see.
 *  - **THE SOFT-DELETE / RETIREMENT FILTERS** — `deleted_at`, `dissolved_at`.
 *
 * MUTATION-VERIFY: 6 reverts, 6 failures, 0 vacuous (2026-09-17) — dropping the
 * `escapeLikeLiteral` call, dropping `orLiteral`, pointing the message arm back
 * at the `body` EXPRESSION form, dropping `.is("dissolved_at", null)`, dropping
 * `{config: "simple"}` from either full-text arm, and putting `type:
 * "websearch"` back each turn a case here red.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { createClient } from "@supabase/supabase-js";
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
import { SEARCH_CANDIDATE_ROW_LIMIT } from "./repository-visibility";

const ME = "11111111-1111-1111-1111-111111111111";
/** The caller, as the four predicates need them (F-716). ⚠ `ownerUserId: null`
 *  is the SHARED-credential shape and keeps the cheap SQL arm. */
const caller = (ownerUserId: string | null = ME) => ({
  userId: ME,
  ownerUserId,
  credentialSubjectUserId: ownerUserId,
  roleByContainer: new Map([[WS, "member" as const]]),
});
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
    ["agent templates", () => searchAgentTemplates([WS], "100%_x", caller()), "name"],
    ["skills", () => searchSkills(WS, "100%_x", caller()), "name"],
    ["chats", () => searchChats(WS, "100%_x", caller()), "title"],
  ])("%s", async (_label, run, column) => {
    const calls = recorder();
    await run();
    // ⚠ The metacharacters the CALLER typed are escaped; only the wrapping `%`
    // are wildcards.
    expect(argOf(calls, "ilike", column)).toBe("%100\\%\\_x%");
  });
});

describe("🔒 the visibility narrowing is the PREDICATE's, not SQL's (F-716)", () => {
  it.each([
    ["knowledge bases", () => listReadableBases([WS], caller()), "visibility, created_by"],
    ["agent templates", () => searchAgentTemplates([WS], "q", caller()), "visibility, created_by"],
    ["skills", () => searchSkills(WS, "q", caller()), "visibility, access_mode, created_by"],
    ["chats", () => searchChats(WS, "q", caller()), "visibility, access_mode, owner_id"],
  ])("%s: no visibility filter, and the columns the predicate reads", async (_l, run, cols) => {
    const calls = recorder();
    await run();
    // ⚠ **NO `.or()` AND NO `visibility` `eq`.** A person's visibility is
    // decided by the owning feature's `canSee*` over the fetched page
    // (`repository-visibility.ts`); a SQL restatement here is the fifth copy
    // F-716 exists to refuse.
    expect(of(calls, "or")).toHaveLength(0);
    expect(argOf(calls, "eq", "visibility")).toBeUndefined();
    // 🔒 AND THE PROJECTION CARRIES WHAT THE PREDICATE ASKS FOR. Dropping one
    // of these columns makes every row read as its fail-closed default, which
    // is a silent narrowing no other case here would see.
    const select = String(of(calls, "select")[0]?.args[0]);
    for (const col of cols.split(", ")) expect(select).toContain(col);
  });

  it.each([
    ["knowledge bases", () => listReadableBases([WS], caller(null))],
    ["agent templates", () => searchAgentTemplates([WS], "q", caller(null))],
    ["skills", () => searchSkills(WS, "q", caller(null))],
    ["chats", () => searchChats(WS, "q", caller(null))],
  ])("%s: a SHARED credential gets NO cheaper SQL arm either", async (_l, run) => {
    const calls = recorder();
    await run();
    // 🔒 **THE SHORTCUT WAS TRIED AND IT WAS WRONG.** `visibility='public'`
    // admits an `access_mode='teams'` row that `canSeeSkill`/`canSeeChat`
    // refuse, so a "cheap arm equal to arm 2" is not equal on two of the four
    // tables (`shared-rows.test.ts`'s sweep found the four combinations). One
    // path, one authority.
    expect(argOf(calls, "eq", "visibility")).toBeUndefined();
    expect(of(calls, "or")).toHaveLength(0);
  });

  it("asks for a CANDIDATE page, which the predicate then cuts", async () => {
    const calls = recorder();
    await searchSkills(WS, "q", caller());
    expect(of(calls, "limit")[0]?.args[0]).toBe(SEARCH_CANDIDATE_ROW_LIMIT);
  });
});

describe("🔒 the full-text arms", () => {
  it("🔒 reads the message GENERATED column, NAMING the dictionary", async () => {
    const calls = recorder();
    await searchMessages([CH], "zephyr ship");
    // ⚠ `search_tsv` since 2026-09-17, when `20261007120000_search_fulltext_
    // indexes.sql` was APPLIED (F-715 closed).
    // 🔒 **`config` IS THE FIX FOR F-717 AND IT IS NOT OPTIONAL.** PostgREST's
    // `config` parameterises the tsquery FUNCTION, not the column: dropped, the
    // query side falls to the server's `default_text_search_config` (english),
    // and an english-stemmed query against a `simple` vector matches nothing.
    // ⚠ NO `type` — the raw `fts` form is `to_tsquery`, the only one of the
    // three that honours the `:*` the builder puts on the last token.
    expect(of(calls, "textSearch")[0]?.args).toEqual([
      "search_tsv",
      "zephyr & ship:*",
      { config: "simple" },
    ]);
  });

  it("🔒 renders `fts(simple).` on the wire, through the REAL builder", async () => {
    // ⚠ **THE RECORDER ABOVE CANNOT SEE THIS AND IT IS THE HALF THAT BROKE.**
    // `{config}` and `{type}` are two spellings of one option object; what
    // matters is the OPERATOR postgrest-js renders from them, and only
    // postgrest-js can say. A captured `fetch` is the cheapest way to ask.
    const seen: string[] = [];
    const client = createClient("http://db.test", "service-role-key", {
      global: {
        fetch: ((input: RequestInfo | URL) => {
          seen.push(String(input));
          return Promise.resolve(
            new Response("[]", {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }) as typeof fetch,
      },
    });
    vi.mocked(supabaseAdmin).mockReturnValue(client);
    await searchMessages([CH], "pick");
    const url = new URL(seen[0] as string);
    expect(url.searchParams.get("search_tsv")).toBe("fts(simple).pick:*");
  });

  it("still selects `body` — the column the SNIPPET is cut from", async () => {
    const calls = recorder();
    await searchMessages([CH], "zephyr");
    // ⚠ MUTATION CHECK. `search_tsv` decides WHICH rows; it is a lexeme vector
    // and cannot be read back as prose, so dropping `body` from the projection
    // would return hits with no snippet and no way to make one.
    expect(String(of(calls, "select")[0]?.args[0])).toContain("body");
  });

  it("🔒 reads the knowledge column the SAME way — one spelling, two arms", async () => {
    const calls = recorder([[], []]);
    await searchKnowledgeEntries(
      new Map([["kb", { name: "Handbook", containerId: WS }]]),
      "zephyr"
    );
    // 🔒 The knowledge arm carried the same omitted-`config` bug as the message
    // arm (F-717) and is fixed the same way — the two are spelled identically,
    // which is the point.
    expect(of(calls, "textSearch")[0]?.args).toEqual([
      "search_tsv",
      "zephyr:*",
      { config: "simple" },
    ]);
    // Two arms — a prefix is not a CONTAINS, and `handbook` must still find
    // *Knowledge handbook*.
    expect(of(calls, "ilike")[0]?.args).toEqual(["title", "%zephyr%"]);
  });

  it("runs NO full-text query when nothing survives the allow-list", async () => {
    const calls = recorder();
    await searchMessages([CH], "???");
    // ⚠ An empty tsquery matches nothing; asking for it is a round trip to
    // learn that.
    expect(calls).toEqual([]);
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
    await searchSkills(WS, "q", caller());
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
      searchAgentTemplates([], "q", caller()),
      listReadableBases([], caller()),
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
