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
 *    ⚠ CALLED, not re-implemented (corrected 2026-08-26 — see that describe block)
 *  - reach workspace-scoped routes      → the `withWorkspaceAuth` viewer+ floor,
 *    i.e. `meetsMinRole(role, "viewer")`
 * And the ceiling itself: `HomeLinkMintSchema` cannot even REQUEST an admin link.
 */

import { describe, it, expect } from "vitest";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { canManageChannel } from "@/features/channels/server/service-shared";
import { assertMayDeleteThread } from "@/features/channels/server/service-tasks-delete";
import { TaskForbiddenError } from "@/features/channels/server/errors";
import type { ChannelContext } from "@/features/channels/server/service-shared";
import type { ChannelMemberRow } from "@/features/channels/server/dto";
import { HomeLinkMintSchema } from "../schema";

const WS = "33333333-3333-4333-8333-333333333333";
const GUEST_USER = "22222222-2222-4222-8222-222222222222";
const CHANNEL_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER = "55555555-5555-4555-8555-555555555555";

/** A guest's workspace context — exactly what the claim now produces. */
function guestCtx(): ChannelContext {
  return {
    workspaceId: WS,
    userId: GUEST_USER,
    source: "user",
    role: "guest",
    credentialSubjectUserId: GUEST_USER,
  };
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
  //
  // ⚠ THIS CASE USED TO RE-IMPLEMENT THAT RULE INLINE and assert on its own
  // copy — a FALSE PASS: rewriting the real gate left it green, under a
  // docblock claiming nothing was mocked. It drives the exported function now
  // (2026-08-26).
  it("REFUSES a thread the guest did not open — driving the real gate", () => {
    expect(() =>
      assertMayDeleteThread(
        guestCtx(),
        { created_by: OTHER_USER },
        guestChannelMembership()
      )
    ).toThrow(TaskForbiddenError);
  });

  it("ALLOWS the guest to withdraw their OWN thread", () => {
    // The other half of the same rule — without it the test above would pass
    // against a gate that refuses everybody, which is not the claim.
    expect(() =>
      assertMayDeleteThread(
        guestCtx(),
        { created_by: GUEST_USER },
        guestChannelMembership()
      )
    ).not.toThrow();
  });

  it("would ALLOW the old admin claimer to delete anybody's thread — the regression", () => {
    // The mutation check, stated as behaviour: flip the workspace role back to
    // `admin` and the gate re-opens. That is the state F-319 measured.
    expect(() =>
      assertMayDeleteThread(
        { ...guestCtx(), role: "admin" as Role },
        { created_by: OTHER_USER },
        guestChannelMembership()
      )
    ).not.toThrow();
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

  it("leaves an omitted grantedRole UNDEFINED — the schema does not decide it", () => {
    // ⚠ THIS ASSERTED `"guest"` UNTIL 2026-08-26, and the `.default("guest")`
    // behind it was a live bug: it made "the operator picked Guest"
    // indistinguishable from "the field is absent", so an old client's mint
    // silently REVOKED and DOWNGRADED an open `member` link. Absent now means
    // "reuse whatever is open"; the fail-closed FRESH-mint default moved to
    // `service-writes.ts › mintContainerLink › roleToMint`, which the mint suite
    // drives. The floor did not go away — it stopped being stated where it could
    // not tell a pick from a silence.
    const parsed = HomeLinkMintSchema.parse({ workspaceId: WS });
    expect(parsed.grantedRole).toBeUndefined();
  });

  it("accepts the three grantable roles", () => {
    for (const role of ["guest", "viewer", "member"]) {
      expect(
        HomeLinkMintSchema.safeParse({ workspaceId: WS, grantedRole: role }).success
      ).toBe(true);
    }
  });
});
