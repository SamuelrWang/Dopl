import { describe, expect, it, vi } from "vitest";
import { createDesktopAdapter } from "../../adapters/desktop";
import { createGoogleHomeAdapter, BRIDGE_ONLINE_WINDOW_MS, GOOGLE_HOME_SPEAK_MAX_CHARS } from "../../adapters/google-home";
import { capabilitiesFor, argsFor } from "../../delivery/intents";
import { route } from "../../delivery/router";
import { DOPL_KIND_PROFILES } from "../../delivery/default-profiles";
import type { Device } from "../../types";
import { createBridgeDispatcher } from "./dispatch";
import { createBridgeHandlers, TOUCH_EVERY_MS, type BridgeDevice, type BridgePort } from "./handlers";

const T0 = Date.parse("2026-10-31T10:00:00.000Z");

const device = (over: Partial<Device> = {}): Device => ({
  id: "d1",
  kind: "home_hub",
  vendor: "google",
  model: "Google Home",
  firmware: null,
  adapter_id: "google_home",
  adapter_version: "0.1.0",
  capabilities: [],
  online: true,
  last_seen_at: new Date(T0).toISOString(),
  ...over,
});

function fakePort(over: Partial<BridgeDevice> = {}) {
  const dev: BridgeDevice = { id: "d1", projectId: "p", env: "live", endUserId: "e", kind: "home_hub", lastSeen: null, ...over };
  const row = { id: "11111111-1111-4111-8111-111111111111", kind: "notify", payload: { title: "", body: "hello" }, created_at: new Date(T0).toISOString() };
  const port = {
    deviceFromTokenHash: vi.fn(async () => dev),
    touch: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    pending: vi.fn(async () => [row]),
    take: vi.fn(async () => row),
    settle: vi.fn(async () => {}),
  };
  return { port, typed: port as unknown as BridgePort, row };
}

const req = (body: unknown, token: string | null = "tok") =>
  new Request("https://x.test/api/device-bridge/poll", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });

describe("google_home adapter", () => {
  it("speaks and nothing else, and goes offline when the bridge stops", async () => {
    const adapter = createGoogleHomeAdapter({ now: () => T0 });
    expect(adapter.describe(device()).map((d) => d.capability)).toEqual(["presence.read", "present.speak"]);
    expect(adapter.transport).toBe("local_bridge");
    expect((await adapter.health(device())).online).toBe(true);
    const old = new Date(T0 - BRIDGE_ONLINE_WINDOW_MS - 1).toISOString();
    expect((await adapter.health(device({ last_seen_at: old }))).online).toBe(false);
  });

  it("a message routes to it as speech; notify is refused, as the plan warns", () => {
    const capabilities = createGoogleHomeAdapter({ now: () => T0 }).describe(device());
    const profile = DOPL_KIND_PROFILES.home_hub;
    const grant = { scopes: [{ scope: "presence.read", maxTier: "T0" }, { scope: "present.speak", maxTier: "T1" }], status: "active", expiresAt: null, revokedAt: null };
    const candidate = { device: device({ capabilities }), grant, profile } as unknown as Parameters<typeof route>[0]["candidates"][number];
    const base = { target: "d1", urgency: "normal", candidates: [candidate], lastSourceKind: null, now: T0 } as const;
    const message = route({ ...base, capabilities: capabilitiesFor("message", { text: "hi" }) });
    expect(message.ok && message.chosen[0].capability).toBe("present.speak");
    expect(argsFor("present.speak", { text: "hi" })).toEqual({ text: "hi" });
    expect(route({ ...base, capabilities: capabilitiesFor("notify", { text: "hi" }) }).ok).toBe(false);
  });
});

describe("Mac as a connected device", () => {
  // `link_desktop_device` grants presence.read only: it is connected, and SDK delivery stays refused.
  const mac = createDesktopAdapter({ now: () => T0 }).describe(device());
  const candidate = {
    device: device({ id: "mac", kind: "desktop", adapter_id: "desktop", capabilities: mac }),
    grant: { scopes: [{ scope: "presence.read", maxTier: "T0" }], status: "active", expiresAt: null, revokedAt: null },
    profile: DOPL_KIND_PROFILES.desktop,
  } as unknown as Parameters<typeof route>[0]["candidates"][number];
  const base = { urgency: "normal", candidates: [candidate], lastSourceKind: null, now: T0, capabilities: capabilitiesFor("notify", { text: "hi" }) } as const;

  it("is refused by id and never chosen by auto", () => {
    const byId = route({ ...base, target: "mac" });
    expect(byId.ok).toBe(false);
    expect(!byId.ok && byId.code).toBe("grant_missing");
    expect(route({ ...base, target: "auto" }).ok).toBe(false);
  });
});

