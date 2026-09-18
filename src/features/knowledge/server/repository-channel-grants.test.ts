/**
 * `repository-channel-grants.ts` — the raw I/O for the CHANNEL slice of
 * `resource_grants`.
 *
 * The property every pin shares: the service-role client bypasses RLS, so
 * `workspace_id` must be an explicit filter on every statement. `scope_type =
 * 'channel'` is as load-bearing since the channel and team grant tables were
 * folded into one — without it these reads answer a channel question with a
 * team's grants. The sweep at the bottom makes dropping either term red.
 *
 * `listChannelKnowledgeGrants` also pins the bounded fan: ONE query with
 * `resource_id IN (baseIds)`, and an empty base list short-circuits with NO
 * query (an empty `in` is a PostgREST syntax error anyway).
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHANNEL_RESOURCE_GRANT_COLS,
  deleteChannelKnowledgeGrant,
  listChannelGrantsForBase,
  listChannelKnowledgeGrants,
  listSharedBaseIds,
  upsertChannelKnowledgeGrant,
} from "./repository-channel-grants";

/**
 * A fake PostgREST builder recording the filter chain. Every filter and modifier
 * returns the builder, and the builder is THENABLE, so whichever call the
 * statement ends on resolves the configured result.
 */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls = {
    from: [] as string[],
    select: [] as string[],
    match: [] as Array<Record<string, unknown>>,
    in: [] as Array<[string, unknown]>,
    limit: [] as number[],
    upsert: [] as Array<[unknown, unknown]>,
    delete: 0,
  };
  const builder = {
    select(cols: string) {
      calls.select.push(cols);
      return builder;
    },
    match(filters: Record<string, unknown>) {
      calls.match.push(filters);
      return builder;
    },
    in(col: string, vals: unknown) {
      calls.in.push([col, vals]);
      return builder;
    },
    limit(n: number) {
      calls.limit.push(n);
      return builder;
    },
    upsert(row: unknown, opts: unknown) {
      calls.upsert.push([row, opts]);
      return builder;
    },
    delete() {
      calls.delete += 1;
      return builder;
    },
    single() {
      return Promise.resolve(result);
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
    // Thenable tail for the chains with no explicit terminal.
    then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(onOk, onErr);
    },
  };
  const from = vi.fn((t: string) => {
    calls.from.push(t);
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

/** The PROJECTED row: `channel_id` is an alias over the `scope_id` column. */
const ROW = {
  channel_id: "chan-1",
  resource_type: "knowledge_base",
  resource_id: "kb-1",
  workspace_id: "ws-1",
  level: "visible" as const,
  guest_write: true,
  created_by: "user-1",
  created_at: "2026-08-27T00:00:00Z",
  updated_at: "2026-08-27T00:00:00Z",
};

const CHANNEL_SLICE = {
  scope_type: "channel",
  resource_type: "knowledge_base",
};

describe("the table and the projection", () => {
  it("reads `resource_grants`, and projects `scope_id` back as `channel_id`", () => {
    // The alias is the module's contract with its service: storage says
    // `scope_id`, the domain here says `channel_id`. Dropping it silently blanks
    // every map key the service builds, reading as "nothing is shared".
    expect(CHANNEL_RESOURCE_GRANT_COLS).toContain("channel_id:scope_id");
    expect(CHANNEL_RESOURCE_GRANT_COLS).not.toMatch(/(^|\s)scope_type/);
  });
});

describe("listChannelKnowledgeGrants", () => {
  it("issues ONE workspace+scope+type+in(baseIds) query and returns the rows", async () => {
    const rows = [{ ...ROW, guest_write: false, created_by: null }];
    const { client, calls } = fakeClient({ data: rows, error: null });

    const out = await listChannelKnowledgeGrants(client, "ws-1", "chan-1", [
      "kb-1",
      "kb-2",
    ]);

    expect(out).toEqual(rows);
    expect(calls.from).toEqual(["resource_grants"]);
    expect(calls.match).toEqual([
      { workspace_id: "ws-1", scope_id: "chan-1", ...CHANNEL_SLICE },
    ]);
    expect(calls.in).toEqual([["resource_id", ["kb-1", "kb-2"]]]);
  });

  it("short-circuits an empty base list with no query at all", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    expect(await listChannelKnowledgeGrants(client, "ws-1", "chan-1", [])).toEqual(
      []
    );
    expect(calls.from).toEqual([]);
  });

  it("throws when the query errors", async () => {
    const { client } = fakeClient({ data: null, error: new Error("db down") });
    await expect(
      listChannelKnowledgeGrants(client, "ws-1", "chan-1", ["kb-1"])
    ).rejects.toThrow("db down");
  });
});

describe("listChannelGrantsForBase — the inverse read", () => {
  it("filters by workspace + type + THIS base and carries the ceiling", async () => {
    const { client, calls } = fakeClient({ data: [ROW], error: null });

    expect(await listChannelGrantsForBase(client, "ws-1", "kb-1", 200)).toEqual([
      ROW,
    ]);
    expect(calls.match).toEqual([
      { workspace_id: "ws-1", resource_id: "kb-1", ...CHANNEL_SLICE },
    ]);
    // An un-limited select is truncated SILENTLY by PostgREST.
    expect(calls.limit).toEqual([200]);
  });
});

describe("listSharedBaseIds — the card's `Shared` pill", () => {
  it("asks only about CHANNEL scopes, and de-duplicates the answer", async () => {
    // A team or container grant is a share too, but this pill belongs to the
    // channel panel, and widening it would be invisible: the answer stays a
    // boolean either way.
    const { client, calls } = fakeClient({
      data: [{ resource_id: "kb-1" }, { resource_id: "kb-1" }],
      error: null,
    });

    expect(await listSharedBaseIds(client, "ws-1", ["kb-1", "kb-2"], 400)).toEqual(
      ["kb-1"]
    );
    expect(calls.select).toEqual(["resource_id"]);
    expect(calls.match).toEqual([{ workspace_id: "ws-1", ...CHANNEL_SLICE }]);
  });

  it("short-circuits an empty base list with no query at all", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    expect(await listSharedBaseIds(client, "ws-1", [], 400)).toEqual([]);
    expect(calls.from).toEqual([]);
  });
});

