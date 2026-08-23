/**
 * `service-writes.ts` — the claim gate, in the order the service applies it:
 * unknown token 404, dead link 410, own link 400, pair dedup BEFORE any use is
 * spent, and the atomic use guard as the only thing between a single-use link
 * and a second claimer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpError } from "@/shared/lib/http-error";

vi.mock("./repository", () => ({
  insertLink: vi.fn(),
  findLinkByToken: vi.fn(),
  findLinkById: vi.fn(),
  markLinkRevoked: vi.fn(),
  consumeLinkUse: vi.fn(),
  insertClaim: vi.fn(),
  findPairContainer: vi.fn(),
  insertLinkContainer: vi.fn(),
}));
vi.mock("./service-reads", () => ({ hydrateRelationships: vi.fn() }));
vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: vi.fn((auth) => auth),
  createChannel: vi.fn(),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  deleteWorkspace: vi.fn(),
  listProfileSummaries: vi.fn(),
}));

import { claimLink, mintLink, revokeLink } from "./service-writes";
import * as repo from "./repository";
import type { ChannelLinkRow, LinkContainerRow } from "./dto";
import { hydrateRelationships } from "./service-reads";
import { createChannel } from "@/features/channels/server/service";
import {
  deleteWorkspace,
  listProfileSummaries,
} from "@/features/workspaces/server/repository";

const CREATOR = "11111111-1111-4111-8111-111111111111";
const CLAIMER = "22222222-2222-4222-8222-222222222222";
const WS = "33333333-3333-4333-8333-333333333333";

const mocked = vi.mocked(repo);
const mockHydrate = vi.mocked(hydrateRelationships);
const mockCreateChannel = vi.mocked(createChannel);
const mockProfiles = vi.mocked(listProfileSummaries);

function linkRow(patch: Partial<ChannelLinkRow> = {}): ChannelLinkRow {
  return {
    id: "link-1",
    creator_user_id: CREATOR,
    token: "tok_abc",
    label: null,
    expires_at: null,
    max_uses: null,
    use_count: 0,
    revoked_at: null,
    created_at: "2026-08-23T00:00:00.000Z",
    ...patch,
  };
}

const CONTAINER: LinkContainerRow = {
  id: WS,
  slug: "ada-grace",
  public_id: "abc123def456",
  created_at: "2026-08-23T00:00:00.000Z",
};

const RELATIONSHIP = {
  workspaceId: WS,
  workspaceSegment: "ada-grace-abc123def456",
  channelId: "44444444-4444-4444-8444-444444444444",
  peer: {
    userId: CREATOR,
    displayName: "Ada",
    email: "ada@x.dev",
    avatarUrl: null,
  },
  connectedAt: "2026-08-23T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.findLinkByToken.mockResolvedValue(linkRow());
  mocked.findPairContainer.mockResolvedValue(null);
  mocked.consumeLinkUse.mockResolvedValue(true);
  mocked.insertLinkContainer.mockResolvedValue(CONTAINER);
  mocked.insertClaim.mockResolvedValue(true);
  mockHydrate.mockResolvedValue([RELATIONSHIP]);
  mockProfiles.mockResolvedValue(
    new Map([
      [CREATOR, { email: "ada@x.dev", displayName: "Ada", avatarUrl: null }],
      [CLAIMER, { email: "grace@x.dev", displayName: "Grace", avatarUrl: null }],
    ])
  );
});

describe("mintLink", () => {
  it("mints an unguessable url-safe token the caller never has to see", async () => {
    mocked.insertLink.mockImplementation(async (args) =>
      linkRow({ token: args.token, label: args.label })
    );

    const result = await mintLink(CREATOR, { label: "bio", maxUses: 1 });

    const [args] = mocked.insertLink.mock.calls[0];
    expect(args.creatorUserId).toBe(CREATOR);
    expect(args.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(args.expiresAt).toBeNull();
    expect(result.link.url).toContain(`/link/${args.token}`);
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

  it("a same-account race that lost the use gets its relationship, not a 410", async () => {
    // ⚠ Two tabs of ONE account open a single-use link together: both clear the
    // dedup, one wins the use and mints, the other reads exhausted. The loser is
    // staring at a relationship that now exists — 410 would refuse the claimer
    // their own successful claim.
    mocked.consumeLinkUse.mockResolvedValue(false);
    mocked.findPairContainer.mockResolvedValueOnce(null).mockResolvedValue(CONTAINER);

    const result = await claimLink("tok_abc", CLAIMER);

    expect(result).toEqual({ relationship: RELATIONSHIP, existing: true });
    expect(mocked.findPairContainer).toHaveBeenCalledTimes(2);
    expect(mocked.insertLinkContainer).not.toHaveBeenCalled();
  });
});

describe("claimLink — the happy paths", () => {
  it("returns the existing container and spends NO use when the pair is already connected", async () => {
    mocked.findPairContainer.mockResolvedValue(CONTAINER);

    const result = await claimLink("tok_abc", CLAIMER);

    expect(result).toEqual({ relationship: RELATIONSHIP, existing: true });
    expect(mocked.consumeLinkUse).not.toHaveBeenCalled();
    expect(mocked.insertLinkContainer).not.toHaveBeenCalled();
    expect(mocked.findPairContainer).toHaveBeenCalledWith(CREATOR, CLAIMER);
  });

  it("mints the container, opens the direct channel through the channels service, records the claim", async () => {
    const result = await claimLink("tok_abc", CLAIMER);

    expect(result).toEqual({ relationship: RELATIONSHIP, existing: false });
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
    // ⚠ A container with no channel is a BRICK: `hydrateRelationships` drops it
    // so neither side sees it, while `findPairContainer` still finds it — every
    // later claim between this pair would dedup onto a relationship that can
    // never render.
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
    expect(mockHydrate).toHaveBeenLastCalledWith([winner], CLAIMER);
  });
});
