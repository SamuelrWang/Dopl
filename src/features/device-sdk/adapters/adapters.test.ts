import {
  CAPABILITY_RISK_TIER,
  CapabilityDescriptorSchema,
  DEVICE_KINDS,
  ErrorBodySchema,
  PresentDisplayLimitsSchema,
  type Device,
  type DeviceAdapter,
} from "@dopl/contracts/device-sdk";
import { describe, expect, it, vi } from "vitest";

import { evenG2 } from "@/features/glasses/platforms/even-g2";
import { CONTENT_H, SCREEN_LIMITS, SCREEN_W } from "@/features/glasses/platforms/even-g2/display";

import { createDesktopAdapter } from "./desktop";
import { createEvenG2Adapter } from "./even-g2";
import { AdapterNotWiredError } from "./shared";
import { createSimulatorAdapter } from "./simulator";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const now = () => NOW;

function device(over: Partial<Device>): Device {
  return {
    id: "dev_1",
    kind: "glasses",
    vendor: "even_realities",
    model: "even_g2",
    firmware: "1.4.2",
    adapter_id: "even_g2",
    adapter_version: "0.1.0",
    capabilities: [],
    online: true,
    last_seen_at: new Date(NOW - 10_000).toISOString(),
    ...over,
  };
}

const G2 = device({});
const MAC = device({ id: "dev_2", kind: "desktop", vendor: "apple", model: "macos", adapter_id: "desktop" });

function expectValid(adapter: DeviceAdapter, d: Device) {
  const ds = adapter.describe(d);
  expect(ds.length).toBeGreaterThan(0);
  for (const x of ds) {
    expect(CapabilityDescriptorSchema.parse(x)).toEqual(x);
    expect(x.risk_tier).toBe(CAPABILITY_RISK_TIER[x.capability]);
    expect(x.since_adapter).toBe(`${adapter.id}@${adapter.version}`);
  }
  expect(new Set(ds.map((x) => x.capability)).size).toBe(ds.length);
}

describe("even_g2 adapter", () => {
  const a = createEvenG2Adapter({ now });

  it("D6: official Even Hub runtime, not experimental", () => {
    expect(a).toMatchObject({ id: "even_g2", kinds: ["glasses"], transport: "on_device_runtime", experimental: false });
  });

  it("describe() is zod-valid and snapshotted", () => {
    expectValid(a, G2);
    expect(a.describe(G2)).toMatchSnapshot();
  });

  it("present.display limits are derived from the platform's own constants", () => {
    const display = a.describe(G2).find((d) => d.capability === "present.display");
    expect(display?.limits).toMatchObject({
      width_px: SCREEN_W,
      height_px: CONTENT_H,
      max_blocks: SCREEN_LIMITS.max_blocks,
      max_text_bytes: SCREEN_LIMITS.text_bytes,
    });
    expect(PresentDisplayLimitsSchema.safeParse(display?.limits).success).toBe(true);
  });

  it("leaves the prosumer GlassesPlatform untouched", () => {
    expect(evenG2.id).toBe("even_g2");
    expect(evenG2.screenLimits).toBe(SCREEN_LIMITS);
    expect(evenG2.capabilities()).toMatchObject({ content: { width: SCREEN_W, height: CONTENT_H } });
  });

  it("health uses the prosumer online window", async () => {
    expect(await a.health(G2)).toEqual({ online: true, last_seen: G2.last_seen_at, firmware: "1.4.2" });
    const stale = device({ last_seen_at: new Date(NOW - 61_000).toISOString() });
    expect((await a.health(stale)).online).toBe(false);
    expect((await a.health(device({ last_seen_at: null }))).online).toBe(false);
  });

  it("execute: unsupported capability → C10 capability_unsupported", async () => {
    const r = await a.execute(G2, "act.lock", {});
    expect(r.status).toBe("failed");
    expect(ErrorBodySchema.parse(r.error)).toMatchObject({ code: "capability_unsupported", device_kind: "glasses", retryable: false });
  });

  it("execute: blocks over the G2 budget → invalid_request, before any dispatch", async () => {
    const dispatch = vi.fn();
    const wired = createEvenG2Adapter({ now, dispatch });
    const blocks = Array.from({ length: 13 }, (_, i) => ({ id: `b${i}`, type: "divider" }));
    const r = await wired.execute(G2, "present.display", { blocks });
    expect(r.error?.code).toBe("invalid_request");
    expect(dispatch).not.toHaveBeenCalled();
    const bad = await wired.execute(G2, "ask.choice", { options: [{ label: "a" }] });
    expect(bad.error?.code).toBe("invalid_request");
  });

  it("execute: valid args go to the dispatch port; an unwired port throws", async () => {
    const dispatch = vi.fn().mockResolvedValue({ status: "delivered", result: null, error: null });
    const wired = createEvenG2Adapter({ now, dispatch });
    const args = { blocks: [{ id: "h", type: "heading", text: "Hi" }] };
    expect((await wired.execute(G2, "present.display", args)).status).toBe("delivered");
    expect(dispatch).toHaveBeenCalledWith(G2, "present.display", args);
    await expect(a.execute(G2, "present.display", args)).rejects.toBeInstanceOf(AdapterNotWiredError);
    await expect(a.pair({ connect_session_id: "cs", project_id: "p", external_user_id: "u", env: "test" })).rejects.toBeInstanceOf(
      AdapterNotWiredError
    );
  });

  it("events: none without a source", async () => {
    const seen = [];
    for await (const e of a.events(G2)) seen.push(e);
    expect(seen).toEqual([]);
  });
});

describe("desktop adapter", () => {
  const a = createDesktopAdapter({ now });

  it("presence + notify only, zod-valid and snapshotted", () => {
    expect(a).toMatchObject({ id: "desktop", kinds: ["desktop"], transport: "on_device_runtime", experimental: false });
    expectValid(a, MAC);
    expect(a.describe(MAC).map((d) => d.capability)).toEqual(["presence.read", "present.notify"]);
    expect(a.describe(MAC)).toMatchSnapshot();
  });

  it("health uses the computer online window (150s)", async () => {
    expect((await a.health(device({ ...MAC, last_seen_at: new Date(NOW - 149_000).toISOString() }))).online).toBe(true);
    expect((await a.health(device({ ...MAC, last_seen_at: new Date(NOW - 151_000).toISOString() }))).online).toBe(false);
  });

  it("execute: display is unsupported", async () => {
    expect((await a.execute(MAC, "present.display", {})).error?.code).toBe("capability_unsupported");
  });
});

describe("simulator adapter descriptors", () => {
  const a = createSimulatorAdapter({ now });

  it("serves every DeviceKind", () => {
    expect(a.kinds).toEqual([...DEVICE_KINDS]);
  });

  it.each(DEVICE_KINDS)("%s: zod-valid and snapshotted", (kind) => {
    const d = device({ kind, adapter_id: "simulator" });
    expectValid(a, d);
    expect(a.describe(d)).toMatchSnapshot();
  });
});
