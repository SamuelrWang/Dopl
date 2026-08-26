/**
 * `service-claim-bound.ts` — ONE case per ordered step, because the order IS the
 * correctness argument and every reordering is a different bug:
 *
 *  1. self-claim 400
 *  2. already a member → `existing: true`, and NOTHING is spent
 *  3. full container → 409, and NOTHING is spent
 *  4. the use guard's `false` → re-read MEMBERSHIP, converge or 410
 *  5. the trigger's RAISE → the same 409 the service check gives
 *  6. the channel add fails → the MEMBER ROW is compensated, the CONTAINER is not
 *  7. the claim-row loser → converges, and again does NOT delete the container
 *  8. success revokes the link, so the chip clears and the seat is visibly taken
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository", () => ({
  findMemberContainer: vi.fn(),
  countActiveContainerMembers: vi.fn(),
  consumeLinkUse: vi.fn(),
  insertContainerMember: vi.fn(),
  deleteContainerMember: vi.fn(),
  listContainerChannels: vi.fn(),
  insertClaim: vi.fn(),
  markLinkRevoked: vi.fn(),
}));
vi.mock("./service-reads", () => ({ hydrateOneChannel: vi.fn() }));
vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: vi.fn((auth) => auth),
  addMember: vi.fn(),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  deleteWorkspace: vi.fn(),
  findWorkspaceById: vi.fn(),
}));

import { claimBoundLink } from "./service-claim-bound";
import * as repo from "./repository";
import type { ChannelLinkRow } from "./dto";
import { hydrateOneChannel } from "./service-reads";
import { addMember } from "@/features/channels/server/service";
import {
  deleteWorkspace,
  findWorkspaceById,
} from "@/features/workspaces/server/repository";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CLAIMER = "22222222-2222-4222-8222-222222222222";
const WS = "33333333-3333-4333-8333-333333333333";
const CHANNEL_ID = "44444444-4444-4444-8444-444444444444";

const mocked = vi.mocked(repo);
const mockHydrate = vi.mocked(hydrateOneChannel);
const mockAddMember = vi.mocked(addMember);
const mockFindWorkspace = vi.mocked(findWorkspaceById);

const CONTAINER = {
  id: WS,
  slug: "q3-fundraise",
  public_id: "abc123def456",
  created_at: "2026-08-24T00:00:00.000Z",
};

const CHANNEL = {
  workspaceId: WS,
  workspaceSegment: "q3-fundraise-abc123def456",
  channelId: CHANNEL_ID,
  name: "Q3 Fundraise",
  peer: null,
  createdAt: "2026-08-24T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  linkOut: null,
};

/** A BOUND link: `workspace_id` set, single-use, minted by the owner. */
function boundLink(patch: Partial<ChannelLinkRow> = {}): ChannelLinkRow {
  return {
    id: "link-1",
    creator_user_id: OWNER,
    workspace_id: WS,
    token: "tok_abc",
    label: null,
    expires_at: null,
    max_uses: 1,
    use_count: 0,
    revoked_at: null,
    created_at: "2026-08-24T00:00:00.000Z",
    ...patch,
  };
}

/** The container's workspace row — `ownerId` is what every write below acts as. */
function workspaceRow() {
  return {
    id: WS,
    ownerId: OWNER,
    name: "Q3 Fundraise",
    slug: "q3-fundraise",
    publicId: "abc123def456",
    description: null,
    iconUrl: null,
    kind: "link" as const,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // ⚠ NULL ONCE, THEN THE CONTAINER — the shape every successful claim sees:
  // step 2 asks before joining (not a member), the final read-back asks after
  // (a member). Cases that need a different shape reset it explicitly.
  mocked.findMemberContainer.mockResolvedValueOnce(null).mockResolvedValue(CONTAINER);
  mocked.countActiveContainerMembers.mockResolvedValue(1);
  mocked.consumeLinkUse.mockResolvedValue(true);
  mocked.insertContainerMember.mockResolvedValue(undefined);
  mocked.deleteContainerMember.mockResolvedValue(undefined);
  mocked.listContainerChannels.mockResolvedValue(
    new Map([[WS, { id: CHANNEL_ID, name: "Q3 Fundraise" }]])
  );
  mocked.insertClaim.mockResolvedValue(true);
  mocked.markLinkRevoked.mockResolvedValue(true);
  mockFindWorkspace.mockResolvedValue(workspaceRow());
  mockHydrate.mockResolvedValue(CHANNEL);
});

