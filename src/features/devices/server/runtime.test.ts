import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const store = vi.hoisted(() => ({
  findByInstall: vi.fn(),
}));
vi.mock("./desktop-devices-repository", () => ({ desktopDeviceRepository: store }));

import { mintingDevice, requestInstallId, requestSessionId } from "./runtime";

const INSTALL = "0b8f3c1e-2d4a-4f6b-9c8d-1a2b3c4d5e6f";
const req = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/auth/mcp-device-token", { method: "POST", headers });

describe("minting device resolution", () => {
  it("reads the desktop's install id header", () => {
    expect(requestInstallId(req({ "X-Dopl-Device": ` ${INSTALL} ` }))).toBe(INSTALL);
    expect(requestInstallId(req())).toBeNull();
  });

  it("links a mint to the caller's active computer", async () => {
    store.findByInstall.mockResolvedValueOnce({ id: "dev-1", revoked_at: null });
    expect(await mintingDevice(req({ "X-Dopl-Device": INSTALL }), "user-1")).toEqual({ deviceId: "dev-1" });
    expect(store.findByInstall).toHaveBeenCalledWith("user-1", INSTALL);
  });

  it("says a removed computer is removed; no header or a store error mints unlinked", async () => {
    expect(await mintingDevice(req(), "user-1")).toBeNull();
    store.findByInstall.mockResolvedValueOnce({ id: "dev-1", revoked_at: "2026-09-28T00:00:00Z" });
    expect(await mintingDevice(req({ "X-Dopl-Device": INSTALL }), "user-1")).toEqual({ removed: true });
    store.findByInstall.mockRejectedValueOnce(new Error("relation desktop_devices does not exist"));
    expect(await mintingDevice(req({ "X-Dopl-Device": INSTALL }), "user-1")).toBeNull();
  });

  it("reads the session id off a bearer JWT, only for the authenticated user", async () => {
    const SESSION = "5e5510a0-0000-4000-8000-000000000001";
    const jwt = (claims: object) =>
      `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
    const bearer = (claims: object) => req({ Authorization: `Bearer ${jwt(claims)}` });
    expect(await requestSessionId(bearer({ sub: "user-1", session_id: SESSION }), "user-1")).toBe(SESSION);
    expect(await requestSessionId(bearer({ sub: "user-2", session_id: SESSION }), "user-1")).toBeNull();
    expect(await requestSessionId(bearer({ sub: "user-1", session_id: "x" }), "user-1")).toBeNull();
  });
});
