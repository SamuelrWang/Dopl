/**
 * `listChannelKnowledgeGrants` — the bounded fan behind `channelGrants`. Pins:
 * ONE query, filtered by workspace_id AND channel_id AND
 * resource_type='knowledge_base' AND resource_id IN (baseIds); an empty base
 * list short-circuits with NO query (the id set is the fence, and an empty `in`
 * would be a PostgREST syntax error anyway); a repo error propagates.
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listChannelKnowledgeGrants } from "./repository-channel-grants";

/** A fake PostgREST builder recording the filter chain; `.in()` is terminal. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls = {
    from: [] as string[],
    select: [] as string[],
    eq: [] as Array<[string, unknown]>,
    in: [] as Array<[string, unknown]>,
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
  };
  const from = vi.fn((t: string) => {
    calls.from.push(t);
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

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