describe("upsertChannelKnowledgeGrant", () => {
  it("upserts ON THE PK so a re-grant updates in place rather than 23505ing", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null });

    expect(
      await upsertChannelKnowledgeGrant(client, {
        workspaceId: "ws-1",
        channelId: "chan-1",
        baseId: "kb-1",
        level: "visible",
        guestWrite: true,
        createdBy: "user-1",
      })
    ).toEqual(ROW);

    expect(calls.upsert).toEqual([
      [
        {
          scope_type: "channel",
          scope_id: "chan-1",
          resource_type: "knowledge_base",
          resource_id: "kb-1",
          workspace_id: "ws-1",
          level: "visible",
          guest_write: true,
          // The grantor the validity trigger judges: `enforce_resource_grant()`
          // asks whether THIS user reaches both containers. Dropping the column
          // re-points the check at nobody rather than skipping it.
          created_by: "user-1",
        },
        // "One grant per (scope, resource)" IS the PK; this names it.
        { onConflict: "scope_type,scope_id,resource_type,resource_id" },
      ],
    ]);
  });

  it("propagates the trigger's error untranslated — the SERVICE owns that", async () => {
    const raise = {
      code: "P0001",
      message: "resource_grants: grantor u-1 may not share into container ws-2",
    };
    const { client } = fakeClient({ data: null, error: raise });
    await expect(
      upsertChannelKnowledgeGrant(client, {
        workspaceId: "ws-1",
        channelId: "chan-1",
        baseId: "kb-1",
        level: "visible",
        guestWrite: false,
        createdBy: "user-1",
      })
    ).rejects.toBe(raise);
  });
});

describe("deleteChannelKnowledgeGrant", () => {
  it("deletes ONE row, workspace-filtered — the PK alone would cross tenants", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });

    await deleteChannelKnowledgeGrant(client, "ws-1", "chan-1", "kb-1");

    expect(calls.delete).toBe(1);
    expect(calls.match).toEqual([
      {
        workspace_id: "ws-1",
        scope_id: "chan-1",
        resource_id: "kb-1",
        ...CHANNEL_SLICE,
      },
    ]);
  });

  it("treats deleting NOTHING as success — the end state asked for is reached", async () => {
    const { client } = fakeClient({ data: null, error: null });
    await expect(
      deleteChannelKnowledgeGrant(client, "ws-1", "chan-gone", "kb-1")
    ).resolves.toBeUndefined();
  });

  it("throws when the delete errors", async () => {
    const { client } = fakeClient({ data: null, error: new Error("db down") });
    await expect(
      deleteChannelKnowledgeGrant(client, "ws-1", "chan-1", "kb-1")
    ).rejects.toThrow("db down");
  });
});

/**
 * The sweep: every statement in the module, not the ones a test happened to
 * drive — a new function without the scope term would pass every case above by
 * not being in one.
 */
describe("every statement pins its slice of the shared grant table", () => {
  const SRC = readFileSync(
    resolve(__dirname, "repository-channel-grants.ts"),
    "utf8"
  );

  it("names `resource_grants`, and never the retired per-scope tables", () => {
    expect(SRC).not.toMatch(/from\(\s*["'`]channel_resource_grants/);
    expect(SRC).not.toMatch(/from\(\s*["'`]team_resource_access/);
  });

  it("routes every `.from(...)` through the one table constant", () => {
    const literals = [...SRC.matchAll(/\.from\(([^)]*)\)/g)].map((m) =>
      m[1].trim()
    );
    expect(literals.length).toBeGreaterThan(0);
    expect([...new Set(literals)]).toEqual(["GRANTS_TABLE"]);
  });

  it("spreads CHANNEL_KNOWLEDGE_GRANT into every filter set and every write", () => {
    // Counting the spreads is what makes a NEW statement without one fail,
    // rather than only the statements enumerated above.
    const filterSets = SRC.match(/\.match\(\{/g)?.length ?? 0;
    const writes = SRC.match(/\.upsert\(\s*\{/g)?.length ?? 0;
    const spreads = SRC.match(/\.\.\.CHANNEL_KNOWLEDGE_GRANT/g)?.length ?? 0;
    expect(filterSets).toBeGreaterThan(0);
    expect(writes).toBe(1);
    expect(spreads).toBe(filterSets + writes);
  });

  it("carries `workspace_id` on every filter set — the RLS bypass is contained", () => {
    const filterSets = [...SRC.matchAll(/\.match\(\{([\s\S]*?)\}\)/g)].map(
      (m) => m[1]
    );
    expect(filterSets.length).toBeGreaterThan(0);
    for (const set of filterSets) expect(set).toMatch(/workspace_id/);
  });
});
