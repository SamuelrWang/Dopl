import { DEVICE_KINDS, type DeviceAdapter } from "@dopl/device-contracts";
import { describe, expect, it } from "vitest";

import { glassesPlatform } from "@/features/glasses/platforms/registry";

import { createEvenG2Adapter } from "./even-g2";
import { createAdapterRegistry, deviceAdapters } from "./registry";

const ids = (as: DeviceAdapter[]) => as.map((a) => a.id);

describe("device adapter registry", () => {
  it("looks adapters up by id, with no fallback for an unknown one", () => {
    expect(deviceAdapters.get("even_g2")?.kinds).toEqual(["glasses"]);
    expect(deviceAdapters.get("desktop")?.kinds).toEqual(["desktop"]);
    expect(deviceAdapters.get("simulator")?.kinds).toEqual([...DEVICE_KINDS]);
    expect(deviceAdapters.get("meta_rayban")).toBeNull();
  });

  it("the even_g2 adapter id is the prosumer glasses platform id", () => {
    expect(glassesPlatform("even_g2").id).toBe(deviceAdapters.get("even_g2")?.id);
  });

  it("offers the simulator in test only", () => {
    expect(ids(deviceAdapters.list({ env: "test" }))).toEqual(["even_g2", "desktop", "simulator"]);
    expect(ids(deviceAdapters.list({ env: "live" }))).toEqual(["even_g2", "desktop"]);
    expect(ids(deviceAdapters.forKind("glasses", { env: "test" }))).toEqual(["even_g2", "simulator"]);
    expect(ids(deviceAdapters.forKind("robot", { env: "live" }))).toEqual([]);
  });

  it("D6: hides experimental adapters unless asked", () => {
    const re: DeviceAdapter = { ...createEvenG2Adapter(), id: "re_glasses", experimental: true };
    const reg = createAdapterRegistry([createEvenG2Adapter(), re]);
    expect(ids(reg.list({ env: "live" }))).toEqual(["even_g2"]);
    expect(ids(reg.list({ env: "live", includeExperimental: true }))).toEqual(["even_g2", "re_glasses"]);
    expect(reg.get("re_glasses")).toBe(re);
  });

  it("rejects duplicate ids", () => {
    expect(() => createAdapterRegistry([createEvenG2Adapter(), createEvenG2Adapter()])).toThrow(/duplicate/);
  });
});
