/**
 * The SDK lens NOTICES (W1.2 Gaps #1): flag/key handling and the failure classes, over the REAL
 * `@dopl/sdk` client with a scripted fetch. The full route round trip is
 * `device-sdk/server/glasses/notice-round-trip.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// A string path, not an import: the seam's own lint fence holds for its tests too.
const sdkDeliveryFor = vi.hoisted(() => vi.fn());
vi.mock("@/features/device-sdk/server/sdk-delivery-flag", () => ({ sdkDeliveryFor }));

import { Dopl } from "@dopl/sdk";
import { createSdkNotices, sdkUserNotices } from "./sdk-lens";
import { glassesNotify } from "@/features/glasses/core/messages/service";
import { createFakeGlassesStore, fakeClock } from "@/features/glasses/core/testing/fake-store";
import { createFakeDeviceStore } from "@/features/glasses/core/testing/fake-device-store";

const KEY = "sk_test_EXAMPLE0000000000000000";
const USER = "11111111-1111-4111-8111-111111111111";
const DEV = "dev-1";
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const err = (status: number, code: string, type = "invalid_request_error") => res(status, { error: { type, code, message: code, retryable: false, doc_url: "https://x" } });

function notices(route: (key: string, body: unknown) => Response | Promise<Response>) {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const r = route(`${init.method} ${new URL(url).pathname.replace("/api/v1", "")}`, init.body ? JSON.parse(String(init.body)) : null);
    return r;
  });
  return { n: sdkUserNotices(new Dopl({ apiKey: KEY, baseUrl: "https://app.example/api/v1", fetch }), USER, [DEV]), fetch };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sdkUserNotices.notify", () => {
  it("present.notify on the device with title and body", async () => {
    const { n, fetch } = notices((k, body) => {
      expect(k).toBe(`POST /devices/${DEV}/actions/present.notify`);
      expect(body).toMatchObject({ args: { title: "T", body: "B" }, idempotency_key: "k1" });
      return res(202, { action_id: "a1", status: "queued" });
    });
    expect(await n.notify({ deviceId: DEV, title: "T", body: "B", idempotencyKey: "k1" })).toEqual({ ok: true, value: { id: "a1", status: "queued" } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("🔒 gap #6: fallback only when nothing was sent; may-have-landed replays once (same key), then unconfirmed", async () => {
    const call = (r: () => Response | Promise<Response>) => notices(() => r()).n.notify({ deviceId: DEV, title: "T", body: "B", idempotencyKey: "k" });
    // Never connected / key refused: proven, the prosumer notice is the one copy.
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const sdkNotices = createSdkNotices({ key: KEY, baseUrl: "https://app.example/api/v1", fetch: async () => Promise.reject(refused) });
    sdkDeliveryFor.mockResolvedValueOnce({ on: true, deviceIds: [DEV] });
    expect(await (await sdkNotices.forUser(USER))!.notify({ deviceId: DEV, title: "T", body: "B", idempotencyKey: "k" })).toMatchObject({ ok: false, fallback: true });
    expect(await call(() => err(401, "unauthenticated", "authentication_error"))).toMatchObject({ ok: false, fallback: true });
    // May have landed: one replay with the same key; still unknown = unconfirmed, no prosumer copy.
    const lost = notices(() => Promise.reject(new TypeError("fetch failed")));
    expect(await lost.n.notify({ deviceId: DEV, title: "T", body: "B", idempotencyKey: "k" })).toEqual({ ok: false, code: "unconfirmed", fallback: false });
    expect(lost.fetch).toHaveBeenCalledTimes(2);
    expect(await call(() => err(503, "unexpected_response", "api_error"))).toEqual({ ok: false, code: "unconfirmed", fallback: false });
    let n = 0;
    expect(await call(() => (n++ === 0 ? err(502, "bad_gateway", "api_error") : res(202, { action_id: "a1", status: "queued" })))).toEqual({ ok: true, value: { id: "a1", status: "queued" } });
    // Refused before any lens copy existed (router / pre-queue): proven, the prosumer notice is the one copy.
    expect(await call(() => err(409, "device_offline", "device_error"))).toEqual({ ok: false, code: "device_offline", fallback: true });
    expect(await call(() => err(400, "invalid_request"))).toEqual({ ok: false, code: "invalid_request", fallback: true });
    // A refusal on the REPLAY proves nothing about the first call: reported, no prosumer copy.
    let m = 0;
    expect(await call(() => (m++ === 0 ? err(503, "unexpected_response", "api_error") : err(409, "device_offline", "device_error")))).toEqual({ ok: false, code: "device_offline", fallback: false });
    // Another call under this key landed: a refusal, never a second copy.
    expect(await call(() => err(409, "idempotency_conflict"))).toEqual({ ok: false, code: "idempotency_conflict", fallback: false });
  });
});

describe("sdkUserNotices.action", () => {
  const action = (device_id: string) => ({ action_id: "a1", device_id, capability: "ask.choice", status: "done", result: { index: 0, label: "Y" }, error: null, created_at: "2026-10-28T12:00:00.000Z", updated_at: "2026-10-28T12:00:01.000Z" });
  it("returns the caller's own action; another device's is not_found", async () => {
    expect(await notices(() => res(200, action(DEV))).n.action("a1")).toMatchObject({ ok: true, value: { id: "a1", device_id: DEV, status: "done" } });
    expect(await notices(() => res(200, action("someone-elses"))).n.action("a1")).toEqual({ ok: false, code: "not_found", fallback: false });
    expect(await notices(() => err(404, "not_found")).n.action("a1")).toEqual({ ok: false, code: "not_found", fallback: false });
  });
});

describe("createSdkNotices", () => {
  it("flag off = null; flag on without a key, or a failed flag read = unavailable", async () => {
    sdkDeliveryFor.mockResolvedValueOnce({ on: false, deviceIds: [] });
    expect(await createSdkNotices({ key: KEY }).forUser(USER)).toBeNull();
    sdkDeliveryFor.mockRejectedValueOnce(new Error("db"));
    await expect(createSdkNotices({ key: KEY }).forUser(USER)).rejects.toMatchObject({ code: "flag_lookup_failed", fallback: true });
    const saved = process.env.DOPL_APP_SDK_KEY;
    delete process.env.DOPL_APP_SDK_KEY;
    sdkDeliveryFor.mockResolvedValueOnce({ on: true, deviceIds: [DEV] });
    await expect(createSdkNotices().forUser(USER)).rejects.toMatchObject({ code: "no_key", fallback: true });
    if (saved !== undefined) process.env.DOPL_APP_SDK_KEY = saved;
    sdkDeliveryFor.mockResolvedValueOnce({ on: true, deviceIds: [DEV] });
    expect((await createSdkNotices({ key: KEY }).forUser(USER))?.deviceIds).toEqual([DEV]);
  });
});

describe("prod 2026-10-30 repro: a router refusal reaches the lens through the prosumer path", () => {
  it("device_offline from /api/v1 → glasses_notify writes the prosumer row (not skipped:sdk)", async () => {
    const fake = createFakeGlassesStore();
    const clock = fakeClock();
    const { devices } = createFakeDeviceStore();
    const link = await devices.insertDevice({ userId: USER, name: "Even G2 Simulator", platform: "even_g2", now: new Date(clock.now()).toISOString() });
    await devices.setTokenHash(link.id, "hash-sim");
    const { n, fetch } = notices(() => err(409, "device_offline", "device_error"));
    const user = { ...n, deviceIds: [link.id] };
    const deps = { store: fake.store, devices, now: clock.now, sleep: clock.sleep, sdkNotices: { forUser: async () => user } };
    const r = await glassesNotify(deps, USER, { title: "Hi", body: "there" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(r.status).not.toMatch(/^skipped/);
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({ kind: "notify", payload: { title: "Hi", body: "there" } });
  });
});
