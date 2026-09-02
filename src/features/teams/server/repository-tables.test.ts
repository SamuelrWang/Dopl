/**
 * Table + filter smoke for the grant/membership queries.
 * ⚠ A query on the wrong table or a dropped filter shows up as no error at
 * all: PostgREST answers a wrong-table read with rows and a `.delete()` that
 * matched nothing returns `{ error: null }`. So these assert on the TABLE NAME
 * and on the `workspace_id` filter every workspace-wide query requires.
 * The last describe pins the re-export surface — `repository.ts` is still the
 * address other features (and the chats tests' `vi.mock`) import.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import * as barrel from "./repository";
import {
  deleteGrantRow,
  deleteGrantsForResource,
  insertReadGrantsIfMissing,
  listGrantsForResource,
  listGrantsForTeam,
  listGrantsForTeams,
  upsertGrant,
} from "./repository-grants";
import {
  insertTeamMembers,
  listTeamIdsForUser,
  listTeamMembersForWorkspace,
  listTeamRefsByUser,
  replaceInvitationTeams,
} from "./repository-members";

const WS = "ws-1";
const TEAM = "team-1";
const RESOURCE = "res-1";

interface Recorded {
  from: string[];
  select: string[];
  upsert: Array<{ rows: unknown; opts: unknown }>;
  insert: unknown[];
  eq: Array<[string, unknown]>;
  match: Array<Record<string, unknown>>;
  in: Array<[string, unknown]>;
  deletes: number;
}

/** Chainable Supabase-builder stub; terminal awaits resolve to `data`. */
function makeDb(data: unknown = []) {
  const calls: Recorded = {
    from: [],
    select: [],
    upsert: [],
    insert: [],
    eq: [],
    match: [],
    in: [],
    deletes: 0,
  };
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
    upsert: (rows: unknown, opts: unknown) => {
      calls.upsert.push({ rows, opts });
      return builder;
    },
    insert: (rows: unknown) => {
      calls.insert.push(rows);
      return builder;
    },
    delete: () => {
      calls.deletes += 1;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return builder;
    },
    match: (filters: Record<string, unknown>) => {
      calls.match.push(filters);
      return builder;
    },
    in: (col: string, val: unknown) => {
      calls.in.push([col, val]);
      return builder;
    },
    order: () => builder,
    then: (resolve: (v: unknown) => unknown) => resolve({ data, error: null }),
  });
  return { builder, calls };
}

