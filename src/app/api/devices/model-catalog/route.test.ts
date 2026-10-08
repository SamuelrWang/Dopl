/**
 * `POST /api/devices/model-catalog`: session-only, and the computer is the CALLER's registered one
 * resolved from `X-Dopl-Device`, never a body field (2026-10-08).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  opts: [] as unknown[],
  requestComputer: vi.fn(),
  upsertCatalog: vi.fn(),
}));

vi.mock("@/shared/auth/with-auth", () => ({
  withUserAuth: (handler: (req: NextRequest, ctx: { userId: string }) => Promise<Response>, opts: unknown) => {
    h.opts.push(opts);
    return async (req: NextRequest) => handler(req, { userId: "user-1" });
  },
}));
vi.mock("@/features/devices/server/desktop-devices-repository", () => ({ desktopDeviceRepository: {} }));
vi.mock("@/features/devices/server/devices-service", () => ({
  requestComputer: h.requestComputer,
  resolveRequestDevice: vi.fn(),
}));
vi.mock("@/features/model-catalogs/server/repository", () => ({ upsertCatalog: h.upsertCatalog }));

import { POST } from "./route";

const INSTALL = "0b8f3c1e-2d4a-4f6b-9c8d-1a2b3c4d5e6f";
const BODY = { runtime: "claude", models: [{ id: "m-1", label: "M 1" }], deviceId: "someone-elses" };
const req = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/devices/model-catalog", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(BODY),
  });

beforeEach(() => {
  h.requestComputer.mockReset();
  h.upsertCatalog.mockReset();
  h.upsertCatalog.mockResolvedValue({ stored: true });
});

describe("model catalog publish route", () => {
  it("🔒 is session-only", () => {
    expect(h.opts).toContainEqual({ sessionOnly: true });
  });

  it("files the row under the caller's registered computer from the header, ignoring any body id", async () => {
    h.requestComputer.mockResolvedValue({ id: "dev-row-1" });
    const res = await POST(req({ "x-dopl-device": INSTALL }), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ stored: true });
    expect(h.requestComputer).toHaveBeenCalledWith(expect.anything(), "user-1", INSTALL);
    expect(h.upsertCatalog).toHaveBeenCalledWith("user-1", "dev-row-1", expect.objectContaining({ runtime: "claude" }));
  });

  it("🔒 no registered computer (no header, unknown, removed) stores nothing", async () => {
    h.requestComputer.mockResolvedValue(null);
    const res = await POST(req(), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ stored: false, reason: "unregistered-device" });
    expect(h.upsertCatalog).not.toHaveBeenCalled();
  });
});
