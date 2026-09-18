/**
 * 🔒 **THE FENCE OF `GET|POST /api/channels?scope=container|account`** (Samuel's
 * ruling R-26 (b), 2026-09-17: *one endpoint*).
 *
 * ⚠ **WHAT IS PINNED HERE IS WHICH WRAPPER EACH ARM CARRIES, NOT WHAT THE SERVICE
 * ANSWERS.** The ruling collapsed two routes into one, and the only thing that may
 * differ per scope is the fence — so the thing a regression would silently change
 * is exactly this: the wrapper, its floor, and the fact that a bad `scope` reaches
 * NEITHER. The four PERSONAS the fence has to refuse (a non-member, a guest, a
 * departed member, a container the caller cannot see) are pinned one layer down,
 * in `channels/server/service-list.test.ts`, where the predicates actually live.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

/** The container arm's caller — a member of ONE named container. */
const WORKSPACE_AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
  workspaceKind: "standard",
};

/** 🔒 A CONTAINER-LOCKED credential (B1 / R3): the account arm must narrow by it,
 *  and nothing upstream of that arm enforces a lock. */
const USER_AUTH = { userId: "user-1", apiKeyWorkspaceId: "locked-ws" };

const wrappers = vi.hoisted(() => ({
  workspaceOptions: [] as unknown[],
  userWrapped: 0,
}));

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth: (
    handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>,
    options: unknown
  ) => {
    wrappers.workspaceOptions.push(options);
    return (req: Request) => handler(req, WORKSPACE_AUTH);
  },
}));

vi.mock("@/shared/auth/with-auth", () => ({
  withUserAuth: (handler: (req: Request, ctx: typeof USER_AUTH) => Promise<Response>) => {
    wrappers.userWrapped += 1;
    return (req: Request) => handler(req, USER_AUTH);
  },
}));

vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  listChannels: vi.fn(),
  listAccountChannels: vi.fn(),
  createChannel: vi.fn(),
}));

vi.mock("@/features/home/server/service-writes", () => ({
  createHomeChannel: vi.fn(),
}));

vi.mock("@/features/home/server/service-reads", () => ({
  listMyPendingLinks: vi.fn(),
}));

import { GET, POST } from "./route";
import {
  createChannel,
  listAccountChannels,
  listChannels,
} from "@/features/channels/server/service";
import { createHomeChannel } from "@/features/home/server/service-writes";
import { listMyPendingLinks } from "@/features/home/server/service-reads";

/** ⚠ The wrappers run at MODULE LOAD, so their options are recorded once for the
 *  file — resetting them per case would assert against an empty array. */
const WORKSPACE_OPTIONS = [...wrappers.workspaceOptions];

function req(query: string, body?: unknown): NextRequest {
  const url = `http://localhost/api/channels${query}`;
  return body === undefined
    ? new NextRequest(url)
    : new NextRequest(url, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listChannels).mockResolvedValue([]);
  vi.mocked(listAccountChannels).mockResolvedValue({
    channels: [],
    truncated: false,
  });
  vi.mocked(listMyPendingLinks).mockResolvedValue([]);
  vi.mocked(createChannel).mockResolvedValue({ id: "chan-1" } as never);
  vi.mocked(createHomeChannel).mockResolvedValue({
    channel: { id: "chan-1", workspaceId: "ws-9" },
  } as never);
});

describe("which wrapper each arm carries", () => {
  it("GET scope=container is withWorkspaceAuth at the GUEST floor", async () => {
    // 🔒 A guest reaches the LISTING (§4A/§2B); the real gate is the per-channel
    // membership fence in the service, and this floor is only a tripwire.
    expect(WORKSPACE_OPTIONS).toContainEqual({ minRole: "guest" });
    await GET(req("?scope=container"), { params: Promise.resolve({}) });
    expect(listChannels).toHaveBeenCalledTimes(1);
    expect(listAccountChannels).not.toHaveBeenCalled();
  });

  it("POST scope=container keeps the MEMBER floor — the arm is unchanged", async () => {
    expect(WORKSPACE_OPTIONS).toContainEqual({ minRole: "member" });
    await POST(req("?scope=container", { name: "General" }), {
      params: Promise.resolve({}),
    });
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(createHomeChannel).not.toHaveBeenCalled();
  });

  it("BOTH account arms are withUserAuth — the fence is the USER", () => {
    // ⚠ `withWorkspaceAuth` would 400 `WORKSPACE_REQUIRED` at a caller with 2+
    // standard memberships, which is precisely the caller this scope exists for.
    expect(wrappers.userWrapped).toBe(2);
  });

  it("an ABSENT scope is the CONTAINER arm — every existing caller means that", async () => {
    await GET(req(""), { params: Promise.resolve({}) });
    expect(listChannels).toHaveBeenCalledTimes(1);
    expect(listAccountChannels).not.toHaveBeenCalled();
  });

  it("an UNRECOGNISED scope is 400 and reaches NEITHER arm", async () => {
    const res = await GET(req("?scope=everything"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(400);
    expect(listChannels).not.toHaveBeenCalled();
    expect(listAccountChannels).not.toHaveBeenCalled();
  });
});

describe("the account arm's own narrowing", () => {
  it("🔒 applies the credential's container LOCK (B1 / R3)", async () => {
    // Nothing upstream enforces it: this arm does not use `withWorkspaceAuth`,
    // which is what 403s a locked credential everywhere else.
    await GET(req("?scope=account"), { params: Promise.resolve({}) });
    expect(listAccountChannels).toHaveBeenCalledWith("user-1", "locked-ws");
  });

  it("answers `pendingLinks` and `truncated`; the container arm answers NEITHER key", async () => {
    vi.mocked(listAccountChannels).mockResolvedValue({
      channels: [],
      truncated: true,
    });
    const account = await GET(req("?scope=account"), {
      params: Promise.resolve({}),
    });
    expect(await account.json()).toEqual({
      channels: [],
      pendingLinks: [],
      truncated: true,
    });
    // ⚠ ABSENT, NEVER `[]`/`false` — an absent param yields an absent key (§9's
    // `channelGrants` precedent); `[]` would assert "asked, none open".
    const container = await GET(req("?scope=container"), {
      params: Promise.resolve({}),
    });
    expect(await container.json()).toEqual({ channels: [] });
  });

  it("is never cached — per-caller and volatile by construction", async () => {
    const res = await GET(req("?scope=account"), {
      params: Promise.resolve({}),
    });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("POST scope=account mints the container, not a channel in one", async () => {
    await POST(req("?scope=account", { name: "Ada & Grace" }), {
      params: Promise.resolve({}),
    });
    expect(createHomeChannel).toHaveBeenCalledTimes(1);
    expect(createChannel).not.toHaveBeenCalled();
  });
});
