/**
 * `service-writes.ts` — three gates, in the order each service applies them:
 *  - `createHomeChannel`: one container, one PRIVATE NON-DIRECT channel, rollback
 *    if the channel cannot be opened.
 *  - `mintContainerLink`: membership FIRST (404, never 403), FULL before insert.
 *  - `claimLink` (LEGACY UNBOUND, still live): unknown 404, dead 410, own 400,
 *    pair dedup before spend, atomic use guard.
 * ⚠ THE WHOLE ROLE HALF OF THE MINT LIVES IN
 * `service-writes-granted-role.test.ts` — the floor (a guest may not mint),
 * grant-above-self, and the reuse-only-when-the-grant-matches rule. The
 * same-role reuse case MOVED there on 2026-08-26: it could not tell a matching
 * grant from an ignored one, which was the bug. This file is at the cap. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpError } from "@/shared/lib/http-error";

vi.mock("./repository", () => ({
  insertLink: vi.fn(),
  findLinkByToken: vi.fn(),
  findLinkById: vi.fn(),
  findOpenLinkForWorkspace: vi.fn(),
  markLinkRevoked: vi.fn(),
  consumeLinkUse: vi.fn(),
  insertClaim: vi.fn(),
  findPairContainer: vi.fn(),
  findMemberContainer: vi.fn(),
  countActiveContainerMembers: vi.fn(),
  insertLinkContainer: vi.fn(),
  insertSoloContainer: vi.fn(),
}));
// ⚠ `hydrateOneChannel`, not `hydrateChannels`: the "one container, or a 500"
// helper moved into `service-reads.ts` on 2026-08-25 so the bound claim could
// share the decision rather than copy it. Every CASE below is unchanged — only
// which symbol the writes reach for.
vi.mock("./service-reads", () => ({ hydrateOneChannel: vi.fn() }));
vi.mock("./service-claim-bound", () => ({ claimBoundLink: vi.fn() }));
vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: vi.fn((auth) => auth),
  createChannel: vi.fn(),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  deleteWorkspace: vi.fn(),
  listProfileSummaries: vi.fn(),
  findMembership: vi.fn(),
}));

import {
  claimLink,
  createHomeChannel,
  mintContainerLink,
  revokeLink,
} from "./service-writes";
import * as repo from "./repository";
import type { ChannelLinkRow, LinkContainerRow } from "./dto";
import { hydrateOneChannel } from "./service-reads";
import { claimBoundLink } from "./service-claim-bound";
import { createChannel } from "@/features/channels/server/service";
import {
  deleteWorkspace,
  findMembership,
  listProfileSummaries,
} from "@/features/workspaces/server/repository";
import type { WorkspaceMembership } from "@/features/workspaces/types";

const CREATOR = "11111111-1111-4111-8111-111111111111";
const CLAIMER = "22222222-2222-4222-8222-222222222222";
const WS = "33333333-3333-4333-8333-333333333333";

const mocked = vi.mocked(repo);
const mockHydrate = vi.mocked(hydrateOneChannel);
const mockClaimBound = vi.mocked(claimBoundLink);
const mockCreateChannel = vi.mocked(createChannel);
const mockProfiles = vi.mocked(listProfileSummaries);

function linkRow(patch: Partial<ChannelLinkRow> = {}): ChannelLinkRow {
  return {
    id: "link-1",
    creator_user_id: CREATOR,
    workspace_id: null,
    token: "tok_abc",
    label: null,
    expires_at: null,
    max_uses: null,
    use_count: 0,
    revoked_at: null,
    created_at: "2026-08-23T00:00:00.000Z",
    granted_role: "guest",
    ...patch,
  };
}

const CONTAINER: LinkContainerRow = {
  id: WS,
  slug: "ada-grace",
  public_id: "abc123def456",
  created_at: "2026-08-23T00:00:00.000Z",
};

const CHANNEL = {
  workspaceId: WS,
  workspaceSegment: "ada-grace-abc123def456",
  channelId: "44444444-4444-4444-8444-444444444444",
  name: "Ada & Grace",
  peer: {
    userId: CREATOR,
    displayName: "Ada",
    email: "ada@x.dev",
    avatarUrl: null,
  },
  createdAt: "2026-08-23T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  linkOut: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.findLinkByToken.mockResolvedValue(linkRow());
  mocked.findPairContainer.mockResolvedValue(null);
  mocked.consumeLinkUse.mockResolvedValue(true);
  mocked.insertLinkContainer.mockResolvedValue(CONTAINER);
  mocked.insertSoloContainer.mockResolvedValue(CONTAINER);
  mocked.insertClaim.mockResolvedValue(true);
  mocked.findMemberContainer.mockResolvedValue(CONTAINER);
  mocked.countActiveContainerMembers.mockResolvedValue(1);
  mocked.findOpenLinkForWorkspace.mockResolvedValue(null);
  // Minter is the container OWNER → grant-above-self passes (pinned separately).
  vi.mocked(findMembership).mockResolvedValue({ role: "owner" } as WorkspaceMembership);
  mockHydrate.mockResolvedValue(CHANNEL);
  mockProfiles.mockResolvedValue(
    new Map([
      [CREATOR, { email: "ada@x.dev", displayName: "Ada", avatarUrl: null }],
      [CLAIMER, { email: "grace@x.dev", displayName: "Grace", avatarUrl: null }],
    ])
  );
});

describe("createHomeChannel", () => {
  it("mints a SOLO container the caller owns, slugged from the name", async () => {
    const result = await createHomeChannel(CREATOR, { name: "Q3 Fundraise" });

    expect(mocked.insertSoloContainer).toHaveBeenCalledWith({
      ownerUserId: CREATOR,
      name: "Q3 Fundraise",
      slug: "q3-fundraise",
    });
    expect(result).toEqual({ channel: CHANNEL });
  });

  it("opens a PRIVATE, NON-DIRECT channel through the channels service, as the container's owner", async () => {
    await createHomeChannel(CREATOR, { name: "Q3 Fundraise" });

    // ⚠ `direct: true` would ask createDirectChannel for a self-DM, and there
    // is no peer to be direct with — the whole point is a channel of one.
    expect(mockCreateChannel).toHaveBeenCalledWith(
      { userId: CREATOR, workspaceId: WS, role: "owner" },
      { name: "Q3 Fundraise", visibility: "private" }
    );
    const [, input] = mockCreateChannel.mock.calls[0];
    expect(input).not.toHaveProperty("direct");
    expect(input).not.toHaveProperty("memberUserId");
  });

  it("drops the container when its channel cannot be opened", async () => {
    // ⚠ A container with no channel is a BRICK: `hydrateChannels` drops it, so
    // the operator never sees it, while it still counts as a workspace
    // everywhere that enumerates memberships.
    mockCreateChannel.mockRejectedValueOnce(new Error("channel service is down"));

    await expect(
      createHomeChannel(CREATOR, { name: "Q3 Fundraise" })
    ).rejects.toThrow("channel service is down");
    expect(deleteWorkspace).toHaveBeenCalledWith(WS);
    expect(mockHydrate).not.toHaveBeenCalled();
  });
});

describe("mintContainerLink — the gate", () => {
  it("404s a caller who is not a member, and never reaches the insert", async () => {
    // ⚠ 404 rather than 403: a 403 would confirm which container ids exist.
    mocked.findMemberContainer.mockResolvedValue(null);

    await expect(mintContainerLink(CLAIMER, WS, { workspaceId: WS, grantedRole: "guest" })).rejects.toMatchObject({
      status: 404,
      code: "CHANNEL_NOT_FOUND",
    });
    expect(mocked.countActiveContainerMembers).not.toHaveBeenCalled();
    expect(mocked.insertLink).not.toHaveBeenCalled();
  });

  it("409s a FULL container BEFORE inserting anything", async () => {
    mocked.countActiveContainerMembers.mockResolvedValue(2);

    await expect(
      mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: "guest" })
    ).rejects.toMatchObject({ status: 409, code: "LINK_CONTAINER_FULL" });
    expect(mocked.findOpenLinkForWorkspace).not.toHaveBeenCalled();
    expect(mocked.insertLink).not.toHaveBeenCalled();
  });

  it("REVOKES a dead (un-revoked but expired) open link and mints a fresh one", async () => {
    // ⚠ "Open" = the one-open index predicate (revoked_at IS NULL), NOT
    // "claimable". An expired-yet-unrevoked row would be handed out as a URL
    // that 410s at claim, AND — left un-revoked — it bricks the channel: the
    // unique index blocks a replacement while hydrateChannels hides the Revoke
    // button. So the dead row is revoked (scoped to its OWN creator) and a fresh
    // link is minted.
    const dead = linkRow({
      id: "dead",
      workspace_id: WS,
      max_uses: 1,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    mocked.findOpenLinkForWorkspace.mockResolvedValue(dead);
    mocked.insertLink.mockImplementation(async (args) =>
      linkRow({ id: "fresh", token: args.token, workspace_id: args.workspaceId })
    );

    const result = await mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: "guest" });

    expect(mocked.markLinkRevoked).toHaveBeenCalledWith("dead", CREATOR);
    expect(mocked.insertLink).toHaveBeenCalled();
    expect(result.link.id).toBe("fresh");
  });

  it("revokes a dead link scoped to ITS creator, not the caller (any member may mint)", async () => {
    // The other member minted the now-dead link; the caller minting a
    // replacement must still be able to revoke it, so the revoke is scoped to
    // the link's own creator rather than the caller.
    const dead = linkRow({
      id: "dead",
      creator_user_id: CLAIMER,
      workspace_id: WS,
      max_uses: 1,
      use_count: 1,
    });
    mocked.findOpenLinkForWorkspace.mockResolvedValue(dead);
    mocked.insertLink.mockImplementation(async (args) =>
      linkRow({ id: "fresh", token: args.token, workspace_id: args.workspaceId })
    );

    await mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: "guest" });

    expect(mocked.markLinkRevoked).toHaveBeenCalledWith("dead", CLAIMER);
  });

  it("mints a BOUND, single-use link with an unguessable url-safe token", async () => {
    mocked.insertLink.mockImplementation(async (args) =>
      linkRow({
        token: args.token,
        label: args.label,
        workspace_id: args.workspaceId,
        max_uses: args.maxUses,
      })
    );

    const result = await mintContainerLink(CREATOR, WS, {
      workspaceId: WS,
      label: "bio",
      grantedRole: "guest",
    });

    const [args] = mocked.insertLink.mock.calls[0];
    expect(args.creatorUserId).toBe(CREATOR);
    expect(args.workspaceId).toBe(WS);
    // A bound link fills the container's ONE free seat — single-use by
    // construction, never a client choice.
    expect(args.maxUses).toBe(1);
    expect(args.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(args.expiresAt).toBeNull();
    expect(result.link.url).toContain(`/link/${args.token}`);
  });

  it("CONVERGES on the winner when a concurrent mint took the unique index", async () => {
    mocked.insertLink.mockRejectedValue({ code: "23505" });
    mocked.findOpenLinkForWorkspace
      .mockResolvedValueOnce(null)
      .mockResolvedValue(linkRow({ id: "winner", workspace_id: WS, max_uses: 1 }));

    const result = await mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: "guest" });

    expect(result.link.id).toBe("winner");
  });

  it("rethrows an insert failure that is NOT the unique index", async () => {
    mocked.insertLink.mockRejectedValue({ code: "23503" });
    await expect(
      mintContainerLink(CREATOR, WS, { workspaceId: WS, grantedRole: "guest" })
    ).rejects.toMatchObject({ code: "23503" });
  });

});

describe("revokeLink", () => {
  it("is idempotent on a link already revoked", async () => {
    mocked.markLinkRevoked.mockResolvedValue(false);
    mocked.findLinkById.mockResolvedValue(linkRow({ revoked_at: "x" }));
    await expect(revokeLink(CREATOR, "link-1")).resolves.toBeUndefined();
  });

  it("404s somebody else's link — a revoke must not confirm a link id", async () => {
    mocked.markLinkRevoked.mockResolvedValue(false);
    mocked.findLinkById.mockResolvedValue(null);
    await expect(revokeLink(CLAIMER, "link-1")).rejects.toMatchObject({
      status: 404,
      code: "LINK_NOT_FOUND",
    });
  });
});

describe("claimLink — the front door", () => {
  /**
   * ⚠ THE PROLOGUE IS SHARED AND THE BODIES ARE NOT. Token validity is a
   * property of the TOKEN, so it is judged once before anything knows which
   * shape of claim this is; everything after depends on `workspace_id`. These
   * cases pin the seam, because a bound token falling into the unbound body
   * would MINT A SECOND CONTAINER for a pair that already shares one — silently,
   * and with the transcript split across the two.
   */
  it("routes a BOUND link to claimBoundLink and runs no unbound step", async () => {
    const bound = { channel: CHANNEL, existing: false, bound: true };
    mockClaimBound.mockResolvedValue(bound);
    const link = linkRow({ workspace_id: WS });
    mocked.findLinkByToken.mockResolvedValue(link);

    await expect(claimLink("tok_abc", CLAIMER)).resolves.toEqual(bound);

    expect(mockClaimBound).toHaveBeenCalledWith(link, CLAIMER);
    expect(mocked.findPairContainer).not.toHaveBeenCalled();
    expect(mocked.consumeLinkUse).not.toHaveBeenCalled();
    expect(mocked.insertLinkContainer).not.toHaveBeenCalled();
  });

  it("keeps an UNBOUND link on the legacy branch", async () => {
    await claimLink("tok_abc", CLAIMER);
    expect(mockClaimBound).not.toHaveBeenCalled();
    expect(mocked.insertLinkContainer).toHaveBeenCalled();
  });

  it.each([
    ["unknown token", null, 404, "LINK_NOT_FOUND"],
    ["dead link", { max_uses: 1, use_count: 1 }, 410, "LINK_UNAVAILABLE"],
  ])(
    "judges the TOKEN before it dispatches: %s never reaches the bound branch",
    async (_label, patch, status, code) => {
      mocked.findLinkByToken.mockResolvedValue(
        patch === null ? null : linkRow({ workspace_id: WS, ...patch })
      );
      await expect(claimLink("tok_abc", CLAIMER)).rejects.toMatchObject({
        status,
        code,
      });
      expect(mockClaimBound).not.toHaveBeenCalled();
    }
  );
});

