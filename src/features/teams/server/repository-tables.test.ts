/**
 * TABLE + FILTER SMOKE FOR THE QUERIES THAT MOVED (2026-08-08 split).
 *
 * `repository.ts` was 625 and became four files. Nothing was rewritten, but a
 * move can still land a query on the wrong table or drop a filter, and neither
 * shows up as an error: PostgREST answers a wrong-table read with rows, and a
 * `.delete()` that matched nothing returns `{ error: null }` — the same silent
 * failure mode `repository-resources.test.ts` exists for. So these assert on
 * the TABLE NAME and on the `workspace_id` filter that §8 requires of every
 * workspace-wide query, for the grant and membership functions that moved.
 *
 * The last describe pins the re-export surface: `repository.ts` is still the
 * address other features (and the chats tests' `vi.mock`) import, so a concern
 * module dropping out of the barrel must fail here, not in another feature.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import * as barrel from "./repository";
import {
  deleteGrantRow,
  deleteGrantsForResource,
  insertReadGrantsIfMissing,
  listGrantsForResource,
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
  in: Array<[string, unknown]>;
  deletes: number;
}

/** Chainable Supabase-builder stub; every terminal await resolves to `data`. */
function makeDb(data: unknown = []) {
  const calls: Recorded = {
    from: [],
    select: [],
    upsert: [],
    insert: [],
    eq: [],
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

describe("grants — every query is on team_resource_access", () => {
  it("listGrantsForTeams filters by workspace and narrows by team ids", async () => {
    const calls = install([]);
    await listGrantsForTeams(WS, [TEAM]);
    expect(calls.from).toEqual(["team_resource_access"]);
    expect(calls.eq).toContainEqual(["workspace_id", WS]);
    expect(calls.in).toContainEqual(["team_id", [TEAM]]);
  });

  it("listGrantsForTeams short-circuits an empty team list without a query", async () => {
    const calls = install([]);
    expect(await listGrantsForTeams(WS, [])).toEqual([]);
    expect(calls.from).toEqual([]);
  });

  it("listGrantsForResource pins workspace + type + id", async () => {
    const calls = install([]);
    await listGrantsForResource(WS, "knowledge_base", RESOURCE);
    expect(calls.from).toEqual(["team_resource_access"]);
    expect(calls.eq).toEqual([
      ["workspace_id", WS],
      ["resource_type", "knowledge_base"],
      ["resource_id", RESOURCE],
    ]);
  });

  it("upsertGrant writes the level on the composite conflict target", async () => {
    const calls = install();
    await upsertGrant(WS, TEAM, "skill", RESOURCE, "edit");
    expect(calls.from).toEqual(["team_resource_access"]);
    expect(calls.upsert[0].rows).toMatchObject({
      team_id: TEAM,
      resource_type: "skill",
      resource_id: RESOURCE,
      workspace_id: WS,
      level: "edit",
    });
    expect(calls.upsert[0].opts).toMatchObject({
      onConflict: "team_id,resource_type,resource_id",
    });
  });

  it("insertReadGrantsIfMissing never downgrades (ignoreDuplicates, level read)", async () => {
    const calls = install();
    await insertReadGrantsIfMissing(WS, "knowledge_base", RESOURCE, [TEAM, "team-2"]);
    expect(calls.upsert[0].rows).toHaveLength(2);
    expect(calls.upsert[0].rows).toContainEqual({
      team_id: TEAM,
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
    expect(wide.eq).toContainEqual(["workspace_id", WS]);

    const narrow = install();
    await deleteGrantRow(TEAM, "skill", RESOURCE);
    expect(narrow.from).toEqual(["team_resource_access"]);
    expect(narrow.eq).toContainEqual(["team_id", TEAM]);
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
