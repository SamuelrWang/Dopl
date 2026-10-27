/**
 * A6 TEST MODE over the real `/api/v1` route handlers, the simulator and the in-memory ports:
 * a simulated device of every kind delivers, each C10 magic id forces its failure (by device id and
 * by `external_user_id`), simulators are never usable in `live`, and `@dopl/sdk` round-trips
 * `notify` / `ask` against the handlers through a fetch that calls them in-process.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("./fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});

import { DEVICE_KINDS, ErrorResponseSchema, TEST_MAGIC_DEVICE_IDS, type CapabilityId, type DeviceKind } from "@dopl/contracts/device-sdk";
import { fakeStore, resetFakeStore } from "./fake-dev-db";
import { setDevEventSinkForTests } from "./events";
import { mintApiKey } from "./keys";
import { setDeliveryDepsForTests } from "./delivery-routes";
import { MemoryDeliveryStore, MemoryGrantStore } from "./delivery-store-memory";
import { createAdapterRegistry, type AdapterRegistry } from "../adapters/registry";
import { createSimulatorAdapter } from "../adapters/simulator";
import type { Environment } from "../types";
import { Dopl, DoplError } from "../../../../packages/sdk/src/index";
import { GET as contextGET } from "@/app/api/v1/users/[external_user_id]/context/route";
import { POST as deliverPOST } from "@/app/api/v1/users/[external_user_id]/deliver/route";
import { POST as actionPOST } from "@/app/api/v1/devices/[device_id]/actions/[capability]/route";
import { GET as actionGET } from "@/app/api/v1/actions/[id]/route";

const PROJECT = "proj-a6";
const test = { projectId: PROJECT, env: "test" as const };
const live = { projectId: PROJECT, env: "live" as const };
let NOW = Date.parse("2026-10-27T12:00:00Z");
let store: MemoryDeliveryStore;
let keys: Record<Environment, string>;

/** One capability per kind the simulator serves and `SIMULATOR_TEST_GRANT` covers. */
const PROBE: Record<DeviceKind, CapabilityId> = {
  glasses: "present.notify",
  phone: "present.notify",
  desktop: "present.notify",
  watch: "present.notify",
  home_hub: "present.display",
  home_device: "state.read",
  vehicle: "present.notify",
  robot: "state.read",
};
const probeArgs = (c: CapabilityId) => (c === "present.display" ? { blocks: [{ id: "t", type: "text", content: "hi" }] } : c === "present.notify" ? { body: "hi" } : {});

