import { describe, expect, it } from "vitest";
import type { WorkspaceMemberView } from "../../types";
import { visibilityFor, visibleTabs, workspaceVisibility } from "./visibility";

/**
 * The client half of the members authorization matrix
 * (docs/MEMBERS-AUTHORIZATION.md). Every rule here has a server counterpart;
 * these assertions only pin what the console RENDERS.
 */

function member(over: Partial<WorkspaceMemberView> = {}): WorkspaceMemberView {
  return {
    workspaceId: "w1",
    userId: "u-target",
    role: "member",
    status: "active",
    joinedAt: "2026-01-01T00:00:00.000Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: null,
    email: "target@example.com",
    displayName: "Target",
    avatarUrl: null,
    teams: [],
    ...over,
  };
}

const OWNER = { userId: "u-owner", role: "owner" as const };
const ADMIN = { userId: "u-admin", role: "admin" as const };
const MEMBER = { userId: "u-member", role: "member" as const };
const VIEWER = { userId: "u-viewer", role: "viewer" as const };

describe("workspace capabilities", () => {
  it("gates invite and team management to admins", () => {
    for (const viewer of [OWNER, ADMIN]) {
      const v = workspaceVisibility(viewer);
      expect(v.canInvite && v.canManageTeams && v.showRowActions).toBe(true);
    }
    for (const viewer of [MEMBER, VIEWER]) {
      const v = workspaceVisibility(viewer);
      expect(v.canInvite || v.canManageTeams || v.showRowActions).toBe(false);
    }
  });
});

describe("per-target visibility", () => {
  it("never shows the no-access group to its own subject", () => {
    // THE rule most likely to be got wrong: naming what somebody was
    // deliberately not given, to that person.
    for (const viewer of [OWNER, ADMIN, MEMBER, VIEWER]) {
      const self = member({ userId: viewer.userId, role: viewer.role });
      expect(visibilityFor(viewer, self).showNoAccessGroup).toBe(false);
    }
  });

  it("shows the no-access group to an admin auditing someone else", () => {
    expect(visibilityFor(ADMIN, member()).showNoAccessGroup).toBe(true);
  });

  it("hides access and settings from a peer", () => {
    for (const viewer of [MEMBER, VIEWER]) {
      const v = visibilityFor(viewer, member());
      expect(v.showAccessTab).toBe(false);
      expect(v.showSettingsTab).toBe(false);
      expect(v.showPresence).toBe(false);
      expect(visibleTabs(v)).toEqual(["about", "activity"]);
    }
  });

  it("always offers the activity tab", () => {
    for (const viewer of [OWNER, ADMIN, MEMBER, VIEWER]) {
      expect(visibleTabs(visibilityFor(viewer, member()))).toContain("activity");
    }
  });

  it("refuses role and danger controls on self and on an owner row", () => {
    const ownerSelf = member({ userId: OWNER.userId, role: "owner" });
    const selfView = visibilityFor(OWNER, ownerSelf);
    expect(selfView.showRolePicker).toBe(false);
    expect(selfView.showDangerZone).toBe(false);

    const ownerRow = visibilityFor(ADMIN, member({ role: "owner" }));
    expect(ownerRow.showRolePicker).toBe(false);
    expect(ownerRow.showDangerZone).toBe(false);
  });

  it("refuses an admin managing another admin, and lets the owner", () => {
    const otherAdmin = member({ role: "admin" });
    expect(visibilityFor(ADMIN, otherAdmin).showDangerZone).toBe(false);
    expect(visibilityFor(OWNER, otherAdmin).showDangerZone).toBe(true);
  });

  it("lets only an admin grant the admin role", () => {
    expect(visibilityFor(ADMIN, member()).showRolePicker).toBe(true);
    // `canGrantRole` — only the owner mints admins.
    expect(visibilityFor(ADMIN, member({ role: "admin" })).showRolePicker).toBe(false);
  });

  it("makes the profile editable only for its owner", () => {
    const self = member({ userId: ADMIN.userId, role: "admin" });
    expect(visibilityFor(ADMIN, self).editableProfile).toBe(true);
    expect(visibilityFor(ADMIN, member()).editableProfile).toBe(false);
  });
});
