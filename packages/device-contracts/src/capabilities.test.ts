import { describe, expect, it } from "vitest";

import {
  CAPABILITY_FAMILY,
  CAPABILITY_IDS,
  CAPABILITY_RISK_TIER,
  CapabilityDescriptorSchema,
  CapabilityScopeSchema,
  DEVICE_KINDS,
  DeviceSchema,
  PresentDisplayLimitsSchema,
  RISK_TIERS,
  RISK_TIER_DEFAULT_POLICY,
} from "./capabilities.js";
import { G2_DEVICE, expectRoundTrip } from "./test-fixtures.js";

describe("C3 capabilities", () => {
  it("every capability has a family and a default risk tier", () => {
    for (const id of CAPABILITY_IDS) {
      expect(CAPABILITY_FAMILY[id]).toBeDefined();
      expect(RISK_TIERS).toContain(CAPABILITY_RISK_TIER[id]);
    }
    expect(Object.keys(CAPABILITY_RISK_TIER).sort()).toEqual([...CAPABILITY_IDS].sort());
  });

  it("pins the spec's tiers per family", () => {
    const tierOfFamily = (f: string) =>
      new Set(CAPABILITY_IDS.filter((id) => CAPABILITY_FAMILY[id] === f).map((id) => CAPABILITY_RISK_TIER[id]));
    expect(tierOfFamily("state")).toEqual(new Set(["T0"]));
    expect(tierOfFamily("present")).toEqual(new Set(["T1"]));
    expect(tierOfFamily("ask")).toEqual(new Set(["T1"]));
    expect(tierOfFamily("capture")).toEqual(new Set(["T2"]));
    expect(tierOfFamily("input")).toEqual(new Set(["T1"]));
    expect(tierOfFamily("act.motion")).toEqual(new Set(["T4"]));
    expect(CAPABILITY_RISK_TIER["act.lock"]).toBe("T4");
    expect(CAPABILITY_RISK_TIER["act.set"]).toBe("T3");
  });

  it("every tier has a default policy; T4 confirms every call", () => {
    for (const t of RISK_TIERS) expect(RISK_TIER_DEFAULT_POLICY[t]).toBeTruthy();
    expect(RISK_TIER_DEFAULT_POLICY.T4).toBe("confirm_every_call");
  });

  it("device kinds are the closed v1 set", () => {
    expect(DEVICE_KINDS).toEqual(["glasses", "phone", "desktop", "watch", "home_hub", "home_device", "vehicle", "robot"]);
  });

  it("scopes accept ids and family wildcards only", () => {
    for (const ok of ["present.display", "present.*", "act.motion.*", "state.*"]) expect(CapabilityScopeSchema.safeParse(ok).success).toBe(true);
    for (const bad of ["*", "present", "nope.*", "present.display.*", "act.motion"]) expect(CapabilityScopeSchema.safeParse(bad).success).toBe(false);
  });

  it("round-trips the spec's descriptor example and a device", () => {
    expectRoundTrip(CapabilityDescriptorSchema, G2_DEVICE.capabilities[0]!);
    expect(PresentDisplayLimitsSchema.safeParse(G2_DEVICE.capabilities[0]!.limits).success).toBe(true);
    expectRoundTrip(DeviceSchema, G2_DEVICE);
  });

  it("rejects a bad since_adapter and an unknown capability", () => {
    expect(CapabilityDescriptorSchema.safeParse({ ...G2_DEVICE.capabilities[0], since_adapter: "even_g2" }).success).toBe(false);
    expect(CapabilityDescriptorSchema.safeParse({ ...G2_DEVICE.capabilities[0], capability: "present.hologram" }).success).toBe(false);
  });
});