/** Route a fetch to the in-process handler, the way the deployed app would. */
async function inProcessFetch(input: string, init: RequestInit): Promise<Response> {
  const req = new NextRequest(input, init as ConstructorParameters<typeof NextRequest>[1]);
  const path = new URL(input).pathname.replace(/^\/api\/v1\//, "").split("/").map(decodeURIComponent);
  const p = (o: Record<string, string>) => ({ params: Promise.resolve(o) });
  if (path[0] === "users" && path[2] === "deliver") return deliverPOST(req, p({ external_user_id: path[1] }));
  if (path[0] === "users" && path[2] === "context") return contextGET(req, p({ external_user_id: path[1] }));
  if (path[0] === "devices" && path[2] === "actions") return actionPOST(req, p({ device_id: path[1], capability: path[3] }));
  if (path[0] === "actions") return actionGET(req, p({ id: path[1] }));
  return new Response("no route", { status: 404 });
}
const sdk = (env: Environment = "test") => new Dopl({ apiKey: keys[env], baseUrl: "http://localhost/api/v1", fetch: inProcessFetch });

const req = (env: Environment, url: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/v1/${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${keys[env]}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const act = (env: Environment, deviceId: string, capability: string, args: Record<string, unknown>, key: string) =>
  actionPOST(req(env, `devices/${deviceId}/actions/${capability}`, { args, idempotency_key: key }), params({ device_id: deviceId, capability }));
const deliver = (env: Environment, user: string, body: Record<string, unknown>) =>
  deliverPOST(req(env, `users/${user}/deliver`, { urgency: "normal", ...body }), params({ external_user_id: user }));
const context = (env: Environment, user: string) => contextGET(req(env, `users/${user}/context`), params({ external_user_id: user }));
const errorOf = async (res: Response) => ErrorResponseSchema.parse(await res.json()).error;

function installRegistry(adapters: AdapterRegistry) {
  setDeliveryDepsForTests({ store, grants: new MemoryGrantStore(), adapters, now: () => NOW, sleep: async (ms) => void (NOW += ms) });
}

/** An end user with one simulated device of `kind` in `scope`. */
function simUser(scope: typeof test | typeof live, externalUserId: string, kind: DeviceKind = "phone", deviceId?: string) {
  const user = store.addEndUser(scope, externalUserId);
  return store.addDevice(scope, { kind, end_user_id: user, ...(deviceId ? { id: deviceId } : {}) });
}

beforeEach(async () => {
  NOW = Date.parse("2026-10-27T12:00:00Z");
  setDevEventSinkForTests({ write: async () => undefined });
  resetFakeStore();
  fakeStore.projects.set(PROJECT, { id: PROJECT, org_id: "org-1", api_version: "2026-10-27" });
  keys = {
    test: (await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret" })).secret,
    live: (await mintApiKey({ projectId: PROJECT, env: "live", kind: "secret" })).secret,
  };
  store = new MemoryDeliveryStore();
  store.now = () => NOW;
  installRegistry(createAdapterRegistry([createSimulatorAdapter({ now: () => NOW })]));
});

describe("a simulated device of every kind (test env)", () => {
  it.each(DEVICE_KINDS)("%s: a device action completes with a simulated result", async (kind) => {
    const d = simUser(test, `u-${kind}`, kind);
    const res = await act("test", d.id, PROBE[kind], probeArgs(PROBE[kind]), `k-${kind}`);
    expect(res.status).toBe(202);
    const { action_id, status } = await res.json();
    expect(status).toBe("done");
    const poll = await (await actionGET(req("test", `actions/${action_id}`), params({ id: action_id }))).json();
    expect(poll.result).toMatchObject({ simulated: true });
  });

  it.each(DEVICE_KINDS.filter((k) => PROBE[k].startsWith("present.")))("%s: deliver notify routes to it and completes", async (kind) => {
    const d = simUser(test, `n-${kind}`, kind);
    const body = await (await deliver("test", `n-${kind}`, { intent: "notify", content: { text: "Build green." }, idempotency_key: `d-${kind}` })).json();
    expect(body).toMatchObject({ status: "done", routed_to: { device_id: d.id, kind } });
  });
});

describe("C10 magic failure ids", () => {
  it("by device id: every contract magic id forces its code", async () => {
    for (const [magic, code] of Object.entries(TEST_MAGIC_DEVICE_IDS)) {
      const d = simUser(test, `dev-${magic}`, "phone", `${magic}_x`);
      const err = await errorOf(await act("test", d.id, "present.notify", { body: "x" }, `m-${magic}`));
      expect(err.code).toBe(code);
    }
  });

  it("sim_device_offline as external_user_id: offline in context, device_offline (retryable) on deliver and actions", async () => {
    const d = simUser(test, "sim_device_offline_ci42", "glasses");
    const ctx = await (await context("test", "sim_device_offline_ci42")).json();
    expect(ctx).toMatchObject({ active_device: null, available: [] });
    const viaDeliver = await deliver("test", "sim_device_offline_ci42", { intent: "notify", content: { text: "x" }, idempotency_key: "o1" });
    expect(viaDeliver.status).toBe(409);
    expect(await errorOf(viaDeliver)).toMatchObject({ code: "device_offline", retryable: true });
    expect((await errorOf(await act("test", d.id, "present.notify", { body: "x" }, "o2"))).code).toBe("device_offline");
  });

  it("sim_confirm_denied as external_user_id: confirmation_denied (not retryable), device stays online", async () => {
    const d = simUser(test, "sim_confirm_denied", "phone");
    const viaDeliver = await deliver("test", "sim_confirm_denied", { intent: "notify", content: { text: "x" }, idempotency_key: "c1" });
    expect(viaDeliver.status).toBe(403);
    expect(await errorOf(viaDeliver)).toMatchObject({ code: "confirmation_denied", retryable: false });
    expect((await errorOf(await act("test", d.id, "present.notify", { body: "x" }, "c2"))).code).toBe("confirmation_denied");
    expect((await (await context("test", "sim_confirm_denied")).json()).active_device).toMatchObject({ id: d.id });
  });

  it("a near-miss id is an ordinary simulated user", async () => {
    simUser(test, "sim_device_offlineX", "phone");
    const body = await (await deliver("test", "sim_device_offlineX", { intent: "notify", content: { text: "x" }, idempotency_key: "nm" })).json();
    expect(body.status).toBe("done");
  });
});

describe("🔒 simulators are never usable in live", () => {
  it("the default registry never lists the simulator for live", () => {
    const reg = createAdapterRegistry([createSimulatorAdapter()]);
    expect(reg.list({ env: "live", includeExperimental: true })).toEqual([]);
    for (const kind of DEVICE_KINDS) expect(reg.forKind(kind, { env: "live", includeExperimental: true })).toEqual([]);
  });

  it("a simulator row in live is invisible to context, deliver and actions — even with a registry that offers it", async () => {
    const sim = createSimulatorAdapter({ now: () => NOW });
    const leaky: AdapterRegistry = { get: (id) => (id === sim.id ? sim : null), list: () => [sim], forKind: () => [sim] };
    for (const reg of [createAdapterRegistry([sim]), leaky]) {
      store = Object.assign(new MemoryDeliveryStore(), { now: () => NOW });
      installRegistry(reg);
      const d = simUser(live, "live-user", "phone");
      simUser(live, "sim_confirm_denied", "phone");
      expect((await (await context("live", "live-user")).json()).available).toEqual([]);
      expect((await errorOf(await deliver("live", "live-user", { intent: "notify", content: { text: "x" }, idempotency_key: "l1" }))).code).toBe("device_offline");
      expect((await errorOf(await act("live", d.id, "present.notify", { body: "x" }, "l2"))).code).toBe("not_found");
    }
  });
});

describe("@dopl/sdk end to end against the route handlers (simulator)", () => {
  it("notify, then ask with options answers the first option deterministically", async () => {
    const d = simUser(test, "sdk-user", "glasses");
    const dopl = sdk();
    const n = await dopl.notify("sdk-user", { text: "Deploy finished." });
    expect(n).toMatchObject({ status: "done", routed_to: { device_id: d.id, kind: "glasses" } });
    const ans = await dopl.ask("sdk-user", { question: "Ship it?", options: ["Yes", "No"], pollIntervalMs: 1 });
    expect(ans.status).toBe("answered");
    expect(ans.status === "answered" && ans.answer).toEqual({ simulated: true, index: 0, label: "Yes" });
  });

  it("a free-text ask answers the fixed simulated reply", async () => {
    simUser(test, "sdk-text", "phone");
    const ans = await sdk().ask("sdk-text", { question: "Where to?", pollIntervalMs: 1 });
    expect(ans.status === "answered" && ans.answer).toEqual({ simulated: true, text: "simulated reply" });
  });

  it("magic users surface as typed DoplErrors", async () => {
    simUser(test, "sim_device_offline", "phone");
    simUser(test, "sim_confirm_denied_1", "phone");
    const off = await sdk().notify("sim_device_offline", { text: "x" }).catch((e: unknown) => e);
    expect(off).toBeInstanceOf(DoplError);
    expect(off).toMatchObject({ code: "device_offline", retryable: true, status: 409 });
    const denied = await sdk().ask("sim_confirm_denied_1", { question: "q", options: ["a", "b"], pollIntervalMs: 1 }).catch((e: unknown) => e);
    expect(denied).toMatchObject({ code: "confirmation_denied", retryable: false, status: 403 });
  });

  it("context through the SDK lists the simulated device", async () => {
    const d = simUser(test, "sdk-ctx", "watch");
    const ctx = await sdk().users.context("sdk-ctx");
    expect(ctx.available).toEqual([expect.objectContaining({ id: d.id, kind: "watch" })]);
  });
});
