/**
 * `mintContainerLink` — the LINK-CARRIED ROLE half (M2; closes F-319):
 *
 *  - the link carries `input.grantedRole`, threaded into `insertLink`, so the
 *    claimer lands at exactly that role (default `guest`);
 *  - GRANT-ABOVE-SELF: a minter cannot hand out a role above their own — 403,
 *    before anything is inserted;
 *  - THE MINT FLOOR (2026-08-26): a minter must be `member`+, so a surviving
 *    GUEST cannot invite a third party into the operator's transcript;
 *  - THE ROLE-PICKER FIX (2026-08-26): an OPEN link is reused only when it
 *    grants what was asked for, and revoked-and-reminted when it does not.
 *
 * Split from `service-writes.test.ts` to keep that file under the 500-line cap.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository", () => ({
  insertLink: vi.fn(),
  findOpenLinkForWorkspace: vi.fn(),
  findMemberContainer: vi.fn(),
  countActiveContainerMembers: vi.fn(),
  markLinkRevoked: vi.fn(),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  findMembership: vi.fn(),
}));

import { mintContainerLink } from "./service-writes";
import * as repo from "./repository";
import type { ChannelLinkRow, LinkContainerRow } from "./dto";
import { findMembership } from "@/features/workspaces/server/repository";
import type { Role } from "@/features/workspaces/types";

const CREATOR = "11111111-1111-4111-8111-111111111111";
const WS = "33333333-3333-4333-8333-333333333333";

const mocked = vi.mocked(repo);
const mockFindMembership = vi.mocked(findMembership);

const CONTAINER: LinkContainerRow = {
  id: WS,
  slug: "q3",
  public_id: "abc123def456",
  created_at: "2026-08-25T00:00:00.000Z",
};

function membership(role: Role) {
  return {
    workspaceId: WS,
    userId: CREATOR,
    role,
    status: "active" as const,
    joinedAt: "2026-08-25T00:00:00.000Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.findMemberContainer.mockResolvedValue(CONTAINER);
  mocked.countActiveContainerMembers.mockResolvedValue(1);
  mocked.findOpenLinkForWorkspace.mockResolvedValue(null);
  mockFindMembership.mockResolvedValue(membership("owner"));
  mocked.insertLink.mockImplementation(
    async (args) =>
      ({
        id: "fresh",
        creator_user_id: args.creatorUserId,
        workspace_id: args.workspaceId,
        token: args.token,
        label: args.label,
        expires_at: args.expiresAt,
        max_uses: args.maxUses,
        use_count: 0,
        revoked_at: null,
        created_at: "2026-08-25T00:00:00.000Z",
        granted_role: args.grantedRole,
      }) as ChannelLinkRow
  );
});

describe("mintContainerLink — grantedRole threads to insertLink", () => {
  it.each(["guest", "viewer", "member"] as const)(
    "carries grantedRole=%s onto the link the claimer will land at",
    async (role) => {
      await mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: role });
      expect(mocked.insertLink.mock.calls[0][0].grantedRole).toBe(role);
    }
  );
});

describe("mintContainerLink — the MINT FLOOR (a guest may not invite)", () => {
  // 🔒 DEPARTURE IS REMOVAL (§4A), so a container can drop back to ONE member.
  // If that survivor is a GUEST, the two-member cap frees a seat and — before
  // this floor — nothing else refused: `meetsMinRole("guest","guest")` is TRUE,
  // so grant-above-self passed and a guest could hand a stranger a link into
  // the operator's transcript.
  it.each(["guest", "viewer"] as const)(
    "403s a %s minter before anything is read or inserted",
    async (role) => {
      mockFindMembership.mockResolvedValue(membership(role));

      await expect(
        mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: "guest" })
      ).rejects.toMatchObject({ status: 403, code: "LINK_MINT_FORBIDDEN" });
      expect(mocked.countActiveContainerMembers).not.toHaveBeenCalled();
      expect(mocked.findOpenLinkForWorkspace).not.toHaveBeenCalled();
      expect(mocked.insertLink).not.toHaveBeenCalled();
    }
  );

  it.each(["member", "admin", "owner"] as const)(
    "lets a %s minter through — the ruling that ANY member may mint survives",
    async (role) => {
      mockFindMembership.mockResolvedValue(membership(role));
      await expect(
        mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: "guest" })
      ).resolves.toBeDefined();
    }
  );

  it("403s when there is no ACTIVE membership at all", async () => {
    // `findMembership` filters `status='active'` since 2026-08-26, so a revoked
    // row arrives as null rather than as its stale role.
    mockFindMembership.mockResolvedValue(null);
    await expect(
      mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: "guest" })
    ).rejects.toMatchObject({ status: 403, code: "LINK_MINT_FORBIDDEN" });
  });
});

describe("mintContainerLink — grant-above-self", () => {
  it("403s when the minter grants a role above their own, before any insert", async () => {
    // The DB CHECK caps a link at `member`; this guard caps it at the MINTER's
    // own role. In a real container the minter is the owner so this always
    // passes — the guard is the invariant that survives a future where a
    // lower-ranked member can mint.
    //
    // ⚠ IT IS A SEPARATE GUARD FROM THE FLOOR ABOVE and the codes prove it: a
    // `member` clears the floor and is still refused an `admin` grant. (Zod caps
    // the schema at `member`, so this drives the service with a value the route
    // would have rejected — the guard has to hold on its own.)
    mockFindMembership.mockResolvedValue(membership("member"));

    await expect(
      mintContainerLink(CREATOR, WS, {
        workspaceId: WS,
        grantedRole: "admin" as never,
      })
    ).rejects.toMatchObject({ status: 403, code: "GRANT_ABOVE_SELF" });
    expect(mocked.countActiveContainerMembers).not.toHaveBeenCalled();
    expect(mocked.insertLink).not.toHaveBeenCalled();
  });

  it("lets a minter grant AT their own floor — a member may mint a member link", async () => {
    mockFindMembership.mockResolvedValue(membership("member"));

    await expect(
      mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: "member" })
    ).resolves.toBeDefined();
    expect(mocked.insertLink.mock.calls[0][0].grantedRole).toBe("member");
  });
});

describe("mintContainerLink — an OPEN link is reused only when the GRANT MATCHES", () => {
  /** A live, claimable, BOUND link granting `role`. */
  function openLink(role: Role): ChannelLinkRow {
    return {
      id: "already",
      creator_user_id: CREATOR,
      workspace_id: WS,
      token: "tok_open",
      label: null,
      expires_at: null,
      max_uses: 1,
      use_count: 0,
      revoked_at: null,
      created_at: "2026-08-25T00:00:00.000Z",
      granted_role: role,
    };
  }

  it("hands back the SAME link when the picked role matches (the getOrCreateJoinLink precedent)", async () => {
    mocked.findOpenLinkForWorkspace.mockResolvedValue(openLink("guest"));

    const result = await mintContainerLink(CREATOR, WS, {
      workspaceId: WS,
      grantedRole: "guest",
    });

    expect(result.link.id).toBe("already");
    expect(mocked.markLinkRevoked).not.toHaveBeenCalled();
    expect(mocked.insertLink).not.toHaveBeenCalled();
  });

  it("REVOKES and re-mints when the operator picked Member over an open GUEST link", async () => {
    // ⚠ THE BUG THIS PINS: the reuse branch returned the open row verbatim, so
    // "Member — full channel" answered 200 with the guest link and the peer
    // landed as a guest. The popover renders "Create another", so this is the
    // NORMAL second click, not an edge case.
    mocked.findOpenLinkForWorkspace.mockResolvedValue(openLink("guest"));

    const result = await mintContainerLink(CREATOR, WS, {
      workspaceId: WS,
      grantedRole: "member",
    });

    expect(mocked.markLinkRevoked).toHaveBeenCalledWith("already", CREATOR);
    expect(mocked.insertLink.mock.calls[0][0].grantedRole).toBe("member");
    expect(result.link.id).toBe("fresh");
    expect(result.link.grantedRole).toBe("member");
  });

  it("REVOKES and re-mints in the OTHER direction too — Guest picked over an open MEMBER link", async () => {
    // The same silence pointed AT privilege: without this the operator asking
    // for a chat-only guest kept handing out a full-member invitation.
    mocked.findOpenLinkForWorkspace.mockResolvedValue(openLink("member"));

    const result = await mintContainerLink(CREATOR, WS, {
      workspaceId: WS,
      grantedRole: "guest",
    });

    expect(mocked.markLinkRevoked).toHaveBeenCalledWith("already", CREATOR);
    expect(result.link.grantedRole).toBe("guest");
  });

  it("PROJECTS grantedRole onto the payload, so the UI can say what a link grants", async () => {
    // `mapLinkRow` dropped this field until 2026-08-26 — which is why nothing
    // downstream could notice the mismatch above in the first place.
    const result = await mintContainerLink(CREATOR, WS, {
      workspaceId: WS,
      grantedRole: "member",
    });
    expect(result.link.grantedRole).toBe("member");
  });
});
