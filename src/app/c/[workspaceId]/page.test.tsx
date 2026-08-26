/**
 * `/c/{containerId}` — the guest lane's three gates, on
 * `billing/[segment]/page.test.tsx`'s pattern (`redirect()` / `notFound()` are
 * thrown control-flow markers, so the outcome of a render IS a string).
 *
 * The properties that are worth a test are all refusals:
 *   1. a signed-out visitor bounces to /login and comes back HERE, and learns
 *      nothing about the id on the way;
 *   2. a non-member, a standard workspace and a nonexistent container are one
 *      answer — `notFound()` — or the URL is an existence oracle;
 *   3. garbage in the segment never reaches the service at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import type { HomeChannel } from "@/features/home/types";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getHomeChannel: vi.fn(),
}));

vi.mock("@/shared/supabase/server", () => ({ getUser: mocks.getUser }));
vi.mock("@/features/home/server/service-reads", () => ({
  getHomeChannel: mocks.getHomeChannel,
}));
// Stubbed so the page's decisions are observable as props, with no realtime
// subscription, no query client and no browser-only surface underneath.
vi.mock("./guest-channel", () => ({ GuestChannel: () => null }));

import GuestChannelPage from "./page";

const WS = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";

const CHANNEL: HomeChannel = {
  workspaceId: WS,
  workspaceSegment: "ada-grace-abc123def456",
  channelId: "44444444-4444-4444-8444-444444444444",
  name: "Ada & Grace",
  peer: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  linkOut: null,
};

interface MountProps {
  homeChannel: HomeChannel;
  currentUserId: string;
}

async function render(workspaceId: string = WS): Promise<MountProps> {
  const element = (await GuestChannelPage({
    params: Promise.resolve({ workspaceId }),
  })) as ReactElement<MountProps>;
  return element.props;
}

/** Thrown control-flow marker (`redirect()` / `notFound()`), or "RENDERED". */
async function outcome(workspaceId: string = WS): Promise<string> {
  try {
    await render(workspaceId);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "RENDERED";
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ id: USER });
  mocks.getHomeChannel.mockResolvedValue(CHANNEL);
});

describe("the auth gate", () => {
  it("bounces a signed-out visitor to /login and back here", async () => {
    mocks.getUser.mockResolvedValue(null);
    expect(await outcome()).toBe(
      `REDIRECT:/login?redirectTo=${encodeURIComponent(`/c/${WS}`)}`
    );
  });

  it("bounces before it looks anything up — and before it judges the id", async () => {
    // ⚠ A signed-out visitor must not be able to tell a well-formed container id
    // from a malformed one: both bounce, neither 404s.
    mocks.getUser.mockResolvedValue(null);
    expect(await outcome("not-a-uuid")).toBe(
      `REDIRECT:/login?redirectTo=${encodeURIComponent("/c/not-a-uuid")}`
    );
    expect(mocks.getHomeChannel).not.toHaveBeenCalled();
  });
});

describe("what the URL is allowed to reach", () => {
  it("404s a non-member — absent, never forbidden", async () => {
    mocks.getHomeChannel.mockResolvedValue(null);
    expect(await outcome()).toBe("NOT_FOUND");
  });

  it("404s a STANDARD workspace with the SAME answer", async () => {
    // The service refuses a standard workspace the caller genuinely belongs to,
    // and it must be indistinguishable from a container that does not exist.
    mocks.getHomeChannel.mockResolvedValue(null);
    expect(await outcome("55555555-5555-4555-8555-555555555555")).toBe(
      "NOT_FOUND"
    );
  });

  it("404s a segment that is not a UUID WITHOUT calling the service", async () => {
    for (const junk of ["not-a-uuid", "../../etc", "acme-ab12cd34ef56", ""]) {
      expect(await outcome(junk)).toBe("NOT_FOUND");
    }
    expect(mocks.getHomeChannel).not.toHaveBeenCalled();
  });

  it("hands a member's container to the mount, fenced by the caller's own id", async () => {
    const props = await render();
    expect(mocks.getHomeChannel).toHaveBeenCalledWith(USER, WS);
    expect(props.homeChannel).toEqual(CHANNEL);
    expect(props.currentUserId).toBe(USER);
  });
});
