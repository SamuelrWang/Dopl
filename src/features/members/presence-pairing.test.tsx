// @vitest-environment jsdom
/**
 * **R-12(a) — `showPresence` GETS ITS SERVER HALF** (Samuel, 2026-09-17: scrub
 * `lastSeenAt` per caller, **with the members DTO** and not before).
 *
 * `docs/MEMBERS-AUTHORIZATION.md` called this *"the only row in this doc where
 * the pairing is missing"*: the console hid `lastSeenAt` in the header, the
 * facts group and the roster rows, and the column shipped in the payload
 * anyway. This suite pins BOTH halves, in the order they now run — the wire
 * first, the render as the LAST line.
 *
 * ⚠ **THE CLIENT RULE IS KEPT ON PURPOSE AND IS NOT NOW REDUNDANT.** The server
 * decides what a caller may have; the components decide what this surface draws
 * from what it was handed. A payload from a cache, a fixture or a future second
 * reader can still carry the column, and a stamp on screen that the rule says is
 * hidden is the defect either way.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { scrubHiddenPresence } from "@/features/workspaces/server/dto";
import type { WorkspaceMembership } from "@/features/workspaces/types";
import { MemberFacts } from "./components/members-v2/member-facts";
import { MemberSectionCard } from "./components/members-v2/member-rows";
import { visibilityFor } from "./components/members-v2/visibility";
import type { WorkspaceMemberView } from "./types";

const WS = "ws-1";
const ME = "u-me";
const PEER = "u-peer";
/** Recent enough that `formatLastActive` renders a stamp, not "—". */
const SEEN = new Date(Date.now() - 60_000).toISOString();

function membership(userId: string, role: WorkspaceMembership["role"]): WorkspaceMembership {
  return {
    workspaceId: WS,
    userId,
    role,
    status: "active",
    joinedAt: "2026-08-01T00:00:00.000Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: SEEN,
  };
}

function view(userId: string, over: Partial<WorkspaceMemberView> = {}): WorkspaceMemberView {
  return {
    ...membership(userId, "member"),
    email: `${userId}@example.com`,
    displayName: userId,
    avatarUrl: null,
    teams: [],
    ...over,
  };
}

const ROSTER = [membership(ME, "member"), membership(PEER, "member")];

describe("the wire — `scrubHiddenPresence` (the members DTO)", () => {
  it("nulls a PEER's stamp for a non-admin caller and keeps their OWN", () => {
    const rows = scrubHiddenPresence(ROSTER, ME, "member");
    expect(rows.find((r) => r.userId === ME)?.lastSeenAt).toBe(SEEN);
    expect(rows.find((r) => r.userId === PEER)?.lastSeenAt).toBeNull();
  });

  it("keeps every stamp for an ADMIN and for an OWNER — `isAdmin || isSelf`", () => {
    for (const role of ["admin", "owner"] as const) {
      const rows = scrubHiddenPresence(ROSTER, ME, role);
      expect(rows.map((r) => r.lastSeenAt)).toEqual([SEEN, SEEN]);
    }
  });

  it("nulls a peer's stamp for a VIEWER and a GUEST too — the floor is admin", () => {
    for (const role of ["viewer", "guest"] as const) {
      const rows = scrubHiddenPresence(ROSTER, ME, role);
      expect(rows.find((r) => r.userId === PEER)?.lastSeenAt).toBeNull();
    }
  });

  it("does not mutate the rows it was handed", () => {
    scrubHiddenPresence(ROSTER, ME, "member");
    expect(ROSTER.every((r) => r.lastSeenAt === SEEN)).toBe(true);
  });
});

/**
 * ⚠ **THE FIXTURES BELOW CARRY A STAMP THE SERVER WOULD HAVE SCRUBBED**, which
 * is the only way to assert the client rule is still doing something. A fixture
 * that matched the new wire would pass with the rule deleted.
 */
describe("the render, as the last line — BOTH members-page surfaces", () => {
  it("the ROSTER row draws no stamp for a peer", () => {
    render(
      <MemberSectionCard
        members={[view(PEER)]}
        openUserId={null}
        showRowActions={false}
        canSeePresence={() => false}
        busy={false}
        onOpen={() => {}}
        onRemove={() => {}}
      />
    );
    expect(screen.queryByText("Active now")).toBeNull();
  });

  it("the DETAIL's facts group is absent entirely for a peer", () => {
    const peer = view(PEER);
    render(
      <MemberFacts
        member={peer}
        teams={[]}
        visibility={visibilityFor({ userId: ME, role: "member" }, peer)}
        busy={false}
        onJoinTeam={() => {}}
        onLeaveTeam={() => {}}
      />
    );
    // ⚠ The whole "Presence" box goes, not just its value — an empty labelled
    // section would say a peer HAS a presence nobody is allowed to read.
    expect(screen.queryByText("Presence")).toBeNull();
    expect(screen.queryByText("Last active")).toBeNull();
  });

  it("…and IS drawn for the viewer's own row — `isSelf`", () => {
    const mine = view(ME);
    render(
      <MemberFacts
        member={mine}
        teams={[]}
        visibility={visibilityFor({ userId: ME, role: "member" }, mine)}
        busy={false}
        onJoinTeam={() => {}}
        onLeaveTeam={() => {}}
      />
    );
    expect(screen.getByText("Last active")).toBeTruthy();
  });
});