function install(data: unknown = []) {
  const { builder, calls } = makeDb(data);
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

beforeEach(() => vi.clearAllMocks());

describe("grants — every query is the TEAM slice of resource_grants", () => {
  /**
   * 🔒 `scope_type` IS THE SECOND FENCE, AND IT IS NEW. `20260914120000` folded
   * three grant tables into one, so `team_resource_access`'s name no longer
   * narrows anything: a statement that drops the scope term reads a channel's
   * grants as a team's, and a DELETE that drops it un-shares the knowledge lane.
   * Every case below asserts it, and the sweep at the end asserts the ones no
   * case drives.
   */
  const TEAM_SLICE = { scope_type: "team" };

  it("listGrantsForTeams filters by workspace + scope and narrows by team ids", async () => {
    const calls = install([]);
    await listGrantsForTeams(WS, [TEAM]);
    expect(calls.from).toEqual(["resource_grants"]);
    expect(calls.match).toEqual([{ workspace_id: WS, ...TEAM_SLICE }]);
    expect(calls.in).toContainEqual(["scope_id", [TEAM]]);
  });

  it("listGrantsForTeams short-circuits an empty team list without a query", async () => {
    const calls = install([]);
    expect(await listGrantsForTeams(WS, [])).toEqual([]);
    expect(calls.from).toEqual([]);
  });

  it("listGrantsForTeam pins the ONE team without a workspace filter", async () => {
    // The team id IS the tenancy here — a team belongs to exactly one
    // workspace — which is why this is the one read with no `workspace_id`.
    const calls = install([]);
    await listGrantsForTeam(TEAM);
    expect(calls.match).toEqual([{ scope_id: TEAM, ...TEAM_SLICE }]);
  });

  it("listGrantsForResource pins workspace + scope + type + id", async () => {
    const calls = install([]);
    await listGrantsForResource(WS, "knowledge_base", RESOURCE);
    expect(calls.from).toEqual(["resource_grants"]);
    expect(calls.match).toEqual([
      {
        workspace_id: WS,
        resource_type: "knowledge_base",
        resource_id: RESOURCE,
        ...TEAM_SLICE,
      },
    ]);
  });

  it("projects `scope_id` back as `team_id` so the DTO mapper is untouched", async () => {
    const calls = install([]);
    await listGrantsForTeam(TEAM);
    expect(calls.select).toEqual(["team_id:scope_id, resource_type, resource_id, level"]);
  });

  it("upsertGrant writes the level on the composite conflict target", async () => {
    const calls = install();
    await upsertGrant(WS, TEAM, "skill", RESOURCE, "edit");
    expect(calls.from).toEqual(["resource_grants"]);
    expect(calls.upsert[0].rows).toMatchObject({
      scope_type: "team",
      scope_id: TEAM,
      resource_type: "skill",
      resource_id: RESOURCE,
      workspace_id: WS,
      level: "edit",
    });
    expect(calls.upsert[0].opts).toMatchObject({
      onConflict: "scope_type,scope_id,resource_type,resource_id",
    });
  });

  it("insertReadGrantsIfMissing never downgrades (ignoreDuplicates, level read)", async () => {
    const calls = install();
    await insertReadGrantsIfMissing(WS, "knowledge_base", RESOURCE, [TEAM, "team-2"]);
    expect(calls.upsert[0].rows).toHaveLength(2);
    expect(calls.upsert[0].rows).toContainEqual({
      scope_type: "team",
      scope_id: TEAM,
      resource_type: "knowledge_base",
      resource_id: RESOURCE,
      workspace_id: WS,
      level: "read",
    });
    expect(calls.upsert[0].opts).toMatchObject({ ignoreDuplicates: true });
  });

  it("deleteGrantsForResource deletes workspace-scoped, deleteGrantRow team-scoped", async () => {
    const wide = install();
    await deleteGrantsForResource(WS, "skill", RESOURCE);
    expect(wide.deletes).toBe(1);
    expect(wide.match).toEqual([
      {
        workspace_id: WS,
        resource_type: "skill",
        resource_id: RESOURCE,
        ...TEAM_SLICE,
      },
    ]);

    const narrow = install();
    await deleteGrantRow(TEAM, "skill", RESOURCE);
    expect(narrow.from).toEqual(["resource_grants"]);
    expect(narrow.match).toEqual([
      { scope_id: TEAM, resource_type: "skill", resource_id: RESOURCE, ...TEAM_SLICE },
    ]);
  });

  it("🔒 EVERY statement in the module names the table and spreads the scope", () => {
    // The enumerated cases above drive seven functions; the module exports
    // eleven. A twelfth added without the scope term would pass all of them by
    // simply not being in one.
    const src = readFileSync(
      resolve(__dirname, "repository-grants.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/from\(\s*["'`]team_resource_access/);
    const tables = [...src.matchAll(/\.from\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(tables.length).toBeGreaterThan(0);
    expect([...new Set(tables)]).toEqual(["GRANTS_TABLE"]);

    const filterSets = src.match(/\.match\(\{/g)?.length ?? 0;
    const spreads = src.match(/\.\.\.TEAM_SCOPE/g)?.length ?? 0;
    // Every `.match(` carries the spread; `grantRow()` carries it for all three
    // write paths, so the write side spends exactly one more.
    expect(filterSets).toBeGreaterThan(0);
    expect(spreads).toBe(filterSets + 1);
  });
});

describe("membership — team_members and the invitation join table", () => {
  it("listTeamMembersForWorkspace reads team_members filtered by workspace", async () => {
    const calls = install([
      { team_id: TEAM, user_id: "u1", added_by: "u9", added_at: "2026-01-01" },
    ]);
    const rows = await listTeamMembersForWorkspace(WS);
    expect(calls.from).toEqual(["team_members"]);
    expect(calls.eq).toEqual([["workspace_id", WS]]);
    expect(rows[0]).toMatchObject({ teamId: TEAM, userId: "u1" });
  });

  it("listTeamIdsForUser returns bare ids for the workspace + user pair", async () => {
    const calls = install([{ team_id: TEAM }, { team_id: "team-2" }]);
    expect(await listTeamIdsForUser(WS, "u1")).toEqual([TEAM, "team-2"]);
    expect(calls.from).toEqual(["team_members"]);
    expect(calls.eq).toEqual([
      ["workspace_id", WS],
      ["user_id", "u1"],
    ]);
  });

  it("insertTeamMembers upserts one row per user and skips an empty list", async () => {
    const calls = install();
    await insertTeamMembers(TEAM, WS, ["u1", "u2"], "u9");
    expect(calls.from).toEqual(["team_members"]);
    expect(calls.upsert[0].rows).toHaveLength(2);
    expect(calls.upsert[0].opts).toMatchObject({ onConflict: "team_id,user_id" });

    const empty = install();
    await insertTeamMembers(TEAM, WS, [], "u9");
    expect(empty.from).toEqual([]);
  });

  it("listTeamRefsByUser groups the joined team chips by user", async () => {
    install([
      { user_id: "u1", team: { id: TEAM, name: "Ops", color: "#111", icon: null } },
      { user_id: "u1", team: [{ id: "team-2", name: "Eng", color: null, icon: "x" }] },
    ]);
    const map = await listTeamRefsByUser(WS);
    expect(map.get("u1")).toEqual([
      { teamId: TEAM, name: "Ops", color: "#111", icon: null },
      { teamId: "team-2", name: "Eng", color: null, icon: "x" },
    ]);
  });

  it("replaceInvitationTeams deletes then inserts on workspace_invitation_teams", async () => {
    const calls = install();
    await replaceInvitationTeams("inv-1", [TEAM]);
    expect(calls.from).toEqual([
      "workspace_invitation_teams",
      "workspace_invitation_teams",
    ]);
    expect(calls.deletes).toBe(1);
    expect(calls.insert[0]).toEqual([{ invitation_id: "inv-1", team_id: TEAM }]);
  });

  it("replaceInvitationTeams with no teams deletes and stops", async () => {
    const calls = install();
    await replaceInvitationTeams("inv-1", []);
    expect(calls.deletes).toBe(1);
    expect(calls.insert).toEqual([]);
  });
});

describe("repository.ts re-export surface", () => {
  it("still exports every moved function under its original name", () => {
    for (const name of [
      // grants
      "listGrantsForTeam",
      "listGrantsForTeams",
      "listGrantsForResource",
      "listGrantsForResources",
      "upsertGrant",
      "insertReadGrantsIfMissing",
      "insertReadGrantsForResources",
      "deleteGrantsForResource",
      "deleteGrantsForResources",
      "deleteGrantRow",
      // membership
      "listTeamMembers",
      "listTeamMembersForWorkspace",
      "insertTeamMembers",
      "deleteTeamMemberRow",
      "listTeamIdsForUser",
      "listTeamRefsByUser",
      "listInvitationTeamIds",
      "replaceInvitationTeams",
      // resources
      "listTeamsModeResources",
      "getResourceAccessMeta",
      "setResourceAccessModeRow",
      // teams, which stayed
      "insertTeam",
      "updateTeamRow",
      "deleteTeamRow",
      "findTeamById",
      "listTeamsForWorkspace",
    ]) {
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("re-exports the identical binding, not a copy", () => {
    expect(barrel.upsertGrant).toBe(upsertGrant);
    expect(barrel.listTeamRefsByUser).toBe(listTeamRefsByUser);
  });
});
