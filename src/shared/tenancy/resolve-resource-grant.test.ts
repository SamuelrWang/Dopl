/**
 * 🔒 **CLAUSE 4's THIRD ARM — A GRANT NAMES A ROW ACROSS CONTAINERS** (F-662).
 *
 * ⚠ Its own file because it is its own FENCE: the other three clauses are one
 * query and this one is a second, run only on a miss, and the cases that matter
 * are the ones where the first query must have found nothing.
 * ⚠ The builder applies no filters, so every case here SEQUENCES the resource
 * table's result sets — `[[], [row]]` is "nameable by no clause, reached by a
 * grant". A single result set would answer both queries and pass on the first.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { resolveResource, resolveResourcesByName } from "./resolve-resource";
import {
  caller,
  filters,
  makeAdmin,
  member,
  ME,
  templateRow,
  T1,
  WS_A,
  WS_B,
} from "./resolve-resource-fixture";

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * 🔒 **A ROW LENT TO A SCOPE THE CALLER IS IN IS NAMEABLE BY THEM** (F-662).
 *
 * ⚠ **THE TS SIDE WAS THE NARROW HALF.** `dopl_grant_admits()` has been an arm
 * of `dopl_knowledge_base_readable()` since `20260923140000`, and `canSeeBase`
 * gained the same arm — so the policy admitted a lent row and the NAMING lane
 * refused it, which made the grant a recorded intent for every cross-container
 * lend. `resource-grant-reach.ts` recorded the gap in its own header.
 */
describe("🔒 a GRANT names a row in a container the caller is not in", () => {
  const CH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  function grantedTo(channelId: string, level = "visible") {
    return {
      resource_grants: [
        {
          scope_type: "channel",
          scope_id: channelId,
          resource_id: T1,
          level,
        },
      ],
      channel_members: [{ channel_id: channelId }],
    };
  }

  it("resolves a base lent into a channel the caller is a member of", async () => {
    // ⚠ MUTATION CHECK. Drop the grant lane and this is `null` — a base the
    // operator deliberately shared into the room, unreadable in the room.
    const calls = makeAdmin(
      { workspace_members: [member(WS_A)], ...grantedTo(CH) },
      {
        // 🔒 The fenced query finds NOTHING — the caller is not a member of
        // `WS_B` and the row is private and somebody else's, so it fails the
        // `.in()` and both arms of the `.or()`. Only the grant lane can answer.
        knowledge_bases: [
          [],
          [
            {
              id: T1,
              name: "Runbooks",
              workspace_id: WS_B,
              created_by: "someone-else",
              workspace: { name: "Acme", kind: "standard" },
            },
          ],
        ],
      }
    );
    expect(await resolveResource(caller, "knowledge_base", T1)).toMatchObject({
      containerId: WS_B,
      // 🔒 A grantee holds no membership, so the floor is the answer — never a
      // borrowed role from the container they came from.
      containerRole: "viewer",
      ownedByCaller: false,
    });
    // ⚠ The second query carries NO container filter and NO `.or()`: a grantee
    // fails both by construction, so an arm inside that group is unreachable.
    const applied = filters(calls, "knowledge_bases");
    expect(applied.slice(-2)).toEqual([
      `eq("id"="${T1}")`,
      `is("deleted_at"=null)`,
    ]);
    // ⚠ MUTATION CHECK. ONE `in` and ONE `or` across BOTH queries — i.e. the
    // second carries neither. Add them and the grant lane is unreachable, which
    // is the mistake `20260923140000` §3b had to undo on the child policies.
    expect(applied.filter((f) => f.startsWith("in(")).length).toBe(1);
    expect(applied.filter((f) => f.startsWith("or(")).length).toBe(1);
  });

  it("answers NULL when nothing grants the id to this caller", async () => {
    makeAdmin({
      workspace_members: [member(WS_A)],
      knowledge_bases: [],
      resource_grants: [],
    });
    expect(await resolveResource(caller, "knowledge_base", T1)).toBeNull();
  });

  it("🔒 an `agent_only` CHANNEL grant does not name it for a PERSON", async () => {
    // Two AUDIENCES, not a high/low pair: `agent_only` says "my agent may read
    // this here", and a person reading it is strictly more.
    makeAdmin({
      workspace_members: [member(WS_A)],
      knowledge_bases: [],
      ...grantedTo(CH, "agent_only"),
    });
    expect(await resolveResource(caller, "knowledge_base", T1)).toBeNull();
  });

  it("🔒 a grant to a channel the caller is NOT in names nothing", async () => {
    makeAdmin({
      workspace_members: [member(WS_A)],
      knowledge_bases: [],
      resource_grants: grantedTo(CH).resource_grants,
      channel_members: [],
    });
    expect(await resolveResource(caller, "knowledge_base", T1)).toBeNull();
  });

  it("🔒 a NAME never takes the grant lane", async () => {
    // A name is not a global handle — resolving one here would scan every
    // container in the product for a label.
    const calls = makeAdmin({
      workspace_members: [member(WS_A)],
      knowledge_bases: [],
      ...grantedTo(CH),
    });
    expect(
      await resolveResourcesByName(caller, "knowledge_base", "Runbooks")
    ).toEqual([]);
    expect(calls.some((c) => c.table === "resource_grants")).toBe(false);
  });

  it("costs no grant query when the row was nameable anyway", async () => {
    const calls = makeAdmin({
      workspace_members: [member(WS_B)],
      agent_templates: [templateRow()],
    });
    expect(await resolveResource(caller, "agent_template", T1)).not.toBeNull();
    expect(calls.some((c) => c.table === "resource_grants")).toBe(false);
  });

  it("🔒 a SHARED credential is not widened by a grant either", async () => {
    // Arm 2 travels with the grant, exactly as the SQL twin states it:
    // `NOT dopl_credential_is_shared() AND dopl_grant_admits(…)`.
    const calls = makeAdmin(grantedTo(CH));
    expect(
      await resolveResource(
        { userId: ME, credentialSubjectUserId: null },
        "knowledge_base",
        T1
      )
    ).toBeNull();
    expect(calls).toEqual([]);
  });
});