describe("1 — self-claim", () => {
  it("400s the creator on their own link, and spends nothing", async () => {
    // Same status as the unbound branch, different sentence: there is no self-DM
    // to refuse here — the creator is simply already in this container.
    await expect(claimBoundLink(boundLink(), OWNER)).rejects.toMatchObject({
      status: 400,
      code: "LINK_SELF_CLAIM",
    });
    expect(mocked.consumeLinkUse).not.toHaveBeenCalled();
    expect(mocked.insertContainerMember).not.toHaveBeenCalled();
  });
});

describe("2 — dedup on MEMBERSHIP, before anything is spent", () => {
  it("returns the channel with existing:true and burns NO use", async () => {
    mocked.findMemberContainer.mockReset();
    mocked.findMemberContainer.mockResolvedValue(CONTAINER);

    const result = await claimBoundLink(boundLink(), CLAIMER);

    expect(result).toEqual({ channel: CHANNEL, existing: true, bound: true });
    expect(mocked.consumeLinkUse).not.toHaveBeenCalled();
    expect(mocked.countActiveContainerMembers).not.toHaveBeenCalled();
    expect(mocked.insertContainerMember).not.toHaveBeenCalled();
  });

  it("fences on the CONTAINER the link names, not on any container", async () => {
    mocked.findMemberContainer.mockReset();
    mocked.findMemberContainer.mockResolvedValue(CONTAINER);
    await claimBoundLink(boundLink(), CLAIMER);
    expect(mocked.findMemberContainer).toHaveBeenCalledWith(WS, CLAIMER);
  });
});

describe("3 — capacity, before the spend", () => {
  it("409s a FULL container without burning the single use", async () => {
    // ⚠ Burning the use to then refuse would destroy the link on a request that
    // changed nothing — the owner would have to mint another.
    mocked.countActiveContainerMembers.mockResolvedValue(2);

    await expect(claimBoundLink(boundLink(), CLAIMER)).rejects.toMatchObject({
      status: 409,
      code: "LINK_CONTAINER_FULL",
    });
    expect(mocked.consumeLinkUse).not.toHaveBeenCalled();
    expect(mocked.insertContainerMember).not.toHaveBeenCalled();
  });
});

describe("4 — the atomic use guard", () => {
  it("re-reads MEMBERSHIP (never the link row) and converges on the winner", async () => {
    // Two tabs of ONE account: both clear step 2, one wins the use and joins,
    // the other reads exhausted while already being a member.
    mocked.consumeLinkUse.mockResolvedValue(false);

    const result = await claimBoundLink(boundLink(), CLAIMER);

    expect(result).toEqual({ channel: CHANNEL, existing: true, bound: true });
    expect(mocked.findMemberContainer).toHaveBeenCalledTimes(2);
    expect(mocked.insertContainerMember).not.toHaveBeenCalled();
  });

  it("410s when the re-read finds no membership either", async () => {
    mocked.consumeLinkUse.mockResolvedValue(false);
    mocked.findMemberContainer.mockReset();
    mocked.findMemberContainer.mockResolvedValue(null);

    await expect(claimBoundLink(boundLink(), CLAIMER)).rejects.toMatchObject({
      status: 410,
      code: "LINK_UNAVAILABLE",
    });
    expect(mocked.insertContainerMember).not.toHaveBeenCalled();
  });
});

describe("5 — workspace membership", () => {
  it("stamps the CONTAINER OWNER as the inviter", async () => {
    await claimBoundLink(boundLink(), CLAIMER);
    expect(mocked.insertContainerMember).toHaveBeenCalledWith({
      workspaceId: WS,
      userId: CLAIMER,
      invitedBy: OWNER,
    });
  });

  it("maps the member-cap TRIGGER's raise to the same 409 the pre-check gives", async () => {
    // ⚠ The pre-check in step 3 is a friendlier sentence; the trigger is the
    // fence. Two concurrent claims of two different links both pass step 3 and
    // exactly one lands here.
    mocked.insertContainerMember.mockRejectedValue(
      Object.assign(new Error("LINK_CONTAINER_FULL: a home container holds at most two members"), {
        code: "23514",
      })
    );

    await expect(claimBoundLink(boundLink(), CLAIMER)).rejects.toMatchObject({
      status: 409,
      code: "LINK_CONTAINER_FULL",
    });
    expect(mockAddMember).not.toHaveBeenCalled();
  });

  it("rethrows an insert failure that is NOT the cap", async () => {
    mocked.insertContainerMember.mockRejectedValue(new Error("connection reset"));
    await expect(claimBoundLink(boundLink(), CLAIMER)).rejects.toThrow(
      "connection reset"
    );
    expect(mocked.deleteContainerMember).not.toHaveBeenCalled();
  });
});

