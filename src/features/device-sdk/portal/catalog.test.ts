import { describe, expect, it } from "vitest";
import { createDesktopAdapter } from "../adapters/desktop";
import { createEvenG2Adapter } from "../adapters/even-g2";
import { createGoogleHomeAdapter } from "../adapters/google-home";
import { ALL_MODELS, INTEGRATIONS, modelOfAdapter } from "./catalog";

const device = { id: "d", kind: "glasses", vendor: "", model: "", firmware: null, adapter_id: "", adapter_version: "", capabilities: [], online: false, last_seen_at: null } as never;

describe("the portal's catalog", () => {
  it.each([
    ["g2", createEvenG2Adapter()],
    ["macos", createDesktopAdapter()],
    ["google_speaker", createGoogleHomeAdapter()],
  ] as const)("%s lists what its adapter publishes", (id, adapter) => {
    const model = ALL_MODELS.find((m) => m.id === id)!;
    expect([...model.capabilities].sort()).toEqual(adapter.describe(device).map((d) => d.capability).sort());
    expect(INTEGRATIONS.find((i) => i.id === model.integrationId)?.adapter).toBe(`${adapter.id}@${adapter.version}`);
  });

  it("maps a device row by its adapter, and an unknown adapter to nothing", () => {
    expect(modelOfAdapter("even_g2")).toBe("g2");
    expect(modelOfAdapter("nope")).toBeNull();
  });
});
