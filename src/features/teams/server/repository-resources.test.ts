/**
 * THE POLYMORPHIC-RESOURCE WRITE PATH.
 *
 * `team_resource_access.resource_id` points at one of FIVE tables depending on
 * `resource_type`, and the repository is the only thing that knows which. It
 * used to decide with an inline `knowledge_base ? knowledge_bases : workflows`
 * ternary, so `skill` writes went to the `workflows` table — and a Supabase
 * `.update()` matching zero rows returns `{ error: null }`, so nothing threw,
 * the route 200'd, and the skill's scope silently never changed.
 *
 * That failure mode is INVISIBLE to every test that mocks at a higher layer: it
 * has no error, no exception, and no wrong return value. The only way to catch
 * it is to assert on the TABLE NAME the query builder was handed, which is what
 * these do. (There were no tests at all under `teams/server/` before this.)
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

/**
 * Chainable Supabase-builder stub. Records the table, the projection, the
 * update payload and every filter; resolves `maybeSingle()` to `row`.
 *
 * `update()` resolves as a thenable with `{ error: null }` — the real client's
 * "matched nothing, nobody complained" behavior, which is precisely the
 * behavior that let the bug hide.
 */
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
    ["workflow", "workflows"],
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

  it("still writes legacy workflow rows (retired from the UI, live in the DB)", async () => {
    // D7 retired workflows from the members console; existing grant rows and
    // access modes stay valid, so this branch must keep working.
    const { builder, calls } = makeDb();
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    await setResourceAccessModeRow(WS, "workflow", RESOURCE, "workspace");

    expect(calls.from).toEqual(["workflows"]);
    expect(calls.update[0]).toMatchObject({ access_mode: "workspace" });
  });

  it.each(["chat", "chat_folder"] as const)(
    "refuses %s rather than writing the column directly",
    async (resourceType) => {
      // A folder's scope is authoritative for its chats and is propagated to
      // them; setting the column here would desync the two with no error.
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

  it("reads a workflow's creator from user_id, not created_by", async () => {
    // Workflows are the odd one out — the column is `user_id`.
    const { builder, calls } = makeDb({
      name: "Nightly sync",
      access_mode: "teams",
      user_id: "user-4",
    });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);

    const meta = await getResourceAccessMeta(WS, "workflow", RESOURCE);

    expect(calls.from).toEqual(["workflows"]);
    expect(calls.select[0]).toContain("user_id");
    expect(meta?.createdBy).toBe("user-4");
  });

  it("reads a chat's name from `title` and its creator from `owner_id`", async () => {
    // Not reachable from the console today, but the union member exists and
    // the columns are named differently on every table.
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
