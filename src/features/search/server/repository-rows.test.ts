/**
 * The query shape: what actually reaches PostgREST, recorded rather than
 * simulated. `_fake-db.ts` proves which ROWS survive; this proves which FILTERS
 * were written — the half a filtering fake cannot fail on, since a misspelled
 * operator still excludes the right rows in a fake sharing the misunderstanding.
 *
 * The properties that fail quietly:
 *  - `ilike` is a pattern match and the query is escaped (`100%` would match
 *    `100x`).
 *  - `.or()` values are quoted: its grammar splits on `,` and `.`. Since F-716
 *    the only `.or()` left here is the members one.
 *  - The visibility projection: a predicate reads columns SQL no longer filters
 *    on, and a dropped column reads as its fail-closed default.
 *  - F-717: the full-text arms name `simple` on the QUERY side. One case asserts
 *    the operator postgrest-js actually renders, which the recorder cannot see.
 *  - The soft-delete / retirement filters (`deleted_at`, `dissolved_at`).
 *
 * MUTATION-VERIFY: 6 reverts, 6 failures, 0 vacuous (2026-09-17).
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
  searchAgentIdentities,
  searchChats,
  searchKnowledgeEntries,
  searchMembers,
  searchSkills,
} from "./repository-container-rows";
import { SEARCH_GROUP_TOTAL_CAP } from "../contracts";
import { SEARCH_CANDIDATE_ROW_LIMIT } from "./repository-visibility";

const ME = "11111111-1111-1111-1111-111111111111";
/** The caller, as the four predicates need them (F-716). `ownerUserId: null` is
 *  the shared-credential shape. */
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
    ["agent identities", () => searchAgentIdentities([WS], "100%_x", caller()), "name"],
    ["skills", () => searchSkills(WS, "100%_x", caller()), "name"],
    ["chats", () => searchChats(WS, "100%_x", caller()), "title"],
  ])("%s", async (_label, run, column) => {
    const calls = recorder();
    await run();
    // The metacharacters the caller typed are escaped; only the wrapping `%` are
    // wildcards.
    expect(argOf(calls, "ilike", column)).toBe("%100\\%\\_x%");
  });
});

describe("🔒 the visibility narrowing is the PREDICATE's, not SQL's (F-716)", () => {
  it.each([
    ["knowledge bases", () => listReadableBases([WS], caller()), "visibility, created_by"],
    ["agent identities", () => searchAgentIdentities([WS], "q", caller()), "visibility, created_by"],
    ["skills", () => searchSkills(WS, "q", caller()), "visibility, access_mode, created_by"],
    ["chats", () => searchChats(WS, "q", caller()), "visibility, access_mode, owner_id"],
  ])("%s: no visibility filter, and the columns the predicate reads", async (_l, run, cols) => {
    const calls = recorder();
    await run();
    // No `.or()` and no `visibility` eq: visibility is decided by the owning
    // feature's `canSee*` over the fetched page. A SQL restatement here is the
    // fifth copy F-716 exists to refuse.
    expect(of(calls, "or")).toHaveLength(0);
    expect(argOf(calls, "eq", "visibility")).toBeUndefined();
    // The projection must carry what the predicate asks for: a dropped column
    // makes every row read as its fail-closed default, a silent narrowing.
    const select = String(of(calls, "select")[0]?.args[0]);
    for (const col of cols.split(", ")) expect(select).toContain(col);
  });

  it.each([
    ["knowledge bases", () => listReadableBases([WS], caller(null))],
    ["agent identities", () => searchAgentIdentities([WS], "q", caller(null))],
    ["skills", () => searchSkills(WS, "q", caller(null))],
    ["chats", () => searchChats(WS, "q", caller(null))],
  ])("%s: a SHARED credential gets NO cheaper SQL arm either", async (_l, run) => {
    const calls = recorder();
    await run();
    // `visibility='public'` admits an `access_mode='teams'` row that
    // `canSeeSkill`/`canSeeChat` refuse, so a cheap SQL arm is not equal to the
    // predicate on two of the four tables. One path, one authority.
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
    // `search_tsv` since F-715 closed. `config` is the F-717 fix and is not
    // optional: it parameterises the tsquery FUNCTION, not the column, so dropped
    // the query side falls to english against a `simple` vector.
    // No `type` — the raw `fts` form is `to_tsquery`, the only one that honours
    // the `:*` the builder puts on the last token.
    expect(of(calls, "textSearch")[0]?.args).toEqual([
      "search_tsv",
      "zephyr & ship:*",
      { config: "simple" },
    ]);
  });

  it("🔒 renders `fts(simple).` on the wire, through the REAL builder", async () => {
    // The recorder cannot see this, and it is the half that broke: `{config}`
    // and `{type}` are two spellings of one option object, and only postgrest-js
    // can say which operator it renders. A captured `fetch` is the cheapest ask.
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
    // `search_tsv` decides which rows but is a lexeme vector, so dropping `body`
    // would return hits with no snippet and no way to make one.
    expect(String(of(calls, "select")[0]?.args[0])).toContain("body");
  });

  it("🔒 reads the knowledge column the SAME way — one spelling, two arms", async () => {
    const calls = recorder([[], []]);
    await searchKnowledgeEntries(
      new Map([["kb", { name: "Handbook", containerId: WS }]]),
      "zephyr"
    );
    // The knowledge arm carried the same omitted-`config` bug (F-717) and is
    // spelled identically to the message arm, which is the point.
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
    // An empty tsquery matches nothing; asking for it is a round trip to learn
    // that.
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
    // A dissolved card is retired, never deleted: the row survives so an old id
    // still resolves, but listing one would offer a card that folds nothing.
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
      searchAgentIdentities([], "q", caller()),
      listReadableBases([], caller()),
      searchKnowledgeEntries(new Map(), "q"),
    ]);
    // `.in("x", [])` is a legal filter that returns nothing; spending a round
    // trip to learn it is a per-keystroke cost.
    expect(calls).toEqual([]);
  });
});

describe("members", () => {
  it("matches the display name by CONTAINS and the email by PREFIX", async () => {
    const calls = recorder([[{ user_id: ME }], []]);
    await searchMembers(WS, "Mine", "sam");
    // A contains-match on an address turns `com` into a roster dump.
    expect(of(calls, "or")[0]?.args[0]).toBe(
      'display_name.ilike."%sam%",email.ilike."sam%"'
    );
    expect(argOf(calls, "eq", "status")).toBe("active");
  });
});
