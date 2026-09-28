import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ requestComputer: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/devices/server/desktop-devices-repository", () => ({ desktopDeviceRepository: {} }));
vi.mock("@/features/devices/server/devices-service", async (orig) => ({
  ...(await orig<typeof import("@/features/devices/server/devices-service")>()),
  requestComputer: h.requestComputer,
}));

import { glassesMessageSource, requestMessageSource, withMessageSource } from "./message-source";
import type { ChannelContext } from "./service-shared";

const INSTALL = "0b8f3c1e-2d4a-4f6b-9c8d-1a2b3c4d5e6f";
const req = (headers: Record<string, string> = {}) => new NextRequest("http://localhost/api/x", { headers });
const row = { id: "dev-9", name: "Samuel's MacBook Pro", display_name: "Studio", platform: "macos" };

beforeEach(() => h.requestComputer.mockReset());

describe("requestMessageSource", () => {
  it("a registered computer: its id, EFFECTIVE name and platform", async () => {
    h.requestComputer.mockResolvedValue(row);
    expect(await requestMessageSource(req({ "X-Dopl-Device": INSTALL }), "u1", undefined)).toEqual({
      kind: "computer",
      device_id: "dev-9",
      label: "Studio",
      platform: "macos",
    });
    expect(h.requestComputer.mock.calls[0].slice(1)).toEqual(["u1", INSTALL]);
  });

  it("the desktop without a resolvable row is still a computer; a lookup failure never throws", async () => {
    h.requestComputer.mockResolvedValue(null);
    expect(await requestMessageSource(req(), "u1", "desktop-ui")).toEqual({ kind: "computer", label: "Computer" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.requestComputer.mockRejectedValueOnce(new Error("db down"));
    expect(await requestMessageSource(req({ "X-Dopl-Device": INSTALL }), "u1", undefined)).toEqual({ kind: "computer", label: "Computer" });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("a plain browser session is the web", async () => {
    expect(await requestMessageSource(req(), "u1", undefined)).toEqual({ kind: "web", label: "Web" });
    expect(h.requestComputer).not.toHaveBeenCalled();
  });
});

describe("withMessageSource", () => {
  const ctx = { userId: "u1", source: "user" } as ChannelContext;
  it("attaches the source to a member ctx and skips agents (no read)", async () => {
    expect((await withMessageSource(ctx, req(), false)).messageSource).toEqual({ kind: "web", label: "Web" });
    expect((await withMessageSource({ ...ctx, source: "agent" }, req())).messageSource).toBeUndefined();
    expect((await withMessageSource(ctx, req(), true)).messageSource).toBeUndefined();
  });
});

describe("glassesMessageSource", () => {
  it("labels by the device name, else the platform label", () => {
    expect(glassesMessageSource({ id: "g1", name: "My G2", platform: "even_g2" })).toEqual({
      kind: "glasses",
      device_id: "g1",
      label: "My G2",
      platform: "even_g2",
    });
    expect(glassesMessageSource({ id: "g1", name: " ", platform: "even_g2" }).label).toBe("Even G2");
  });
});
