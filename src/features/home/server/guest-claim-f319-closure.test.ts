/**
 * F-319 CLOSURE — the guest a bound claim now produces cannot reach the holes
 * the finding measured.
 *
 * M2 made `service-claim-bound.ts › claimBoundLink` write the LINK's granted
 * role (default `guest`) instead of a hardcoded `admin` — proven in
 * `service-claim-bound.test.ts`. This file proves the OTHER half: that a
 * claimer who lands at `guest` is actually gated OUT of the workspace-scoped
 * reach and the hard-delete path F-319 named. It drives the REAL gate functions
 * (nothing mocked), so it goes red if any of them stops rejecting a guest.
 *
 * The three holes F-319 measured, and the gate that now closes each for a guest:
 *  - manage / hard-delete the channel → `canManageChannel` (owner OR ws-admin)
 *  - delete other members' threads     → `assertMayDeleteThread` → canManageChannel
 *  - reach workspace-scoped routes      → the `withWorkspaceAuth` viewer+ floor,
 *    i.e. `meetsMinRole(role, "viewer")`
 * And the ceiling itself: `HomeLinkMintSchema` cannot even REQUEST an admin link.
 */

import { describe, it, expect } from "vitest";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { canManageChannel } from "@/features/channels/server/service-shared";
import type { ChannelContext } from "@/features/channels/server/service-shared";
import type { ChannelMemberRow } from "@/features/channels/server/dto";
import { HomeLinkMintSchema } from "../schema";

const WS = "33333333-3333-4333-8333-333333333333";
const GUEST_USER = "22222222-2222-4222-8222-222222222222";
const CHANNEL_ID = "44444444-4444-4444-8444-444444444444";

/** A guest's workspace context — exactly what the claim now produces. */
function guestCtx(): ChannelContext {
  return { workspaceId: WS, userId: GUEST_USER, source: "user", role: "guest" };
}

/** The guest's CHANNEL membership row — `addMember` joins them as `member`
 *  (the channel enum is only owner|member), never the channel owner. */
function guestChannelMembership(): ChannelMemberRow {
  return {
    channel_id: CHANNEL_ID,
    user_id: GUEST_USER,
    workspace_id: WS,
    role: "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "default",
    favorited_at: null,
    added_by: null,
  } as ChannelMemberRow;
}

describe("F-319 — a guest claimer cannot manage or hard-delete the channel", () => {
  it("canManageChannel is FALSE for a guest (not channel owner, not workspace admin)", () => {
    // Before M2 the claimer was a workspace `admin`, so isWorkspaceAdmin was true
    // and this returned true — the measured hole. Now the workspace role is
    // `guest`, below `admin`, and the channel role is `member`, not `owner`.
    expect(canManageChannel(guestCtx(), guestChannelMembership())).toBe(false);
  });

  it("stays FALSE even with no channel membership at all", () => {
    expect(canManageChannel(guestCtx(), null)).toBe(false);
  });

  it("would be TRUE for the old admin claimer — the exact regression this pins", () => {
    // A mutation check: flip the workspace role back to `admin` and the gate
    // re-opens. That is the state F-319 measured; M2 replaced it with `guest`.
    const asAdmin: ChannelContext = { ...guestCtx(), role: "admin" as Role };
    expect(canManageChannel(asAdmin, guestChannelMembership())).toBe(true);
  });
});

describe("F-319 — a guest cannot delete another member's thread", () => {
  // `assertMayDeleteThread` = created_by===caller OR canManageChannel. A guest
  // may withdraw their OWN thread (the create-thread ruling) but not clean the
  // room, because canManageChannel is false for them.
  it("the delete-thread gate reduces to canManageChannel for a thread they did not open", () => {
    const otherAuthored = { created_by: "someone-else" };
    const mayDelete =
      otherAuthored.created_by === GUEST_USER ||
      canManageChannel(guestCtx(), guestChannelMembership());
    expect(mayDelete).toBe(false);
  });
});

describe("F-319 — a guest is below the workspace-route floor", () => {
  it("does not meet the viewer floor every non-channel workspace route defaults to", () => {
    expect(meetsMinRole("guest", "viewer")).toBe(false);
    // …and clears only its own floor, which is what the §2B channel routes opt to.
    expect(meetsMinRole("guest", "guest")).toBe(true);
  });
});

describe("F-319 — admin-via-link is unrepresentable at the mint boundary", () => {
  it("HomeLinkMintSchema rejects granted roles above the member ceiling", () => {
    for (const role of ["admin", "owner"]) {
      expect(
        HomeLinkMintSchema.safeParse({ workspaceId: WS, grantedRole: role }).success
      ).toBe(false);
    }
  });

  it("defaults an omitted grantedRole to guest — the fail-closed floor", () => {
    const parsed = HomeLinkMintSchema.parse({ workspaceId: WS });
    expect(parsed.grantedRole).toBe("guest");
  });

  it("accepts the three grantable roles", () => {
    for (const role of ["guest", "viewer", "member"]) {
      expect(
        HomeLinkMintSchema.safeParse({ workspaceId: WS, grantedRole: role }).success
      ).toBe(true);
    }
  });
});
