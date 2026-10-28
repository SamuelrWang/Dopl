import { describe, expect, it } from "vitest";
import { DeviceActionRequestSchema, DeliverRequestSchema, DeliverResponseSchema, DeviceContextSchema, ActionSchema } from "@dopl/device-contracts";
import type { CapabilityId } from "@dopl/device-contracts";
import { NOT_CONNECTED, addType, goLive, recordTests, removeType, stepOwnDevice, type CapabilityTest } from "./device-type-status";
import { ADDABLE_TYPES, DEVICE_TYPES, deviceType, endpointFor, seedState, simulate } from "./device-types";
import { describeAll, describeType } from "./device-descriptors";

const CAPS: CapabilityId[] = ["presence.read", "present.notify", "ask.choice"];
const result = (capability: CapabilityId, passed = true): CapabilityTest => ({ capability, passed, latency_ms: 50, request: {}, response: {} });

describe("device type status machine", () => {
  it("add moves not connected to added, and only from there", () => {
    const added = addType(NOT_CONNECTED);
    expect(added.status).toBe("added");
    expect(addType(added)).toBe(added);
  });

  it("tests are ignored until the type is added", () => {
    expect(recordTests(NOT_CONNECTED, [result("presence.read")], CAPS)).toBe(NOT_CONNECTED);
  });

  it("connects only when every capability has passed", () => {
    let s = addType(NOT_CONNECTED);
    s = recordTests(s, [result("presence.read"), result("present.notify")], CAPS);
    expect(s.status).toBe("added");
    s = recordTests(s, [result("ask.choice")], CAPS);
    expect(s.status).toBe("connected");
  });

  it("a failing retest drops back to added and takes the type out of live", () => {
    let s = recordTests(addType(NOT_CONNECTED), CAPS.map((c) => result(c)), CAPS);
    s = goLive(s);
    expect(s.live).toBe(true);
    s = recordTests(s, [result("present.notify", false)], CAPS);
    expect(s).toMatchObject({ status: "added", live: false });
  });

  it("go live needs connected; remove resets everything", () => {
    const added = addType(NOT_CONNECTED);
    expect(goLive(added).live).toBe(false);
    const connected = recordTests(added, CAPS.map((c) => result(c)), CAPS);
    expect(removeType()).toEqual(NOT_CONNECTED);
    expect(goLive(connected).live).toBe(true);
  });

  it("own-device test: link, then paired, only once added", () => {
    expect(stepOwnDevice(NOT_CONNECTED)).toBe(NOT_CONNECTED);
    const link = stepOwnDevice(addType(NOT_CONNECTED));
    expect(link.ownDevice).toBe("link");
    expect(stepOwnDevice(link).ownDevice).toBe("paired");
  });
});

describe("device type catalog", () => {
  it("every addable type has registry descriptors; coming-soon types have none", () => {
    for (const t of ADDABLE_TYPES) expect(describeType(t.id)?.length).toBeGreaterThan(0);
    for (const t of DEVICE_TYPES.filter((x) => x.availability === "coming_soon")) expect(describeType(t.id)).toBeNull();
  });

  it("a simulated test is the real /v1 call, contract-shaped", () => {
    const all = describeAll();
    for (const t of ADDABLE_TYPES) {
      for (const d of all[t.id]) {
        const r = simulate(t, d) as CapabilityTest & { request: { body?: unknown }; response: unknown };
        expect(r.passed).toBe(true);
        const e = endpointFor(d.capability);
        if (e.via === "deliver") {
          DeliverRequestSchema.parse(r.request.body);
          DeliverResponseSchema.parse(r.response);
        } else if (e.via === "context") DeviceContextSchema.parse(r.response);
        else if (e.via === "action") {
          DeviceActionRequestSchema.parse(r.request.body);
          ActionSchema.parse(r.response);
        }
      }
    }
  });

  it("seeds: Even G2 not connected, desktop added, simulator connected with every test passed", () => {
    expect(seedState("even_g2", describeType("even_g2")).status).toBe("not_connected");
    expect(seedState("desktop", describeType("desktop")).status).toBe("added");
    const sim = seedState("simulator", describeType("simulator"));
    expect(sim.status).toBe("connected");
    expect(Object.keys(sim.tests)).toHaveLength(describeType("simulator")!.length);
    expect(deviceType("meta_glasses")?.adapter_id).toBeNull();
  });
});
