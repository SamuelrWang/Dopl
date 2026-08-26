/**
 * `service-reads.ts` — the four things a renderer would otherwise have to
 * trust: the channels payload shape (name, peer-or-null, segment, channel,
 * truncated preview, the bound link riding as `linkOut`), which containers are
 * DROPPED, the pending-link filter, and the PRE-AUTH claim-page payload, whose
 * whole contract is what it does NOT carry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpError } from "@/shared/lib/http-error";

vi.mock("./repository", () => ({
  findMemberContainer: vi.fn(),
  listLinkContainers: vi.fn(),
  listLinksByCreator: vi.fn(),
  listLinksByWorkspaces: vi.fn(),
  listContainerPeers: vi.fn(),
  listContainerChannels: vi.fn(),
  listLastMessages: vi.fn(),
  findLinkByToken: vi.fn(),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  listProfileSummaries: vi.fn(),
}));

import {
  getHomeChannel,
  getHomeChannels,
  getLinkPublicInfo,
  listMyPendingLinks,
} from "./service-reads";
import { PREVIEW_CHARS } from "@/shared/lib/preview";
import * as repo from "./repository";
import type { ChannelLinkRow } from "./dto";
import { listProfileSummaries } from "@/features/workspaces/server/repository";

const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const WS = "33333333-3333-4333-8333-333333333333";
const CHANNEL = "44444444-4444-4444-8444-444444444444";

const mocked = vi.mocked(repo);
const mockProfiles = vi.mocked(listProfileSummaries);

function linkRow(patch: Partial<ChannelLinkRow> = {}): ChannelLinkRow {
  return {
    id: "link-1",
    creator_user_id: ME,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocked.findMemberContainer.mockResolvedValue(null);
  mocked.listLinkContainers.mockResolvedValue([]);
  mocked.listLinksByCreator.mockResolvedValue([]);
  mocked.listLinksByWorkspaces.mockResolvedValue(new Map());
  mocked.listContainerPeers.mockResolvedValue(new Map());
  mocked.listContainerChannels.mockResolvedValue(new Map());
  mocked.listLastMessages.mockResolvedValue(new Map());
  mocked.findLinkByToken.mockResolvedValue(null);
  mockProfiles.mockResolvedValue(new Map());
});

const CONTAINER = {
  id: WS,
  slug: "ada-grace",
  public_id: "abc123def456",
  created_at: "2026-08-20T00:00:00.000Z",
};

describe("getHomeChannels", () => {
  beforeEach(() => {
    mocked.listLinkContainers.mockResolvedValue([CONTAINER]);
    mocked.listContainerPeers.mockResolvedValue(new Map([[WS, PEER]]));
    mocked.listContainerChannels.mockResolvedValue(
      new Map([[WS, { id: CHANNEL, name: "Ada & Grace" }]])
    );
    mockProfiles.mockResolvedValue(
      new Map([
        [
          PEER,
          {
            email: "grace@x.dev",
            displayName: "Grace",
            avatarUrl: "https://x.dev/g.png",
          },
        ],
      ])
    );
  });

  it("is keyed `channels`, and addresses the container the way the channels client APIs do", async () => {
    const payload = await getHomeChannels(ME);
    expect(Object.keys(payload).sort()).toEqual(["channels", "pendingLinks"]);
    expect(payload.channels).toEqual([
      {
        workspaceId: WS,
        workspaceSegment: "ada-grace-abc123def456",
        channelId: CHANNEL,
        name: "Ada & Grace",
        peer: {
          userId: PEER,
          displayName: "Grace",
          email: "grace@x.dev",
          avatarUrl: "https://x.dev/g.png",
        },
        createdAt: "2026-08-20T00:00:00.000Z",
        lastMessageAt: null,
        lastMessagePreview: null,
        linkOut: null,
      },
    ]);
  });

  it("RENDERS a solo channel with peer: null — a channel with nobody in it is finished, not broken", async () => {
    mocked.listContainerPeers.mockResolvedValue(new Map());
    mocked.listContainerChannels.mockResolvedValue(
      new Map([[WS, { id: CHANNEL, name: "Fundraise" }]])
    );

    const [row] = (await getHomeChannels(ME)).channels;

    expect(row.peer).toBeNull();
    // ⚠ The NAME is what the row has to render itself with when there is no
    // person to name it after.
    expect(row.name).toBe("Fundraise");
  });

  it("still DROPS a container with no channel — there is nothing to open", async () => {
    mocked.listContainerChannels.mockResolvedValue(new Map());
    expect((await getHomeChannels(ME)).channels).toEqual([]);
  });

  it("rides the open BOUND link on its own channel as `linkOut`, never as a row", async () => {
    mocked.listLinksByWorkspaces.mockResolvedValue(
      new Map([[WS, linkRow({ id: "bound-1", workspace_id: WS, max_uses: 1 })]])
    );

    const payload = await getHomeChannels(ME);

    expect(payload.channels[0].linkOut?.id).toBe("bound-1");
    expect(payload.channels[0].linkOut?.url).toMatch(/\/link\/tok_abc$/);
    // The chip is the ONLY place it appears — a second row would show one
    // invitation twice.
    expect(payload.pendingLinks).toEqual([]);
  });

  it("shows no chip for a bound link the claim gate would 410", async () => {
    mocked.listLinksByWorkspaces.mockResolvedValue(
      new Map([
        [WS, linkRow({ workspace_id: WS, max_uses: 1, use_count: 1 })],
      ])
    );
    expect((await getHomeChannels(ME)).channels[0].linkOut).toBeNull();
  });

  it("folds the chip read into the EXISTING fan — no extra round-trip tier", async () => {
    await getHomeChannels(ME);
    // Same tier as peers + channels: all three see the same container ids.
    expect(mocked.listLinksByWorkspaces).toHaveBeenCalledWith([WS], 200);
    expect(mocked.listContainerPeers).toHaveBeenCalledWith([WS], ME);
    expect(mocked.listContainerChannels).toHaveBeenCalledWith([WS]);
  });

  it("truncates the preview server-side and collapses whitespace", async () => {
    mocked.listLastMessages.mockResolvedValue(
      new Map([
        [
          CHANNEL,
          { at: "2026-08-22T10:00:00.000Z", body: `${"x".repeat(400)}\n\n  y` },
        ],
      ])
    );
    const [row] = (await getHomeChannels(ME)).channels;
    expect(row.lastMessagePreview).toHaveLength(PREVIEW_CHARS);
    expect(row.lastMessagePreview?.endsWith("…")).toBe(true);
    expect(row.lastMessageAt).toBe("2026-08-22T10:00:00.000Z");
  });
});

describe("getHomeChannel", () => {
  beforeEach(() => {
    mocked.listContainerPeers.mockResolvedValue(new Map([[WS, PEER]]));
    mocked.listContainerChannels.mockResolvedValue(
      new Map([[WS, { id: CHANNEL, name: "Ada & Grace" }]])
    );
  });

  it("hands a MEMBER of a link container the same shape the page reads", async () => {
    mocked.findMemberContainer.mockResolvedValue(CONTAINER);

    const channel = await getHomeChannel(ME, WS);

    expect(channel).toMatchObject({
      workspaceId: WS,
      workspaceSegment: "ada-grace-abc123def456",
      channelId: CHANNEL,
      name: "Ada & Grace",
    });
    // The fence takes the container id and the CALLER — never a slug, never a
    // list scan, so it cannot 404 a channel that sits past `HOME_CHANNEL_LIMIT`.
    expect(mocked.findMemberContainer).toHaveBeenCalledWith(WS, ME);
    expect(mocked.listLinkContainers).not.toHaveBeenCalled();
  });

  it("answers NULL for a non-member — absent, never forbidden", async () => {
    mocked.findMemberContainer.mockResolvedValue(null);
    expect(await getHomeChannel(ME, WS)).toBeNull();
  });

  it("answers the SAME null for a STANDARD workspace the caller belongs to", async () => {
    // ⚠ The two cases must be indistinguishable from outside: the guest route
    // renders `notFound()` for both, so a container id is not an existence
    // oracle and a standard workspace gets no second, chrome-less door.
    mocked.findMemberContainer.mockResolvedValue(null);
    expect(await getHomeChannel(ME, "44444444-4444-4444-8444-444444444abc")).toBeNull();
    // Nothing was hydrated — the fence is the first read, not a post-filter.
    expect(mocked.listContainerChannels).not.toHaveBeenCalled();
  });
});

describe("listMyPendingLinks", () => {
  it("keeps only links that can still be claimed", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    mocked.listLinksByCreator.mockResolvedValue([
      linkRow({ id: "live" }),
      linkRow({ id: "live-dated", expires_at: future }),
      linkRow({ id: "expired", expires_at: past }),
      linkRow({ id: "exhausted", max_uses: 1, use_count: 1 }),
      linkRow({ id: "revoked", revoked_at: past }),
    ]);
    const links = await listMyPendingLinks(ME);
    expect(links.map((l) => l.id)).toEqual(["live", "live-dated"]);
  });

  it("returns the claim URL rather than the raw token", async () => {
    mocked.listLinksByCreator.mockResolvedValue([linkRow()]);
    const [link] = await listMyPendingLinks(ME);
    expect(link.url).toMatch(/\/link\/tok_abc$/);
    expect(Object.keys(link)).not.toContain("token");
  });
});

describe("getLinkPublicInfo", () => {
  it("404s an unknown token, so the endpoint is not an existence oracle", async () => {
    await expect(getLinkPublicInfo("nope")).rejects.toMatchObject({
      status: 404,
      code: "LINK_NOT_FOUND",
    });
    await expect(getLinkPublicInfo("nope")).rejects.toBeInstanceOf(HttpError);
  });

  it("carries a display name and three booleans — and NOTHING else", async () => {
    mocked.findLinkByToken.mockResolvedValue(linkRow());
    mockProfiles.mockResolvedValue(
      new Map([
        [ME, { email: "ada@x.dev", displayName: "Ada", avatarUrl: "a.png" }],
      ])
    );

    const info = await getLinkPublicInfo("tok_abc");

    expect(info).toEqual({
      creatorDisplayName: "Ada",
      revoked: false,
      expired: false,
      exhausted: false,
    });
    // ⚠ The whole contract of this payload is the OMISSIONS — an unauthenticated
    // URL holder must not harvest an email or a user id per token.
    const serialized = JSON.stringify(info);
    expect(serialized).not.toContain("ada@x.dev");
    expect(serialized).not.toContain(ME);
    expect(serialized).not.toContain("a.png");
  });

  it("does NOT leak the channel a BOUND token names", async () => {
    // ⚠ The holder of the URL has no account yet. The name of a private channel
    // is not a fact a URL should hand out — so the payload did not grow one
    // when links became bound.
    mocked.findLinkByToken.mockResolvedValue(
      linkRow({ workspace_id: WS, max_uses: 1 })
    );
    const info = await getLinkPublicInfo("tok_abc");
    expect(Object.keys(info).sort()).toEqual([
      "creatorDisplayName",
      "exhausted",
      "expired",
      "revoked",
    ]);
    expect(JSON.stringify(info)).not.toContain(WS);
  });

  it("does NOT fall back to the email when the creator has no display name", async () => {
    mocked.findLinkByToken.mockResolvedValue(linkRow());
    mockProfiles.mockResolvedValue(
      new Map([[ME, { email: "ada@x.dev", displayName: null, avatarUrl: null }]])
    );
    expect((await getLinkPublicInfo("tok_abc")).creatorDisplayName).toBeNull();
  });

  it("reports each way a link can be over", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    mocked.findLinkByToken.mockResolvedValue(
      linkRow({ revoked_at: past, expires_at: past, max_uses: 2, use_count: 2 })
    );
    expect(await getLinkPublicInfo("tok_abc")).toMatchObject({
      revoked: true,
      expired: true,
      exhausted: true,
    });
  });
});
