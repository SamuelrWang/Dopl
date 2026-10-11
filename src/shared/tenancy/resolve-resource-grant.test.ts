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
  identityRow,
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

  /** ⚠ `channels` + `workspaces` ride along since 2026-09-17: a channel grant is
   *  honoured only in a NON-standard container (`channel-scope.ts`), and the
   *  helper fails CLOSED on a channel it cannot resolve. `kind` is the knob — a
   *  `standard` one here is the ruling's refusal. */
  function grantedTo(channelId: string, level = "visible", kind = "link") {
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
      channels: [{ id: channelId, workspace_id: WS_B }],
      workspaces: [{ id: WS_B, kind }],
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

  it("🔒 a grant to a channel in a STANDARD workspace names nothing (2026-09-17)", async () => {
    // Samuel: *"In workspaces, resource access is not scoped by channels. It's
    // instead scoped by teams."* ⚠ The row is STILL THERE — what is under test
    // is that the naming lane drops it, not that nothing wrote it.
    makeAdmin({
      workspace_members: [member(WS_A)],
      knowledge_bases: [],
      ...grantedTo(CH, "visible", "standard"),
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
      agent_identities: [identityRow()],
    });
    expect(await resolveResource(caller, "agent_identity", T1)).not.toBeNull();
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

/**
 * 🔒 CLAUSE 3 HOLDS ON THE GRANT ARM TOO (#3610, 2026-10-11; KB codebase-cleanup sectors/W03 §Flags,
 * HIGH, Samuel-approved fix). A LOCKED credential resolves "inside its lock plus its operator's home
 * space, never wider" — so a grant counts only when its SCOPE is inside the lock: a container scope must
 * be a lock container, a channel scope must sit in one. The resource itself may live anywhere (that is
 * what a grant is for). Unlocked credentials are unchanged.
 * ⚠ The mock applies no filters, so each scene SEQUENCES its result sets: `workspaces` answers the
 * home-space lookup first (empty: no home space, so the lock is exactly [A]) and the channel-kind
 * lookup last; `workspace_members` answers the lock-narrowed candidate read first.
 */
describe("🔒 a LOCKED credential reaches a grant only through a scope inside its lock", () => {
  const WS_C = "cccccccc-0000-4000-8000-00000000000c";
  const CH_A = "aaaaaaaa-cccc-4ccc-8ccc-cccccccccccc";
  const CH_B = "bbbbbbbb-cccc-4ccc-8ccc-cccccccccccc";
  const locked = { userId: ME, credentialSubjectUserId: ME, apiKeyWorkspaceId: WS_A };
  const rowInC = {
    id: T1,
    name: "Payroll",
    workspace_id: WS_C,
    created_by: "someone-else",
    workspace: { name: "Other", kind: "standard" },
  };

  /** Lent to CONTAINER `scope`; the caller is a member of A (the lock) and of B (outside it). */
  function containerScene(scope: string, isLocked: boolean) {
    return makeAdmin(
      {
        resource_grants: [{ scope_type: "container", scope_id: scope, resource_id: T1, level: "read" }],
        workspaces: [],
      },
      {
        workspace_members: [
          isLocked ? [member(WS_A)] : [member(WS_A), member(WS_B)],
          [member(WS_A), member(WS_B)],
        ],
        knowledge_bases: [[], [rowInC]],
      }
    );
  }

  /** Lent `visible` to a CHANNEL in `container` (a link workspace); the caller is in the channel. */
  function channelScene(channel: string, container: string, isLocked: boolean) {
    const kind = [{ id: container, kind: "link" }];
    return makeAdmin(
      {
        resource_grants: [{ scope_type: "channel", scope_id: channel, resource_id: T1, level: "visible" }],
        channel_members: [{ channel_id: channel }],
        channels: [{ id: channel, workspace_id: container }],
      },
      {
        // Locked: the one home-space lookup answers "none", then the kind read.
        workspaces: isLocked ? [[], kind] : [kind],
        workspace_members: [isLocked ? [member(WS_A)] : [member(WS_A), member(WS_B)]],
        knowledge_bases: [[], [rowInC]],
      }
    );
  }

  it("control: UNLOCKED, a container grant to B names the row", async () => {
    containerScene(WS_B, false);
    expect(await resolveResource(caller, "knowledge_base", T1)).toMatchObject({ containerId: WS_C });
  });

  it("🔒 LOCKED to A, a row in C lent to container B (outside the lock) does NOT resolve", async () => {
    containerScene(WS_B, true);
    expect(await resolveResource(locked, "knowledge_base", T1)).toBeNull();
  });

  it("LOCKED to A, a row in C lent to container A (inside the lock) still resolves", async () => {
    containerScene(WS_A, true);
    expect(await resolveResource(locked, "knowledge_base", T1)).toMatchObject({ containerId: WS_C });
  });

  it("control: UNLOCKED, a channel grant in B names the row", async () => {
    channelScene(CH_B, WS_B, false);
    expect(await resolveResource(caller, "knowledge_base", T1)).toMatchObject({ containerId: WS_C });
  });

  it("🔒 LOCKED to A, a channel grant whose channel sits in B does NOT resolve", async () => {
    channelScene(CH_B, WS_B, true);
    expect(await resolveResource(locked, "knowledge_base", T1)).toBeNull();
  });

  it("LOCKED to A, a channel grant whose channel sits in A still resolves", async () => {
    channelScene(CH_A, WS_A, true);
    expect(await resolveResource(locked, "knowledge_base", T1)).toMatchObject({ containerId: WS_C });
  });
});