describe("bridge dispatcher", () => {
  const store = { insert: vi.fn(async () => ({ id: "m1" })) };
  const dispatch = createBridgeDispatcher({ store: store as never, now: () => T0 });

  it("queues one row and links the action to it", async () => {
    const res = await dispatch(device(), "present.speak", { text: " hello " });
    expect(res).toEqual({ status: "queued", result: { lens_message_id: "m1" }, error: null });
    expect(store.insert).toHaveBeenCalledWith("d1", expect.objectContaining({ kind: "notify", payload: { title: "", body: "hello" } }));
  });

  it("refuses too long and empty text instead of cutting it", async () => {
    const before = store.insert.mock.calls.length;
    const long = await dispatch(device(), "present.speak", { text: "x".repeat(GOOGLE_HOME_SPEAK_MAX_CHARS + 1) });
    const empty = await dispatch(device(), "present.speak", { text: "  " });
    expect([long.status, empty.status]).toEqual(["failed", "failed"]);
    expect(long.error?.code).toBe("invalid_request");
    expect(store.insert.mock.calls.length).toBe(before);
  });
});

describe("bridge routes", () => {
  it("refuses no token and an unknown one", async () => {
    const { port, typed } = fakePort();
    const h = createBridgeHandlers(typed, () => T0);
    expect((await h.poll(req({}, null))).status).toBe(401);
    port.deviceFromTokenHash.mockResolvedValueOnce(null as never);
    expect((await h.poll(req({}))).status).toBe(401);
    expect(port.pending).not.toHaveBeenCalled();
  });

  it("looks the token up by hash, never in the clear", async () => {
    const { port, typed } = fakePort();
    await createBridgeHandlers(typed, () => T0).poll(req({}));
    const hash = (port.deviceFromTokenHash.mock.calls[0] as unknown as [string])[0];
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("tok");
  });

  it("poll hands over the text, moves nothing and touches only when last_seen is stale", async () => {
    const { port, typed } = fakePort({ lastSeen: new Date(T0 - TOUCH_EVERY_MS + 1).toISOString() });
    const res = await createBridgeHandlers(typed, () => T0).poll(req({ name: "Kitchen", model: "Google Home" }));
    expect(await res.json()).toEqual({ messages: [{ id: "11111111-1111-4111-8111-111111111111", text: "hello" }] });
    expect(port.touch).not.toHaveBeenCalled();
    expect(port.rename).toHaveBeenCalledWith("d1", { name: "Kitchen", model: "Google Home" });
    expect(port.take).not.toHaveBeenCalled();

    const { port: stale, typed: staleTyped } = fakePort({ lastSeen: new Date(T0 - TOUCH_EVERY_MS).toISOString() });
    await createBridgeHandlers(staleTyped, () => T0).poll(req({}));
    expect(stale.touch).toHaveBeenCalledTimes(1);
    expect(stale.rename).not.toHaveBeenCalled();
  });

  it("a speaker name the schema refuses still gets its messages", async () => {
    const { port, typed } = fakePort();
    const res = await createBridgeHandlers(typed, () => T0).poll(req({ name: "x".repeat(65) }));
    expect(res.status).toBe(200);
    expect(port.rename).not.toHaveBeenCalled();
    expect(port.pending).toHaveBeenCalledTimes(1);
  });

  it("ack settles once with the Cast outcome; a repeat is a 404 and settles nothing", async () => {
    const { port, typed, row } = fakePort();
    const h = createBridgeHandlers(typed, () => T0);
    expect((await h.ack(req({ id: row.id, ok: false, error: "gone" }))).status).toBe(200);
    expect(port.settle).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }), row, { ok: false, error: "gone", at: new Date(T0).toISOString() });
    port.take.mockResolvedValueOnce(null as never);
    expect((await h.ack(req({ id: row.id, ok: true }))).status).toBe(404);
    expect(port.settle).toHaveBeenCalledTimes(1);
    expect((await h.ack(req({ id: "nope", ok: true }))).status).toBe(400);
  });
});
