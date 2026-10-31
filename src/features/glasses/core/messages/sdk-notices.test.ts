/**
 * `glasses_notify` / `glasses_get_answer` over the device SDK (W1.2 Gaps #1): path choice per device,
 * the faithful-or-not ttl rule, failure classes (fallback vs refusal, no double copy) and the
 * cross-user guard on action ids. Over a scripted {@link GlassesSdkPort}; the port's own SDK calls are
 * `display/server/sdk-lens-notices.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeGlassesStore, fakeClock } from "../testing/fake-store";
import { createFakeDeviceStore } from "../testing/fake-device-store";
import { glassesGetAnswer, glassesNotify, glassesShow, type GlassesSdkResult, type GlassesSdkUser } from "./service";

const USER = "11111111-1111-4111-8111-111111111111";
const ACT = "22222222-2222-4222-8222-222222222222";

type Notify = GlassesSdkUser["notify"];
type ActionFn = GlassesSdkUser["action"];

async function setup(opts: { migrated?: "all" | "both" | "none" | "one of two"; notify?: Notify; show?: GlassesSdkUser["show"]; action?: ActionFn; forUser?: () => Promise<GlassesSdkUser | null> } = {}) {
  const fake = createFakeGlassesStore();
  const clock = fakeClock();
  const { devices } = createFakeDeviceStore();
  const now = new Date(clock.now()).toISOString();
  const pair = async (name: string) => {
    const d = await devices.insertDevice({ userId: USER, name, platform: "even_g2", now });
    await devices.setTokenHash(d.id, `hash-${name}`);
    return d.id;
  };
  const ids = [await pair("G2")];
  if (opts.migrated === "one of two" || opts.migrated === "both") ids.push(await pair("G2 b"));
  const migratedIds = opts.migrated === "none" ? [] : opts.migrated === "both" ? ids : [ids[0]];
  const notify = vi.fn<Notify>(opts.notify ?? (async () => ({ ok: true, value: { id: ACT, status: "queued" } })));
  const action = vi.fn<ActionFn>(opts.action ?? (async () => ({ ok: false, code: "not_found", fallback: false })));
  const show = vi.fn<GlassesSdkUser["show"]>(opts.show ?? (async () => ({ ok: true, value: { id: ACT, status: "queued" } })));
  const user: GlassesSdkUser = { deviceIds: migratedIds, notify, show, action };
  const forUser = vi.fn(opts.forUser ?? (async () => user));
  const logFallback = vi.fn(async () => {});
  const deps = { store: fake.store, devices, now: clock.now, sleep: clock.sleep, sdkNotices: { forUser }, logFallback };
  return { deps, rows: fake.rows, notify, show, action, forUser, ids, logFallback };
}

let logs: Array<Record<string, unknown>>;
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "info").mockImplementation((m: string) => void logs.push(JSON.parse(m.slice("[glasses] ".length))));
});

const unavailable = (code: string): GlassesSdkResult<never> => ({ ok: false, code, fallback: true });
const refused = (code: string): GlassesSdkResult<never> => ({ ok: false, code, fallback: false });

describe("glasses_show over the SDK", () => {
  it("every link migrated: one logged deliver per device, no prosumer row", async () => {
    const w = await setup({ migrated: "both" });
    const out = await glassesShow(w.deps, USER, { title: "T", lines: ["a", "b"] });
    expect(out).toEqual({ id: ACT, card_id: null, status: "pending" });
    expect(w.show).toHaveBeenCalledTimes(2);
    expect(w.rows).toHaveLength(0);
    expect(w.logFallback).not.toHaveBeenCalled();
  });

  it("🔒 faithful or not at all: a card_id or another ttl stays on the prosumer queue, and says so in the log", async () => {
    const w = await setup();
    await glassesShow(w.deps, USER, { title: "T", lines: ["a"], card_id: "c1" });
    await glassesShow(w.deps, USER, { title: "T", lines: ["a"], ttl_sec: 30 });
    expect(w.show).not.toHaveBeenCalled();
    expect(w.rows).toHaveLength(2);
    expect(w.logFallback).toHaveBeenCalledWith(USER, { operation: "show.prosumer_fallback", capability: "present.display", reason: "card_id" });
    expect(w.logFallback).toHaveBeenCalledWith(USER, { operation: "show.prosumer_fallback", capability: "present.display", reason: "ttl_sec 30" });
  });
});

describe("glasses_notify fallback row", () => {
  it("🔒 a proven refusal writes the row that explains the delivered message", async () => {
    const w = await setup({ notify: async () => unavailable("device_offline") });
    await glassesNotify(w.deps, USER, { title: "T", body: "B" });
    expect(w.rows).toHaveLength(1);
    expect(w.logFallback).toHaveBeenCalledWith(USER, { operation: "notify.prosumer_fallback", capability: "present.notify", reason: "device_offline" });
  });
});

describe("glasses_notify over the SDK", () => {
  it("every link migrated: present.notify on the device with title+body, no prosumer row", async () => {
    const w = await setup();
    const r = await glassesNotify(w.deps, USER, { title: "Build ✅", body: "It’s green" });
    expect(r).toEqual({ id: ACT, status: "pending" });
    expect(w.notify).toHaveBeenCalledWith(expect.objectContaining({ deviceId: w.ids[0], title: "Build", body: "It's green" }));
    expect(w.rows).toHaveLength(0);
    expect(logs).toContainEqual({ evt: "glasses_notify", path: "sdk", devices: 1 });
  });

  it("a link that is not migrated keeps the prosumer queue (every device reads it)", async () => {
    const w = await setup({ migrated: "one of two" });
    const r = await glassesNotify(w.deps, USER, { title: "t", body: "b" });
    expect(r.status).toBe("pending");
    expect(w.notify).not.toHaveBeenCalled();
    expect(w.rows).toHaveLength(1);
    expect(logs).toContainEqual({ evt: "glasses_notify", path: "prosumer_fallback", fallback_reason: "unmigrated device" });
  });

  it("flag off: prosumer, unchanged", async () => {
    const w = await setup({ forUser: async () => null });
    await glassesNotify(w.deps, USER, { title: "t", body: "b" });
    expect(w.rows).toHaveLength(1);
    expect(logs).toContainEqual({ evt: "glasses_notify", path: "prosumer" });
  });

  it("faithful or not at all: a ttl the SDK notice cannot carry stays prosumer", async () => {
    const w = await setup();
    await glassesNotify(w.deps, USER, { title: "t", body: "b", ttl_sec: 300 });
    expect(w.notify).not.toHaveBeenCalled();
    expect(Date.parse(w.rows[0].expires_at) - Date.parse(w.rows[0].created_at)).toBe(300_000);
    expect(logs).toContainEqual({ evt: "glasses_notify", path: "prosumer_fallback", fallback_reason: "ttl_sec 300" });
  });

  it("an explicit ttl_sec of 60 is the SDK notice's own lifetime", async () => {
    const w = await setup();
    await glassesNotify(w.deps, USER, { title: "t", body: "b", ttl_sec: 60 });
    expect(w.notify).toHaveBeenCalledTimes(1);
    expect(w.rows).toHaveLength(0);
  });

  it("SDK unavailable (flag lookup throws, or the call cannot reach it): prosumer, exactly one copy", async () => {
    const thrown = await setup({ forUser: async () => Promise.reject(Object.assign(new Error("x"), { code: "flag_lookup_failed" })) });
    await glassesNotify(thrown.deps, USER, { title: "t", body: "b" });
    expect(thrown.rows).toHaveLength(1);
    expect(logs).toContainEqual({ evt: "glasses_notify", path: "prosumer_fallback", fallback_reason: "flag_lookup_failed" });

    const down = await setup({ notify: async () => unavailable("network_error") });
    await glassesNotify(down.deps, USER, { title: "t", body: "b" });
    expect(down.rows).toHaveLength(1);
    expect(logs).toContainEqual({ evt: "glasses_notify", path: "prosumer_fallback", fallback_reason: "network_error" });
  });

  it("prod 2026-10-30: device_offline (proven nothing sent) falls back; the notice reaches the lens via prosumer", async () => {
    const w = await setup({ notify: async () => unavailable("device_offline") });
    const r = await glassesNotify(w.deps, USER, { title: "t", body: "b" });
    expect(r.status).toBe("pending");
    expect(r.id).toBe(w.rows[0].id);
    expect(w.rows).toHaveLength(1);
    expect(logs).toContainEqual({ evt: "glasses_notify", path: "prosumer_fallback", fallback_reason: "device_offline" });
  });

  it("prod 2026-10-30: a stale device refusing device_offline does not keep the notice from a live one", async () => {
    let calls = 0;
    const w = await setup({
      migrated: "both",
      notify: async () => (calls++ === 0 ? unavailable("device_offline") : { ok: true, value: { id: ACT, status: "queued" } }),
    });
    const r = await glassesNotify(w.deps, USER, { title: "t", body: "b" });
    expect(r).toEqual({ id: ACT, status: "pending" });
    expect(w.notify).toHaveBeenCalledTimes(2);
    expect(w.rows).toHaveLength(0);
    expect(logs).toContainEqual({ evt: "glasses_notify", path: "sdk", devices: 1 });
  });

  it("SDK refusal that may have landed (our timeout, unconfirmed): skipped, never a second copy", async () => {
    const w = await setup({ notify: async () => refused("timeout") });
    const r = await glassesNotify(w.deps, USER, { title: "t", body: "b" });
    expect(r).toEqual({ id: null, status: "skipped:sdk timeout" });
    expect(w.rows).toHaveLength(0);
  });

  it("validation runs first and is the prosumer's", async () => {
    const w = await setup();
    await expect(glassesNotify(w.deps, USER, { title: "x".repeat(65), body: "b" })).rejects.toThrow("title is 65 bytes; max 64");
    expect(w.notify).not.toHaveBeenCalled();
  });
});

describe("glasses_get_answer for an SDK action id", () => {
  const action = (status: string, result: Record<string, unknown> | null, capability = "ask.choice") => async () => ({
    ok: true as const,
    value: { id: ACT, device_id: "d", capability, status, result, updated_at: "2026-10-28T12:00:00.000Z" },
  });

  it("answered: the prosumer result shape", async () => {
    const w = await setup({ action: action("done", { index: 1, label: "No", answered_at: "2026-10-28T11:59:00.000Z" }) });
    expect(await glassesGetAnswer(w.deps, USER, { id: ACT })).toEqual({ id: ACT, status: "answered", answer: { choice: "No", index: 1, at: "2026-10-28T11:59:00.000Z" } });
    expect(w.action).toHaveBeenCalledWith(ACT);
  });

  it("dismissed, still waiting, and failed", async () => {
    expect(await glassesGetAnswer((await setup({ action: action("done", { dismissed: true, index: null, label: null }) })).deps, USER, { id: ACT })).toMatchObject({ status: "dismissed", answer: null });
    expect(await glassesGetAnswer((await setup({ action: action("queued", null) })).deps, USER, { id: ACT })).toMatchObject({ status: "pending", answer: null });
    expect(await glassesGetAnswer((await setup({ action: action("delivered", null) })).deps, USER, { id: ACT })).toMatchObject({ status: "delivered" });
    expect(await glassesGetAnswer((await setup({ action: action("failed", null) })).deps, USER, { id: ACT })).toMatchObject({ status: "expired" });
  });

  it("a prosumer row wins; the SDK is not asked", async () => {
    const w = await setup();
    const n = await glassesNotify({ ...w.deps, sdkNotices: undefined }, USER, { title: "t", body: "b" });
    expect(await glassesGetAnswer(w.deps, USER, { id: n.id! })).toMatchObject({ id: n.id, status: "pending" });
    expect(w.forUser).not.toHaveBeenCalled();
  });

  it("unknown, another user's (port says not_found), flag off, or SDK down: the prosumer error", async () => {
    await expect(glassesGetAnswer((await setup()).deps, USER, { id: ACT })).rejects.toThrow(`no glasses message with id ${ACT}`);
    await expect(glassesGetAnswer((await setup({ forUser: async () => null })).deps, USER, { id: ACT })).rejects.toThrow(/^no glasses message with id \S+$/);
    await expect(glassesGetAnswer((await setup({ action: async () => unavailable("network_error") })).deps, USER, { id: ACT })).rejects.toThrow("(device SDK unavailable: network_error)");
  });

  it("a non-uuid id is neither queue's: no SDK read", async () => {
    const w = await setup();
    await expect(glassesGetAnswer(w.deps, USER, { id: "not-a-uuid" })).rejects.toThrow("no glasses message with id not-a-uuid");
    expect(w.forUser).not.toHaveBeenCalled();
  });

  it("works while a second link is unmigrated (a read; the port scopes it to migrated devices)", async () => {
    const w = await setup({ migrated: "one of two", action: action("done", { index: 0, label: "Yes" }) });
    expect(await glassesGetAnswer(w.deps, USER, { id: ACT })).toMatchObject({ status: "answered", answer: { choice: "Yes", index: 0, at: "2026-10-28T12:00:00.000Z" } });
  });
});
