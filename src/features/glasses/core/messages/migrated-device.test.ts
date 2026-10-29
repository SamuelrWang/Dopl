/**
 * W1.2 dogfood window (Plan §8): a prosumer G2 MIGRATED to an SDK row keeps its id and legacy token.
 * Its inbox carries BOTH queues (the user's prosumer rows + the device's SDK lens rows), and an answer
 * or dismiss lands on whichever queue holds the row, settling the SDK action through the port.
 */
import { describe, expect, it, vi } from "vitest";
import { hashCredential } from "../devices/credentials";
import type { SdkGlassesPort, SdkSettledAction } from "../devices/sdk-device";
import type { GlassesDevice } from "../devices/types";
import { createFakeChannel } from "../testing/fake-channel";
import { createFakeDeviceStore, fakeLinker } from "../testing/fake-device-store";
import { createFakeGlassesStore, fakeClock } from "../testing/fake-store";
import { createDeviceHandlers } from "./device-handlers";
import { glassesNotify } from "./service";
import type { GlassesMessage, GlassesStore } from "./types";

const OWNER = "22222222-2222-4222-8222-222222222222";
const BASE = "http://127.0.0.1:3100";

function setup(opts: { migrated?: boolean; lookupFails?: boolean; linked?: "ok" | "conflict"; project?: string } = {}) {
  const prosumer = createFakeGlassesStore();
  const sdk = createFakeGlassesStore({ idBlock: "9000" });
  const dev = createFakeDeviceStore();
  const clock = fakeClock();
  const delivered: Array<[string, string[]]> = [];
  const settled: Array<[string, GlassesMessage]> = [];
  const deviceIds: string[] = [];
  const port: SdkGlassesPort = {
    store: sdk.store,
    deviceFromTokenHash: vi.fn(async () => null),
    touch: vi.fn(async () => {}),
    revokeToken: vi.fn(async () => {}),
    delivered: async (id, ids) => void delivered.push([id, ids]),
    settled: async (id, row) => {
      settled.push([id, row]);
      // The port reports the action it moved (the app's own ask carries its channel link in the key).
      const action = { id: `act-${row.id}`, project_id: opts.project ?? "dopl-app", env: "live", idempotency_key: "dsk1.k", status: "done", result: { index: row.answer?.index ?? null } };
      return row.kind === "ask" ? [action] : [];
    },
    isDoplAppProject: async (projectId, env) => projectId === "dopl-app" && env === "live",
    migratedDeviceIds: vi.fn(async () => {
      if (opts.lookupFails) throw new Error("rpc down");
      return opts.migrated === false ? [] : deviceIds;
    }),
  };
  const linked: Array<[GlassesDevice, SdkSettledAction[]]> = [];
  const handlers = createDeviceHandlers({
    store: prosumer.store,
    devices: dev.devices,
    gateway: createFakeChannel({ liveAgents: 1 }).gateway,
    linker: fakeLinker({}),
    allowPairStart: async () => true,
    sdk: port,
    sdkAnswerLinked: async (device, actions) => {
      linked.push([device, actions]);
      return opts.linked ?? "ok";
    },
    now: clock.now,
    sleep: clock.sleep,
  });
  return { prosumer, sdk, dev, clock, port, handlers, delivered, settled, deviceIds, linked };
}

type World = ReturnType<typeof setup>;

