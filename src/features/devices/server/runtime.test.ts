import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const store = vi.hoisted(() => ({
  findByInstall: vi.fn(),
}));
vi.mock("./desktop-devices-repository", () => ({ desktopDeviceRepository: store }));

import { mintingDeviceId, requestInstallId } from "./runtime";

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
    expect(await mintingDeviceId(req({ "X-Dopl-Device": INSTALL }), "user-1")).toBe("dev-1");
    expect(store.findByInstall).toHaveBeenCalledWith("user-1", INSTALL);
  });

  it("never fails a mint: no header, a removed computer or a store error all mint unlinked", async () => {
    expect(await mintingDeviceId(req(), "user-1")).toBeNull();
    store.findByInstall.mockResolvedValueOnce({ id: "dev-1", revoked_at: "2026-09-28T00:00:00Z" });
    expect(await mintingDeviceId(req({ "X-Dopl-Device": INSTALL }), "user-1")).toBeNull();
    store.findByInstall.mockRejectedValueOnce(new Error("relation desktop_devices does not exist"));
    expect(await mintingDeviceId(req({ "X-Dopl-Device": INSTALL }), "user-1")).toBeNull();
  });
});
