/**
 * `service-reads.ts` — the three things a renderer would otherwise have to
 * trust: the relationships payload shape (peer, segment, channel, truncated
 * preview), the pending-link filter, and the PRE-AUTH claim-page payload, whose
 * whole contract is what it does NOT carry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpError } from "@/shared/lib/http-error";

vi.mock("./repository", () => ({
  listLinkContainers: vi.fn(),
  listLinksByCreator: vi.fn(),
  listContainerPeers: vi.fn(),
  listContainerDirectChannels: vi.fn(),
  listLastMessages: vi.fn(),
  findLinkByToken: vi.fn(),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  listProfileSummaries: vi.fn(),
}));

import {
  getHomeRelationships,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocked.listLinkContainers.mockResolvedValue([]);
  mocked.listLinksByCreator.mockResolvedValue([]);
  mocked.listContainerPeers.mockResolvedValue(new Map());
  mocked.listContainerDirectChannels.mockResolvedValue(new Map());
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

describe("getHomeRelationships", () => {
  beforeEach(() => {
    mocked.listLinkContainers.mockResolvedValue([CONTAINER]);
    mocked.listContainerPeers.mockResolvedValue(new Map([[WS, PEER]]));
    mocked.listContainerDirectChannels.mockResolvedValue(
      new Map([[WS, CHANNEL]])
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

  it("addresses the container the way the channels client APIs do", async () => {
    const payload = await getHomeRelationships(ME);
    expect(payload.relationships).toEqual([
      {
        workspaceId: WS,
        workspaceSegment: "ada-grace-abc123def456",
        channelId: CHANNEL,
        peer: {
          userId: PEER,
          displayName: "Grace",
          email: "grace@x.dev",
          avatarUrl: "https://x.dev/g.png",
        },
        connectedAt: "2026-08-20T00:00:00.000Z",
        lastMessageAt: null,
        lastMessagePreview: null,
      },
    ]);
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
    const [row] = (await getHomeRelationships(ME)).relationships;
    expect(row.lastMessagePreview).toHaveLength(PREVIEW_CHARS);
    expect(row.lastMessagePreview?.endsWith("…")).toBe(true);
    expect(row.lastMessageAt).toBe("2026-08-22T10:00:00.000Z");
  });

  it("resolves the peer from the caller's own membership rows", async () => {
    await getHomeRelationships(ME);
    expect(mocked.listContainerPeers).toHaveBeenCalledWith([WS], ME);
  });

  it("drops a container with no peer rather than rendering half a card", async () => {
    mocked.listContainerPeers.mockResolvedValue(new Map());
    expect((await getHomeRelationships(ME)).relationships).toEqual([]);
  });

  it("drops a container with no direct channel — there is nothing to open", async () => {
    mocked.listContainerDirectChannels.mockResolvedValue(new Map());
    expect((await getHomeRelationships(ME)).relationships).toEqual([]);
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