describe("6 — channel membership, and the compensation that is NOT a rollback", () => {
  it("adds the claimer through the channels service, acting as the OWNER", async () => {
    await claimBoundLink(boundLink(), CLAIMER);
    // The claimer is not a member of anything yet, so a context built for them
    // would be refused by the channel's own gate.
    expect(mockAddMember).toHaveBeenCalledWith(
      { userId: OWNER, workspaceId: WS, role: "owner" },
      CHANNEL_ID,
      CLAIMER
    );
  });

  it("deletes the MEMBER ROW and rethrows — and never the container", async () => {
    // ⚠ THE WHOLE POINT OF THE BOUND BRANCH BEING ITS OWN MODULE. The owner's
    // transcript lives in this workspace; a stranger's failed claim must not be
    // able to delete it, which is exactly what the unbound branch's rollback
    // does to the container IT minted.
    mockAddMember.mockRejectedValue(new Error("channel service is down"));

    await expect(claimBoundLink(boundLink(), CLAIMER)).rejects.toThrow(
      "channel service is down"
    );
    expect(mocked.deleteContainerMember).toHaveBeenCalledWith(WS, CLAIMER);
    expect(deleteWorkspace).not.toHaveBeenCalled();
    expect(mocked.insertClaim).not.toHaveBeenCalled();
  });

  it("treats ChannelMemberExistsError as CONVERGED, not as a failure", async () => {
    // A retry after a partial success: the claimer is already in the channel, so
    // there is nothing to compensate and the claim proceeds.
    mockAddMember.mockRejectedValue(
      Object.assign(new Error("User is already a member of this channel"), {
        name: "ChannelMemberExistsError",
      })
    );

    const result = await claimBoundLink(boundLink(), CLAIMER);

    expect(result.bound).toBe(true);
    expect(mocked.deleteContainerMember).not.toHaveBeenCalled();
    expect(mocked.insertClaim).toHaveBeenCalled();
  });

  it("compensates when the container has no channel at all", async () => {
    mocked.listContainerChannels.mockResolvedValue(new Map());

    await expect(claimBoundLink(boundLink(), CLAIMER)).rejects.toMatchObject({
      status: 500,
      code: "CHANNEL_INCOMPLETE",
    });
    expect(mocked.deleteContainerMember).toHaveBeenCalledWith(WS, CLAIMER);
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });
});

describe("7 — the claim row converges a double claim", () => {
  it("returns the winner's channel and does NOT delete the container", async () => {
    // ⚠ The unbound loser drops the container it just minted. This loser must
    // not: the container is somebody else's and the winner already put this user
    // into it, so there is nothing to undo.
    mocked.insertClaim.mockResolvedValue(false);

    const result = await claimBoundLink(boundLink(), CLAIMER);

    expect(result).toEqual({ channel: CHANNEL, existing: true, bound: true });
    expect(deleteWorkspace).not.toHaveBeenCalled();
    expect(mocked.deleteContainerMember).not.toHaveBeenCalled();
  });

  it("409s LINK_CLAIM_RACE when the loser can find no winner at all", async () => {
    mocked.insertClaim.mockResolvedValue(false);
    mocked.findMemberContainer.mockReset();
    mocked.findMemberContainer.mockResolvedValue(null);
    await expect(claimBoundLink(boundLink(), CLAIMER)).rejects.toMatchObject({
      status: 409,
      code: "LINK_CLAIM_RACE",
    });
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });
});

describe("8 — success", () => {
  it("joins the container, revokes the link, and reports bound:true", async () => {
    const result = await claimBoundLink(boundLink(), CLAIMER);

    expect(result).toEqual({ channel: CHANNEL, existing: false, bound: true });
    // ⚠ Revoked on success: the chip reads `revoked_at IS NULL`, so an
    // exhausted-but-unrevoked link would keep rendering "invite out" over a seat
    // that is now filled — and the one-open-per-container unique index would
    // stay occupied if this member ever leaves.
    expect(mocked.markLinkRevoked).toHaveBeenCalledWith("link-1", OWNER);
  });

  it("410s when the container vanished between mint and claim", async () => {
    mockFindWorkspace.mockResolvedValue(null);
    await expect(claimBoundLink(boundLink(), CLAIMER)).rejects.toMatchObject({
      status: 410,
      code: "LINK_UNAVAILABLE",
    });
    expect(mocked.insertContainerMember).not.toHaveBeenCalled();
  });
});
