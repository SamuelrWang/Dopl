/**
 * `GET /v1/devices/{id}` (C3, A9): the openapi `Device` shape with adapter descriptors and presence
 * from `last_seen`; another project's, another env's, a revoked or a prosumer device is `not_found`;
 * publishable keys refused; exactly one `dev_events` row per call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("@/features/device-sdk/server/fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});

import { DeviceSchema, ErrorResponseSchema } from "@dopl/device-contracts";
import { fakeStore, resetFakeStore } from "@/features/device-sdk/server/fake-dev-db";
import { flushDevEvents, setDevEventSinkForTests } from "@/features/device-sdk/server/events";
import { mintApiKey } from "@/features/device-sdk/server/keys";
import { setDeliveryDepsForTests } from "@/features/device-sdk/server/delivery-routes";
import { MemoryDeliveryStore, MemoryGrantStore } from "@/features/device-sdk/server/delivery-store-memory";
import { createAdapterRegistry } from "@/features/device-sdk/adapters/registry";
import { createSimulatorAdapter } from "@/features/device-sdk/adapters/simulator";
import { createEvenG2Adapter } from "@/features/device-sdk/adapters/even-g2";
import type { DeviceEventRow } from "@/features/device-sdk/types";
import { GET } from "./route";

const P1 = "proj-1";
const P2 = "proj-2";
const NOW = Date.parse("2026-10-27T12:00:00Z");
let events: DeviceEventRow[];
let store: MemoryDeliveryStore;
let key: string;

const get = (id: string, bearer = key) =>
  GET(new NextRequest(`http://localhost/api/v1/devices/${id}`, { headers: { authorization: `Bearer ${bearer}` } }), {
    params: Promise.resolve({ device_id: id }),
  });

async function oneEvent() {
  await flushDevEvents();
  expect(events).toHaveLength(1);
  return events[0];
}

async function expectNotFound(res: Response) {
  expect(res.status).toBe(404);
  expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("not_found");
}

beforeEach(async () => {
  events = [];
  setDevEventSinkForTests({ write: async (rows) => void events.push(...rows) });
  resetFakeStore();
  for (const id of [P1, P2]) fakeStore.projects.set(id, { id, org_id: "org-1", api_version: "2026-10-27" });
  key = (await mintApiKey({ projectId: P1, env: "test", kind: "secret", scopes: ["devices:read"] })).secret;
  store = new MemoryDeliveryStore();
  store.now = () => NOW;
  setDeliveryDepsForTests({
    store,
    grants: new MemoryGrantStore(),
    adapters: createAdapterRegistry([createSimulatorAdapter({ now: () => NOW }), createEvenG2Adapter({ now: () => NOW })]),
    now: () => NOW,
  });
});

describe("GET /v1/devices/{id}", () => {
  it("answers the openapi Device with adapter descriptors; one event row", async () => {
    const user = store.addEndUser({ projectId: P1, env: "test" }, "u1");
    const d = store.addDevice({ projectId: P1, env: "test" }, { kind: "glasses", end_user_id: user });
    const res = await get(d.id);
    expect(res.status).toBe(200);
    const device = DeviceSchema.parse(await res.json());
    expect(device).toMatchObject({ id: d.id, kind: "glasses", adapter_id: "simulator", online: true });
    expect(device.capabilities.length).toBeGreaterThan(0);
    expect(await oneEvent()).toMatchObject({ device_id: d.id, external_user_id: "u1", outcome: "ok" });
  });

  it("presence comes from last_seen (G2: stale → offline, last_seen_at echoed)", async () => {
    const user = store.addEndUser({ projectId: P1, env: "test" }, "u1");
    const seen = new Date(NOW - 24 * 3600_000).toISOString();
    const stale = store.addDevice({ projectId: P1, env: "test" }, { kind: "glasses", end_user_id: user, adapter_id: "even_g2", last_seen: seen });
    const fresh = store.addDevice({ projectId: P1, env: "test" }, { kind: "glasses", end_user_id: user, adapter_id: "even_g2", last_seen: new Date(NOW).toISOString() });
    const a = DeviceSchema.parse(await (await get(stale.id)).json());
    expect(a).toMatchObject({ online: false, last_seen_at: seen });
    expect(a.capabilities.length).toBeGreaterThan(0);
    expect(DeviceSchema.parse(await (await get(fresh.id)).json()).online).toBe(true);
  });

  it("another project's device is not_found", async () => {
    const other = store.addEndUser({ projectId: P2, env: "test" }, "u1");
    const d = store.addDevice({ projectId: P2, env: "test" }, { kind: "glasses", end_user_id: other });
    await expectNotFound(await get(d.id));
    expect((await oneEvent()).outcome).not.toBe("ok");
  });

  it("the same project's device in the other env is not_found", async () => {
    const live = store.addEndUser({ projectId: P1, env: "live" }, "u1");
    const d = store.addDevice({ projectId: P1, env: "live" }, { kind: "glasses", end_user_id: live, adapter_id: "even_g2" });
    await expectNotFound(await get(d.id));
    const liveKey = (await mintApiKey({ projectId: P1, env: "live", kind: "secret", scopes: ["devices:read"] })).secret;
    expect((await get(d.id, liveKey)).status).toBe(200);
  });

  it("a prosumer device (no project) and a revoked device are not_found", async () => {
    const user = store.addEndUser({ projectId: P1, env: "test" }, "u1");
    const prosumer = store.addDevice({ projectId: P1, env: "test" }, { kind: "glasses", end_user_id: user });
    (prosumer as { project_id: string | null }).project_id = null;
    const revoked = store.addDevice({ projectId: P1, env: "test" }, { kind: "glasses", end_user_id: user }, true);
    await expectNotFound(await get(prosumer.id));
    await expectNotFound(await get(revoked.id));
    await expectNotFound(await get("no-such-device"));
  });

  it("refuses a publishable key", async () => {
    const pk = (await mintApiKey({ projectId: P1, env: "test", kind: "publishable" })).secret;
    const user = store.addEndUser({ projectId: P1, env: "test" }, "u1");
    const d = store.addDevice({ projectId: P1, env: "test" }, { kind: "glasses", end_user_id: user });
    const res = await get(d.id, pk);
    expect(res.status).toBe(403);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBeDefined();
  });

  it("refuses a secret key without devices:read", async () => {
    const narrow = (await mintApiKey({ projectId: P1, env: "test", kind: "secret", scopes: ["actions:write"] })).secret;
    expect((await get("x", narrow)).status).toBe(403);
  });
});
