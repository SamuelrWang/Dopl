/**
 * The polymorphic-resource write path: `team_resource_access.resource_id`
 * points at one of FOUR tables depending on `resource_type`, and the
 * repository is the only thing that knows which.
 * ⚠ A mis-dispatched write is INVISIBLE at any higher layer — a Supabase
 * `.update()` matching zero rows returns `{ error: null }`, so nothing throws,
 * the route 200s and the scope silently never changes. These assert on the
 * TABLE NAME the query builder was handed; that is the only way to catch it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  getResourceAccessMeta,
  setResourceAccessModeRow,
} from "./repository-resources";

const WS = "ws-1";
const RESOURCE = "res-1";

interface Recorded {
  from: string[];
  select: string[];
  update: Array<Record<string, unknown>>;
  eq: Array<[string, unknown]>;
}

/** Chainable Supabase-builder stub: records table, projection, update payload
 *  and filters; `maybeSingle()` resolves to `row`. ⚠ `update()` resolves
 *  `{ error: null }` like the real client's "matched nothing" behavior. */
function makeDb(row: unknown = null) {
  const calls: Recorded = { from: [], select: [], update: [], eq: [] };
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    from: (t: string) => {
      calls.from.push(t);
      return builder;
    },
    select: (cols: string) => {
      calls.select.push(cols);
      return builder;
    },
    update: (patch: Record<string, unknown>) => {
      calls.update.push(patch);
      return builder;
    },
    eq: (col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return builder;
    },
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
    // The update chain is awaited directly, not via a terminal method.
    then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
  });
  return { builder, calls };
}

beforeEach(() => vi.clearAllMocks());

describe("setResourceAccessModeRow — table routing", () => {
  it.each([
    ["knowledge_base", "knowledge_bases"],
    ["skill", "skills"],
  ] as const)("writes a %s to the %s table", async (resourceType, table) => {
    const { builder, calls } = makeDb();
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    await setResourceAccessModeRow(WS, resourceType, RESOURCE, "teams");

    expect(calls.from).toEqual([table]);
    expect(calls.update[0]).toMatchObject({ access_mode: "teams" });
    // Workspace-scoped and pinned to the one row, always.
    expect(calls.eq).toContainEqual(["workspace_id", WS]);
    expect(calls.eq).toContainEqual(["id", RESOURCE]);
  });

  it("does NOT send a skill to the workflows table (the regression)", async () => {
    const { builder, calls } = makeDb();
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    await setResourceAccessModeRow(WS, "skill", RESOURCE, "workspace");

    expect(calls.from).not.toContain("workflows");
  });

  it.each(["chat", "chat_folder"] as const)(
    "refuses %s rather than writing the column directly",
    async (resourceType) => {
      // ⚠ Folder scope is authoritative for its chats and propagates to them;
      // setting the column here desyncs the two with no error.
      const { builder, calls } = makeDb();
      vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

      await expect(
        setResourceAccessModeRow(WS, resourceType, RESOURCE, "teams")
      ).rejects.toThrow(/chats service/);
      expect(calls.from).toEqual([]);
    }
  );
});

describe("getResourceAccessMeta — table + column routing", () => {
  it("reads a knowledge base by name + created_by", async () => {
    const { builder, calls } = makeDb({
      name: "Reports",
      access_mode: "teams",
      created_by: "user-9",
    });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    const meta = await getResourceAccessMeta(WS, "knowledge_base", RESOURCE);

    expect(calls.from).toEqual(["knowledge_bases"]);
    expect(meta).toEqual({
      name: "Reports",
      accessMode: "teams",
      createdBy: "user-9",
    });
  });

  it("reads a skill from the skills table", async () => {
    const { builder, calls } = makeDb({
      name: "Triage",
      access_mode: "workspace",
      created_by: "user-3",
    });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    const meta = await getResourceAccessMeta(WS, "skill", RESOURCE);

    expect(calls.from).toEqual(["skills"]);
    expect(meta?.name).toBe("Triage");
    expect(meta?.createdBy).toBe("user-3");
  });

  it("reads a chat folder's creator from user_id, not created_by", async () => {
    // Chat folders are the odd one out: creator column is `user_id`.
    const { builder, calls } = makeDb({
      name: "Kickoffs",
      access_mode: "teams",
      user_id: "user-4",
    });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    const meta = await getResourceAccessMeta(WS, "chat_folder", RESOURCE);

    expect(calls.from).toEqual(["chat_folders"]);
    expect(calls.select[0]).toContain("user_id");
    expect(meta?.createdBy).toBe("user-4");
  });

  it("reads a chat's name from `title` and its creator from `owner_id`", async () => {
    // Not reachable from the console, but the union member exists and every
    // table names its columns differently.
    const { builder, calls } = makeDb({
      title: "Kickoff",
      access_mode: "teams",
      owner_id: "user-7",
    });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    const meta = await getResourceAccessMeta(WS, "chat", RESOURCE);

    expect(calls.from).toEqual(["chats"]);
    expect(meta).toEqual({
      name: "Kickoff",
      accessMode: "teams",
      createdBy: "user-7",
    });
  });

  it("returns null when the row is missing", async () => {
    const { builder } = makeDb(null);
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    expect(await getResourceAccessMeta(WS, "skill", RESOURCE)).toBeNull();
  });
});