describe("claimLink — the gate", () => {
  it("404s an unknown token and spends nothing", async () => {
    mocked.findLinkByToken.mockResolvedValue(null);
    await expect(claimLink("nope", CLAIMER)).rejects.toBeInstanceOf(HttpError);
    await expect(claimLink("nope", CLAIMER)).rejects.toMatchObject({
      status: 404,
      code: "LINK_NOT_FOUND",
    });
    expect(mocked.consumeLinkUse).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked", { revoked_at: new Date(Date.now() - 1000).toISOString() }],
    ["expired", { expires_at: new Date(Date.now() - 1000).toISOString() }],
    ["exhausted", { max_uses: 1, use_count: 1 }],
  ])("410s a %s link before touching the pair", async (_label, patch) => {
    mocked.findLinkByToken.mockResolvedValue(linkRow(patch));
    await expect(claimLink("tok_abc", CLAIMER)).rejects.toMatchObject({
      status: 410,
      code: "LINK_UNAVAILABLE",
    });
    expect(mocked.findPairContainer).not.toHaveBeenCalled();
    expect(mocked.consumeLinkUse).not.toHaveBeenCalled();
  });

  it("400s a self-claim — there is no direct channel with yourself", async () => {
    await expect(claimLink("tok_abc", CREATOR)).rejects.toMatchObject({
      status: 400,
      code: "LINK_SELF_CLAIM",
    });
    expect(mocked.consumeLinkUse).not.toHaveBeenCalled();
  });

  it("410s when the atomic guard says the last use went to somebody else", async () => {
    // ⚠ The row read at the top said claimable; `consumeLinkUse` is the only
    // authority, and its `false` must not be retried or re-read.
    mocked.consumeLinkUse.mockResolvedValue(false);
    await expect(claimLink("tok_abc", CLAIMER)).rejects.toMatchObject({
      status: 410,
      code: "LINK_UNAVAILABLE",
    });
    expect(mocked.insertLinkContainer).not.toHaveBeenCalled();
    // The re-check is of the PAIR, never of the link row.
    expect(mocked.findLinkByToken).toHaveBeenCalledTimes(1);
  });

  it("a same-account race that lost the use gets its channel, not a 410", async () => {
    // ⚠ Two tabs of ONE account open a single-use link together: both clear the
    // dedup, one wins the use and mints, the other reads exhausted. The loser is
    // staring at a channel that now exists — 410 would refuse the claimer their
    // own successful claim.
    mocked.consumeLinkUse.mockResolvedValue(false);
    mocked.findPairContainer.mockResolvedValueOnce(null).mockResolvedValue(CONTAINER);

    const result = await claimLink("tok_abc", CLAIMER);

    expect(result).toEqual({ channel: CHANNEL, existing: true, bound: false });
    expect(mocked.findPairContainer).toHaveBeenCalledTimes(2);
    expect(mocked.insertLinkContainer).not.toHaveBeenCalled();
  });
});

