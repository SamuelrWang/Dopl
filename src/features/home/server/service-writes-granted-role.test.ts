/**
 * `mintContainerLink` — the LINK-CARRIED ROLE half (M2; closes F-319):
 *
 *  - the link carries `input.grantedRole`, threaded into `insertLink`, so the
 *    claimer lands at exactly that role (default `guest`);
 *  - GRANT-ABOVE-SELF: a minter cannot hand out a role above their own — 403,
 *    before anything is inserted.
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

describe("mintContainerLink — grant-above-self", () => {
  it("403s when the minter grants a role above their own, before any insert", async () => {
    // The DB CHECK caps a link at `member`; this guard caps it at the MINTER's
    // own role. A viewer cannot mint a member link. In a real container the
    // minter is the owner so this always passes — the guard is the invariant
    // that survives a future where a non-owner can mint.
    mockFindMembership.mockResolvedValue(membership("viewer"));

    await expect(
      mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: "member" })
    ).rejects.toMatchObject({ status: 403, code: "GRANT_ABOVE_SELF" });
    expect(mocked.countActiveContainerMembers).not.toHaveBeenCalled();
    expect(mocked.insertLink).not.toHaveBeenCalled();
  });

  it("lets a minter grant AT their own floor — a viewer may mint a viewer link", async () => {
    mockFindMembership.mockResolvedValue(membership("viewer"));

    await expect(
      mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: "viewer" })
    ).resolves.toBeDefined();
    expect(mocked.insertLink.mock.calls[0][0].grantedRole).toBe("viewer");
  });
});