const req = (path: string, token: string, init: RequestInit = {}) =>
  new Request(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
const inbox = async (w: World, token: string) =>
  ((await (await w.handlers.inbox(req("/api/glasses/device/inbox?wait=0", token))).json()) as { messages: GlassesMessage[] }).messages;
const answer = (w: World, token: string, body: unknown) =>
  w.handlers.answer(req("/api/glasses/device/answer", token, { method: "POST", body: JSON.stringify(body) }));
const dismiss = (w: World, token: string, body: unknown) =>
  w.handlers.dismiss(req("/api/glasses/device/dismiss", token, { method: "POST", body: JSON.stringify(body) }));

/** A paired prosumer G2 (legacy token), listed as migrated when the world says so. */
async function pairLegacy(w: World) {
  const token = "glsdt_legacy_token_for_tests";
  const d = await w.dev.devices.insertDevice({ userId: OWNER, name: "G2", platform: "even_g2", now: new Date(w.clock.now()).toISOString() });
  await w.dev.devices.setTokenHash(d.id, hashCredential(token));
  w.deviceIds.push(d.id);
  return { token, id: d.id };
}

const askRow = (store: GlassesStore, key: string, w: World) =>
  store.insert(key, {
    kind: "ask",
    card_id: null,
    payload: { question: "Ship it?", options: ["Yes", "No"] },
    expires_at: new Date(w.clock.now() + 600_000).toISOString(),
    now: new Date(w.clock.now()).toISOString(),
  });
const sdkAsk = (w: World, deviceId: string) => askRow(w.sdk.store, deviceId, w);

describe("migrated G2 (legacy token, sdk_delivery on)", () => {
  it("one inbox carries the user's prosumer rows AND the device's SDK lens rows; handover moves each in its own table", async () => {
    const w = setup();
    const g2 = await pairLegacy(w);
    await glassesNotify({ store: w.prosumer.store, devices: w.dev.devices, now: w.clock.now }, OWNER, { title: "Hi", body: "prosumer" });
    w.clock.advance(10);
    const ask = await sdkAsk(w, g2.id);

    const messages = await inbox(w, g2.token);
    expect(messages.map((m) => m.kind)).toEqual(["notify", "ask"]);
    expect(messages.every((m) => m.status === "delivered")).toBe(true);
    expect(w.delivered).toEqual([[g2.id, [ask.id]]]);
    expect((await w.sdk.store.get(g2.id, ask.id))?.status).toBe("delivered");
  });

  it("🔒 an answer to an SDK row settles it through the port; a prosumer row stays on the prosumer path", async () => {
    const w = setup();
    const g2 = await pairLegacy(w);
    const ask = await sdkAsk(w, g2.id);
    await inbox(w, g2.token);

    const res = await answer(w, g2.token, { id: ask.id, index: 1 });
    expect(res.status).toBe(200);
    expect((await w.sdk.store.get(g2.id, ask.id))?.answer).toMatchObject({ index: 1, choice: "No" });
    expect(w.settled.map(([id, row]) => [id, row.id])).toEqual([[g2.id, ask.id]]);

    const own = await askRow(w.prosumer.store, OWNER, w);
    expect((await answer(w, g2.token, { id: own.id, index: 0 })).status).toBe(200);
    expect(w.settled).toHaveLength(1);
  });

  it("🔒 gap #3: the answer's settled actions go to the app bridge with the OWNER device (no held function needed)", async () => {
    const w = setup();
    const g2 = await pairLegacy(w);
    const ask = await sdkAsk(w, g2.id);
    expect((await answer(w, g2.token, { id: ask.id, index: 0 })).status).toBe(200);
    expect(w.linked).toHaveLength(1);
    expect(w.linked[0][0]).toMatchObject({ id: g2.id, user_id: OWNER });
    expect(w.linked[0][1]).toEqual([{ id: `act-${ask.id}`, project_id: "dopl-app", env: "live", idempotency_key: "dsk1.k", status: "done", result: { index: 0 } }]);
  });

  it("the channel decision was answered first: 409 like the prosumer tap; the SDK row and action stay answered", async () => {
    const w = setup({ linked: "conflict" });
    const g2 = await pairLegacy(w);
    const ask = await sdkAsk(w, g2.id);
    const res = await answer(w, g2.token, { id: ask.id, index: 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "already answered" });
    expect(w.settled).toHaveLength(1);
  });

  it("🔒 an action of ANOTHER project (or a port that cannot tell) is never bridged; the answer still lands", async () => {
    const w = setup({ project: "someone-elses" });
    const g2 = await pairLegacy(w);
    const ask = await sdkAsk(w, g2.id);
    expect((await answer(w, g2.token, { id: ask.id, index: 0 })).status).toBe(200);
    expect(w.settled).toHaveLength(1);
    expect(w.linked).toEqual([]);

    const blind = setup();
    delete blind.port.isDoplAppProject;
    const g2b = await pairLegacy(blind);
    const askb = await sdkAsk(blind, g2b.id);
    expect((await answer(blind, g2b.token, { id: askb.id, index: 0 })).status).toBe(200);
    expect(blind.linked).toEqual([]);
  });

  it("nothing settled (a late hop), a dismiss, or a prosumer row: the bridge is not called", async () => {
    const w = setup();
    const g2 = await pairLegacy(w);
    w.port.settled = async () => [];
    const late = await sdkAsk(w, g2.id);
    await answer(w, g2.token, { id: late.id, index: 0 });
    const gone = await sdkAsk(w, g2.id);
    await dismiss(w, g2.token, { id: gone.id });
    const own = await askRow(w.prosumer.store, OWNER, w);
    await answer(w, g2.token, { id: own.id, index: 0 });
    expect(w.linked).toEqual([]);
  });

  it("a dismissed SDK ask settles too", async () => {
    const w = setup();
    const g2 = await pairLegacy(w);
    const ask = await sdkAsk(w, g2.id);
    expect((await dismiss(w, g2.token, { id: ask.id })).status).toBe(200);
    expect(w.settled.map(([, row]) => row.status)).toEqual(["dismissed"]);
  });

  it("🔒 not migrated: the SDK queue stays invisible and its rows unanswerable (404)", async () => {
    const w = setup({ migrated: false });
    const g2 = await pairLegacy(w);
    const ask = await sdkAsk(w, g2.id);
    expect(await inbox(w, g2.token)).toEqual([]);
    expect((await answer(w, g2.token, { id: ask.id, index: 0 })).status).toBe(404);
    expect(w.settled).toEqual([]);
  });

  it("a failed flag lookup degrades to the prosumer queue, never fails the poll", async () => {
    const w = setup({ lookupFails: true });
    const g2 = await pairLegacy(w);
    await sdkAsk(w, g2.id);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await inbox(w, g2.token)).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