describe("claimLink — the happy paths", () => {
  it("returns the existing container and spends NO use when the pair is already connected", async () => {
    mocked.findPairContainer.mockResolvedValue(CONTAINER);

    const result = await claimLink("tok_abc", CLAIMER);

    expect(result).toEqual({ channel: CHANNEL, existing: true, bound: false });
    expect(mocked.consumeLinkUse).not.toHaveBeenCalled();
    expect(mocked.insertLinkContainer).not.toHaveBeenCalled();
    expect(mocked.findPairContainer).toHaveBeenCalledWith(CREATOR, CLAIMER);
  });

  it("mints the container, opens the direct channel through the channels service, records the claim", async () => {
    const result = await claimLink("tok_abc", CLAIMER);

    expect(result).toEqual({ channel: CHANNEL, existing: false, bound: false });
    expect(mocked.insertLinkContainer).toHaveBeenCalledWith({
      creatorUserId: CREATOR,
      claimerUserId: CLAIMER,
      name: "Ada & Grace",
      slug: "ada-grace",
    });
    // ⚠ The dedup + membership-of-2 rules live in `createDirectChannel`, and
    // this must call it rather than re-implement them.
    expect(mockCreateChannel).toHaveBeenCalledWith(
      { userId: CREATOR, workspaceId: WS, role: "owner" },
      { direct: true, memberUserId: CLAIMER }
    );
    expect(mocked.insertClaim).toHaveBeenCalledWith({
      linkId: "link-1",
      claimedBy: CLAIMER,
      workspaceId: WS,
    });
  });

  it("names the container off the email local part when a side has no display name", async () => {
    mockProfiles.mockResolvedValue(new Map());
    await claimLink("tok_abc", CLAIMER);
    expect(mocked.insertLinkContainer).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Member & Member" })
    );
  });

  it("drops the container when its direct channel cannot be opened", async () => {
    // ⚠ A container with no channel is a BRICK: `hydrateChannels` drops it so
    // neither side sees it, while `findPairContainer` still finds it — every
    // later claim between this pair would dedup onto a channel that can never
    // render.
    mockCreateChannel.mockRejectedValueOnce(new Error("channel service is down"));

    await expect(claimLink("tok_abc", CLAIMER)).rejects.toThrow(
      "channel service is down"
    );
    expect(deleteWorkspace).toHaveBeenCalledWith(WS);
    // Rolled back BEFORE the claim row, so nothing points at the dropped one.
    expect(mocked.insertClaim).not.toHaveBeenCalled();
  });

  it("converges on the winner when a concurrent claim of the same link lost the unique", async () => {
    mocked.insertClaim.mockResolvedValue(false);
    const winner = { ...CONTAINER, id: "winner" };
    mocked.findPairContainer.mockResolvedValueOnce(null).mockResolvedValue(winner);

    const result = await claimLink("tok_abc", CLAIMER);

    expect(result.existing).toBe(true);
    // ⚠ The container this request minted is DROPPED — two containers for one
    // pair would render the same person twice, forever.
    expect(deleteWorkspace).toHaveBeenCalledWith(WS);
    expect(mockHydrate).toHaveBeenLastCalledWith(winner, CLAIMER);
  });
});
