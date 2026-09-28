/**
 * The devices + agent-app routes: wrapper options (all `sessionOnly`), wire shapes, and the
 * X-Dopl-Device header reaching the service. Stores are in-memory; the wrapper is a pass-through
 * that records its options.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  opts: [] as unknown[],
  listComputers: vi.fn(),
  removeComputer: vi.fn(),
  heartbeat: vi.fn(),
  listAgentApps: vi.fn(),
  disconnectAgentApp: vi.fn(),
}));

vi.mock("@/shared/auth/with-auth", () => ({
  withUserAuth: (
    handler: (req: NextRequest, ctx: { userId: string; params?: Record<string, string> }) => Promise<Response>,
    opts: unknown
  ) => {
    h.opts.push(opts);
    return async (req: NextRequest, rc?: { params: Promise<Record<string, string>> }) =>
      handler(req, { userId: "user-1", params: rc ? await rc.params : undefined });
  },
}));
vi.mock("@/features/devices/server/desktop-devices-repository", () => ({ desktopDeviceRepository: {} }));
vi.mock("@/features/devices/server/agent-apps-repository", () => ({ agentAppRepository: {} }));
vi.mock("@/features/devices/server/devices-service", () => ({
  listComputers: h.listComputers,
  removeComputer: h.removeComputer,
  heartbeat: h.heartbeat,
  resolveRequestDevice: vi.fn(),
}));
vi.mock("@/features/devices/server/agent-apps", () => ({
  listAgentApps: h.listAgentApps,
  disconnectAgentApp: h.disconnectAgentApp,
}));

import { GET as listDevices } from "./route";
import { DELETE as removeDevice } from "./[deviceId]/route";
import { POST as beat } from "./heartbeat/route";
import { GET as listApps } from "../oauth/apps/route";
import { DELETE as disconnectApp } from "../oauth/apps/[key]/route";
import { HttpError } from "@/shared/lib/http-error";

const INSTALL = "0b8f3c1e-2d4a-4f6b-9c8d-1a2b3c4d5e6f";
const req = (url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  for (const fn of [h.listComputers, h.removeComputer, h.heartbeat, h.listAgentApps, h.disconnectAgentApp]) {
    fn.mockReset();
  }
});

describe("devices + agent-app routes", () => {
  it("every route is session-only", () => {
    expect(h.opts).toHaveLength(5);
    for (const o of h.opts) expect(o).toEqual({ sessionOnly: true });
  });

  it("GET /api/devices passes the caller's install id so this computer is marked", async () => {
    h.listComputers.mockResolvedValue({ devices: [] });
    const res = await listDevices(req("/api/devices", { headers: { "X-Dopl-Device": INSTALL } }), params({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ devices: [] });
    expect(h.listComputers.mock.calls[0].slice(1)).toEqual(["user-1", INSTALL]);
  });

  it("DELETE /api/devices/:id removes that computer; unknown ids 404", async () => {
    h.removeComputer.mockResolvedValueOnce({ ok: true, revokedTokens: 3 });
    const ok = await removeDevice(req("/api/devices/x", { method: "DELETE" }), params({ deviceId: "x" }));
    expect(await ok.json()).toEqual({ ok: true, revokedTokens: 3 });
    h.removeComputer.mockRejectedValueOnce(new HttpError(404, "DEVICE_NOT_FOUND", "No such device."));
    const missing = await removeDevice(req("/api/devices/y", { method: "DELETE" }), params({ deviceId: "y" }));
    expect(missing.status).toBe(404);
  });

  it("POST /api/devices/heartbeat validates the body and answers the service's verdict", async () => {
    h.heartbeat.mockResolvedValue({ device: { revoked: true } });
    const body = {
      installId: INSTALL,
      name: "Samuel's MacBook Pro",
      platform: "macos",
      status: "active",
      tokenId: "0b8f3c1e-2d4a-4f6b-9c8d-1a2b3c4d5e70",
    };
    const res = await beat(req("/api/devices/heartbeat", { method: "POST", body }), params({}));
    expect(await res.json()).toEqual({ device: { revoked: true } });
    expect(h.heartbeat.mock.calls[0][2]).toMatchObject(body);

    const bad = await beat(
      req("/api/devices/heartbeat", { method: "POST", body: { ...body, platform: "amiga" } }),
      params({})
    );
    expect(bad.status).toBe(400);
    expect(h.heartbeat).toHaveBeenCalledTimes(1);
  });

  it("GET /api/oauth/apps lists grouped apps; DELETE disconnects one, 404 when absent", async () => {
    h.listAgentApps.mockResolvedValue({ apps: [{ key: "codex", name: "Codex" }] });
    const list = await listApps(req("/api/oauth/apps"), params({}));
    expect(await list.json()).toEqual({ apps: [{ key: "codex", name: "Codex" }] });

    h.disconnectAgentApp.mockResolvedValueOnce(2);
    const ok = await disconnectApp(req("/api/oauth/apps/codex", { method: "DELETE" }), params({ key: "codex" }));
    expect(await ok.json()).toEqual({ ok: true, revoked: 2 });
    expect(h.disconnectAgentApp.mock.calls[0].slice(1, 3)).toEqual(["user-1", "codex"]);

    h.disconnectAgentApp.mockResolvedValueOnce(0);
    const none = await disconnectApp(req("/api/oauth/apps/x", { method: "DELETE" }), params({ key: "x" }));
    expect(none.status).toBe(404);
  });
});
