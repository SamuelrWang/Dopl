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
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteChannelKnowledgeGrant,
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
