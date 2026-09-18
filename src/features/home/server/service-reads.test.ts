/**
 * `service-reads.ts` — what is LEFT of the home read side: the guest route's
 * one-container fence, the pending-link filter, and the PRE-AUTH claim-page
 * payload whose whole contract is what it does NOT carry.
 *
 * 🔒 **THE CHANNEL-LIST CASES MOVED TO `channels/server/service-list.test.ts` IN
 * WAVE 3 (R-26).** Peers, `linkOut`, the dropped container, the unread marks and
 * the mention badge are properties of the ONE projection now, and asserting them
 * from here would be the second suite over one behaviour that the second
 * projection itself was.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpError } from "@/shared/lib/http-error";

vi.mock("./repository", () => ({
  findMemberContainer: vi.fn(),
  listLinkContainers: vi.fn(),
  listLinksByCreator: vi.fn(),
  listContainerChannels: vi.fn(),
  findLinkByToken: vi.fn(),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  listProfileSummaries: vi.fn(),
}));
// ⚠ THE HYDRATOR IS THE CHANNELS FEATURE'S NOW — one row projection, so this
// suite stubs the seam rather than re-asserting what the projection answers.
vi.mock("@/features/channels/server/service", () => ({
  hydrateChannelById: vi.fn(),
}));

import {
  getHomeChannel,
  getLinkPublicInfo,
  listMyPendingLinks,
} from "./service-reads";
import * as repo from "./repository";
import type { ChannelLinkRow } from "./dto";
import { hydrateChannelById } from "@/features/channels/server/service";
import { listProfileSummaries } from "@/features/workspaces/server/repository";

const ME = "11111111-1111-4111-8111-111111111111";
const WS = "33333333-3333-4333-8333-333333333333";
const CHANNEL = "44444444-4444-4444-8444-444444444444";

const mocked = vi.mocked(repo);
const mockProfiles = vi.mocked(listProfileSummaries);
const mockHydrate = vi.mocked(hydrateChannelById);

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
  mocked.listContainerChannels.mockResolvedValue(new Map());
  mocked.findLinkByToken.mockResolvedValue(null);
  mockProfiles.mockResolvedValue(new Map());
  mockHydrate.mockResolvedValue(null);
});

const CONTAINER = {
  id: WS,
  slug: "ada-grace",
  public_id: "abc123def456",
  created_at: "2026-08-20T00:00:00.000Z",
};

describe("getHomeChannel", () => {
  beforeEach(() => {
    mocked.listContainerChannels.mockResolvedValue(
      new Map([[WS, { id: CHANNEL, name: "Ada & Grace", topic: "" }]])
    );
  });

  it("hands a MEMBER of a link container THE ONE ROW TYPE, off the shared hydrator", async () => {
    mocked.findMemberContainer.mockResolvedValue(CONTAINER);
    mockHydrate.mockResolvedValue({
      id: CHANNEL,
      name: "Ada & Grace",
    } as unknown as Awaited<ReturnType<typeof hydrateChannelById>>);

    const channel = await getHomeChannel(ME, WS);

    expect(channel).toMatchObject({ id: CHANNEL, name: "Ada & Grace" });
    // 🔒 ONE PROJECTION — the guest route gets the same `Channel` the list does,
    // built by the channels feature and never re-shaped here.
    expect(mockHydrate).toHaveBeenCalledWith(WS, CHANNEL, ME);
    // The fence takes the container id and the CALLER — never a slug, never a
    // list scan, so it cannot 404 a channel that sits past a list ceiling.
    expect(mocked.findMemberContainer).toHaveBeenCalledWith(WS, ME);
    expect(mocked.listLinkContainers).not.toHaveBeenCalled();
  });

  it("500s a container with no channel — the state the rollbacks exist to prevent", async () => {
    mocked.findMemberContainer.mockResolvedValue(CONTAINER);
    mocked.listContainerChannels.mockResolvedValue(new Map());
    await expect(getHomeChannel(ME, WS)).rejects.toMatchObject({ status: 500 });
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
