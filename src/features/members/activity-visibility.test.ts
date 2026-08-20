import { describe, expect, it } from "vitest";
import {
  filterActivity,
  reachableResourceIds,
  type ActivityEventRow,
} from "./activity-visibility";

/**
 * The activity feed's visibility rule. It runs SERVER-side (the route calls it
 * before answering), so these are the assertions that stand between a peer and
 * a payload they should never receive.
 */

function event(over: Partial<ActivityEventRow> = {}): ActivityEventRow {
  return {
    id: "e1",
    actorUserId: "u-target",
    verb: "team.member_added",
    resourceType: "knowledge_base",
    resourceId: "kb-1",
    metadata: {},
    createdAt: "2026-08-19T10:00:00.000Z",
    ...over,
  };
}

const NONE = { reachable: new Set<string>(), callerTeamIds: new Set<string>() };

describe("reachableResourceIds", () => {
  it("counts read and edit alike, and drops null", () => {
    const ids = reachableResourceIds([
      { resourceId: "a", level: "edit" },
      { resourceId: "b", level: "read" },
      { resourceId: "c", level: null },
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
});

describe("filterActivity", () => {
  it("returns everything for self and admins", () => {
    const rows = [event(), event({ id: "e2", resourceId: "kb-2" })];
    expect(filterActivity(rows, { unfiltered: true, ...NONE })).toHaveLength(2);
  });

  it("keeps workspace-level events for everyone", () => {
    const rows = [event({ id: "joined", verb: "member.joined", resourceType: null, resourceId: null })];
    expect(filterActivity(rows, { unfiltered: false, ...NONE })).toHaveLength(1);
  });

  it("drops resource events the caller cannot reach", () => {
    const rows = [event({ id: "reachable", resourceId: "kb-1" }), event({ id: "hidden", resourceId: "kb-9" })];
    const kept = filterActivity(rows, {
      unfiltered: false,
      reachable: new Set(["kb-1"]),
      callerTeamIds: new Set(),
    });
    // ABSENT, not redacted — a count of what you cannot see still tells you it
    // exists, which is most of the leak.
    expect(kept.map((r) => r.id)).toEqual(["reachable"]);
  });

  it("scopes team events by the caller's own team membership", () => {
    const rows = [
      event({ id: "mine", resourceType: "team", resourceId: "t-1" }),
      event({ id: "theirs", resourceType: "team", resourceId: "t-2" }),
    ];
    const kept = filterActivity(rows, {
      unfiltered: false,
      reachable: new Set(),
      callerTeamIds: new Set(["t-1"]),
    });
    expect(kept.map((r) => r.id)).toEqual(["mine"]);
  });

  it("never lets a resource event through on an empty reachable set", () => {
    const rows = [event(), event({ id: "e2", resourceType: "skill", resourceId: "s-1" })];
    expect(filterActivity(rows, { unfiltered: false, ...NONE })).toEqual([]);
  });

  it("hides removals and invitations from peers — they are not roster facts", () => {
    // A removed member is gone from the roster a peer can read, and an invited
    // address belongs to nobody yet. Both rows name their subject in metadata.
    const rows = [
      event({ id: "removed", verb: "member.removed", resourceType: null, resourceId: null }),
      event({ id: "invited", verb: "member.invited", resourceType: null, resourceId: null }),
      event({ id: "joined", verb: "member.joined", resourceType: null, resourceId: null }),
    ];
    expect(filterActivity(rows, { unfiltered: false, ...NONE }).map((r) => r.id)).toEqual([
      "joined",
    ]);
    // Admins and the actor still see them.
    expect(filterActivity(rows, { unfiltered: true, ...NONE })).toHaveLength(3);
  });

  it("FAILS CLOSED on a half-formed row", () => {
    // The DB CHECK makes these unrepresentable today; this function is the
    // boundary regardless, so neither half-shape may fall through to visible.
    const typeOnly = event({ id: "type-only", resourceType: "skill", resourceId: null });
    const idOnly = event({ id: "id-only", resourceType: null, resourceId: "kb-1" });
    expect(filterActivity([typeOnly, idOnly], { unfiltered: false, ...NONE })).toEqual([]);
  });
});
