/**
 * `repository-channel-grants.ts` — the raw I/O for `channel_resource_grants`.
 *
 * The property every one of these pins shares: THE SERVICE-ROLE CLIENT BYPASSES
 * RLS, so `workspace_id` must appear as an explicit filter on every statement,
 * read or write. A missing one is not a slow query, it is a cross-tenant one.
 *
 * `listChannelKnowledgeGrants` additionally pins the bounded fan behind
 * `channelGrants`: ONE query with `resource_id IN (baseIds)`, and an empty base
 * list short-circuits with NO query (the id set is the fence, and an empty `in`
 * would be a PostgREST syntax error anyway).
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteChannelKnowledgeGrant,
  findChannelKnowledgeGrant,
  listChannelGrantsAtLevel,
  listChannelGrantsForBase,
  listChannelKnowledgeGrants,
  upsertChannelKnowledgeGrant,
} from "./repository-channel-grants";

/**
 * A fake PostgREST builder recording the filter chain. `.in()`, `.limit()`,
 * `.single()` and `.delete()`-then-last-`.eq()` are the terminals, so the
 * builder is thenable: any await resolves the configured result.
 */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls = {
    from: [] as string[],
    select: [] as string[],
    eq: [] as Array<[string, unknown]>,
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
    eq(col: string, val: unknown) {
      calls.eq.push([col, val]);
      return builder;
    },
    in(col: string, vals: unknown) {
      calls.in.push([col, vals]);
      return Promise.resolve(result);
    },
    limit(n: number) {
      calls.limit.push(n);
      return Promise.resolve(result);
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
    // Thenable tail for the delete chain, which has no explicit terminal.
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

describe("listChannelKnowledgeGrants", () => {
  it("issues ONE workspace+channel+type+in(baseIds) query and returns the rows", async () => {
    const rows = [
      {
        channel_id: "chan-1",
        resource_type: "knowledge_base",
        resource_id: "kb-1",
        workspace_id: "ws-1",
        level: "visible",
        guest_write: false,
        created_by: null,
        created_at: "2026-08-27T00:00:00Z",
        updated_at: "2026-08-27T00:00:00Z",
      },
    ];
    const { client, calls } = fakeClient({ data: rows, error: null });

    const out = await listChannelKnowledgeGrants(client, "ws-1", "chan-1", [
      "kb-1",
      "kb-2",
    ]);

    expect(out).toEqual(rows);
    expect(calls.from).toEqual(["channel_resource_grants"]);
    expect(calls.eq).toEqual([
      ["workspace_id", "ws-1"],
      ["channel_id", "chan-1"],
      ["resource_type", "knowledge_base"],
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

describe("listChannelGrantsAtLevel — the GUEST LANE's list read", () => {
  /**
   * ⚠ THE `level` FILTER IS THE ASSERTION, and it needs a REPOSITORY test to
   * exist at all. `grant-lane.test.ts` mocks this module, so a service-level pin
   * cannot see the predicate — deleting `.eq("level", level)` left that whole
   * suite GREEN (measured 2026-08-26), which would have put every `agent_only`
   * grant in the container into a guest's base list.
   */
  it("filters by workspace + channel + type + LEVEL, and carries the ceiling", async () => {
    const { client, calls } = fakeClient({ data: [ROW], error: null });

    const out = await listChannelGrantsAtLevel(
      client,
      "ws-1",
      "chan-1",
      "visible",
      200
    );

    expect(out).toEqual([ROW]);
    expect(calls.from).toEqual(["channel_resource_grants"]);
    expect(calls.eq).toEqual([
      ["workspace_id", "ws-1"],
      ["channel_id", "chan-1"],
      ["resource_type", "knowledge_base"],
      // 🔒 Without this term the lane lists `agent_only` grants — a DIFFERENT
      // audience, whose existence must not leak to the people in the channel.
      ["level", "visible"],
    ]);
    // PostgREST truncates an un-limited select silently.
    expect(calls.limit).toEqual([200]);
  });

  it("passes `agent_only` through unchanged when that is what is asked for", async () => {
    // The parameter is a parameter, not a decoration around a hardcoded value.
    const { client, calls } = fakeClient({ data: [], error: null });
    await listChannelGrantsAtLevel(client, "ws-1", "chan-1", "agent_only", 5);
    expect(calls.eq).toContainEqual(["level", "agent_only"]);
    expect(calls.limit).toEqual([5]);
  });

  it("throws when the query errors", async () => {
    const { client } = fakeClient({ data: null, error: new Error("db down") });
    await expect(
      listChannelGrantsAtLevel(client, "ws-1", "chan-1", "visible", 200)
    ).rejects.toThrow("db down");
  });
});

describe("findChannelKnowledgeGrant — the lane's per-base PK lookup", () => {
  it("filters by workspace + channel + type + resource and answers the row", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null });

    expect(
      await findChannelKnowledgeGrant(client, "ws-1", "chan-1", "kb-1")
    ).toEqual(ROW);
    expect(calls.eq).toEqual([
      ["workspace_id", "ws-1"],
      ["channel_id", "chan-1"],
      ["resource_type", "knowledge_base"],
      ["resource_id", "kb-1"],
    ]);
  });

  it("answers NULL for a missing row rather than throwing", async () => {
    // `maybeSingle`, not `single`: "not shared" is the third state and the
    // COMMON one, so it must not arrive as an error the service has to decode.
    const { client } = fakeClient({ data: null, error: null });
    expect(
      await findChannelKnowledgeGrant(client, "ws-1", "chan-1", "kb-9")
    ).toBeNull();
  });

  it("returns the row AT WHATEVER LEVEL IT CARRIES — the service decides", () => {
    // ⚠ No `level` filter here on purpose, and it is not an oversight: the
    // service must be able to tell `agent_only` from absent in order to give
    // them the SAME answer deliberately. A filter here would make that decision
    // in SQL, where the reasoning cannot be written down.
    const src = readFileSync(
      resolve(__dirname, "repository-channel-grants.ts"),
      "utf8"
    );
    const fn = src.slice(src.indexOf("export async function findChannelKnowledgeGrant"));
    expect(fn.slice(0, fn.indexOf("}"))).not.toMatch(/\.eq\("level"/);
  });

  it("throws when the query errors", async () => {
    const { client } = fakeClient({ data: null, error: new Error("db down") });
    await expect(
      findChannelKnowledgeGrant(client, "ws-1", "chan-1", "kb-1")
    ).rejects.toThrow("db down");
  });
});

describe("listChannelGrantsForBase — the inverse read", () => {
  it("filters by workspace + type + THIS base and carries the ceiling", async () => {
    const { client, calls } = fakeClient({ data: [ROW], error: null });

    expect(await listChannelGrantsForBase(client, "ws-1", "kb-1", 200)).toEqual([
      ROW,
    ]);
    expect(calls.eq).toEqual([
      ["workspace_id", "ws-1"],
      ["resource_type", "knowledge_base"],
      ["resource_id", "kb-1"],
    ]);
    // ⚠ An un-limited select is truncated SILENTLY by PostgREST.
    expect(calls.limit).toEqual([200]);
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
          channel_id: "chan-1",
          resource_type: "knowledge_base",
          resource_id: "kb-1",
          workspace_id: "ws-1",
          level: "visible",
          guest_write: true,
          created_by: "user-1",
        },
        // "One grant per (kb, channel)" IS the PK; this names it.
        { onConflict: "channel_id,resource_type,resource_id" },
      ],
    ]);
  });

  it("propagates the trigger's error untranslated — the SERVICE owns that", async () => {
    const raise = {
      code: "P0001",
      message: "channel_resource_grants: channel workspace mismatch",
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
    expect(calls.eq).toEqual([
      ["workspace_id", "ws-1"],
      ["channel_id", "chan-1"],
      ["resource_type", "knowledge_base"],
      ["resource_id", "kb-1"],
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
