/**
 * A REMOVED computer mints nothing: both credential mints answer 403 DEVICE_REMOVED when the
 * caller's X-Dopl-Device names a removed row, and link the new row to an active one.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  device: null as unknown,
  issueDeviceToken: vi.fn(async () => ({ token: "t", expiresAt: "x", tokenId: "tok-1" })),
  issueContainerToken: vi.fn(async () => ({ token: "t", tokenId: "tok-2", expiresAt: "x" })),
}));

const ctx = { userId: "user-1", workspaceId: "ws-1", credentialSubjectUserId: "user-1" };
vi.mock("@/shared/auth/with-auth", () => ({
  withUserAuth: (handler: (r: NextRequest, c: typeof ctx) => Promise<Response>) => (r: NextRequest) =>
    handler(r, ctx),
}));
vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth: (handler: (r: NextRequest, c: typeof ctx) => Promise<Response>) => (r: NextRequest) =>
    handler(r, ctx),
}));
vi.mock("@/shared/auth/mcp-oauth", () => ({
  issueDeviceToken: h.issueDeviceToken,
  revokeDeviceTokens: vi.fn(),
}));
vi.mock("@/shared/auth/mcp-container-token", () => ({
  issueContainerToken: h.issueContainerToken,
  revokeContainerTokens: vi.fn(),
}));
vi.mock("@/features/devices/server/runtime", async () => {
  const { HttpError } = await import("@/shared/lib/http-error");
  return {
    mintingDevice: async () => h.device,
    deviceRemovedError: () => new HttpError(403, "DEVICE_REMOVED", "removed"),
  };
});

import { POST as mintDevice } from "./mcp-device-token/route";
import { POST as mintContainer } from "./mcp-container-token/route";

const post = (path: string) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", body: "{}" });

beforeEach(() => {
  h.issueDeviceToken.mockClear();
  h.issueContainerToken.mockClear();
});

describe("mints from a removed computer", () => {
  it("refuses both mints with 403 DEVICE_REMOVED", async () => {
    h.device = { removed: true };
    for (const [route, path] of [
      [mintDevice, "/api/auth/mcp-device-token"],
      [mintContainer, "/api/auth/mcp-container-token"],
    ] as const) {
      const res = await route(post(path), { params: Promise.resolve({}) });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("DEVICE_REMOVED");
    }
    expect(h.issueDeviceToken).not.toHaveBeenCalled();
    expect(h.issueContainerToken).not.toHaveBeenCalled();
  });

  it("links both mints to an active computer and returns the device token's id", async () => {
    h.device = { deviceId: "dev-1" };
    const res = await mintDevice(post("/api/auth/mcp-device-token"), { params: Promise.resolve({}) });
    expect((await res.json()).tokenId).toBe("tok-1");
    expect(h.issueDeviceToken).toHaveBeenCalledWith(expect.objectContaining({ deviceId: "dev-1" }));
    await mintContainer(post("/api/auth/mcp-container-token"), { params: Promise.resolve({}) });
    expect(h.issueContainerToken).toHaveBeenCalledWith(expect.objectContaining({ deviceId: "dev-1" }));
  });
});
