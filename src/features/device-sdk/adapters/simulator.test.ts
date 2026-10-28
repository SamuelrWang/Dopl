import { ErrorBodySchema, TEST_MAGIC_DEVICE_IDS, type Device } from "@dopl/device-contracts";
import { describe, expect, it } from "vitest";

import { createSimulatorAdapter, magicFailure } from "./simulator";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const sim = createSimulatorAdapter({ now: () => NOW });

const dev = (id: string, kind: Device["kind"] = "phone"): Device => ({
  id,
  kind,
  vendor: "dopl",
  model: "simulated",
  firmware: "sim-1",
  adapter_id: "simulator",
  adapter_version: "0.1.0",
  capabilities: [],
  online: true,
  last_seen_at: null,
});

describe("simulator magic failure ids (C10)", () => {
  it("every contract magic id maps to its error code, exactly or with a suffix", () => {
    for (const [magic, code] of Object.entries(TEST_MAGIC_DEVICE_IDS)) {
      expect(magicFailure(magic)).toBe(code);
      expect(magicFailure(`${magic}_42`)).toBe(code);
    }
    expect(magicFailure("dev_ordinary")).toBeNull();
    expect(magicFailure("sim_device_offlineX")).toBeNull();
  });

  it("sim_device_offline: execute fails device_offline (retryable) and health is offline", async () => {
    const d = dev("sim_device_offline");
    const r = await sim.execute(d, "present.notify", {});
    expect(r.status).toBe("failed");
    expect(ErrorBodySchema.parse(r.error)).toMatchObject({ code: "device_offline", type: "device_error", retryable: true, device_kind: "phone" });
    expect(await sim.health(d)).toEqual({ online: false, last_seen: null, firmware: "sim-1" });
  });

  it("sim_confirm_denied: execute fails confirmation_denied, device stays online", async () => {
    const d = dev("sim_confirm_denied_lock", "home_device");
    const r = await sim.execute(d, "act.lock", { locked: true });
    expect(ErrorBodySchema.parse(r.error)).toMatchObject({ code: "confirmation_denied", type: "permission_error", retryable: false });
    expect((await sim.health(d)).online).toBe(true);
  });
});

describe("simulator ordinary devices", () => {
  it("completes supported capabilities with a simulated result", async () => {
    const d = dev("sim_phone");
    expect(await sim.execute(d, "present.notify", { text: "hi" })).toEqual({ status: "done", result: { simulated: true }, error: null });
    const ask = await sim.execute(d, "ask.choice", { options: [{ label: "Yes" }, { label: "No" }] });
    expect(ask.result).toEqual({ simulated: true, index: 0, label: "Yes" });
  });

  it("rejects a capability its kind lacks, and bad display blocks", async () => {
    expect((await sim.execute(dev("r", "robot"), "present.display", {})).error?.code).toBe("capability_unsupported");
    expect((await sim.execute(dev("p"), "present.display", { blocks: [] })).error?.code).toBe("invalid_request");
  });

  it("health is online at now; pairing is a deterministic code flow", async () => {
    expect(await sim.health(dev("ok"))).toEqual({ online: true, last_seen: new Date(NOW).toISOString(), firmware: "sim-1" });
    expect(await sim.pair({ connect_session_id: "cs", project_id: "p", external_user_id: "u", env: "test" })).toEqual({
      method: "code",
      code: "SIM234",
      expires_at: new Date(NOW + 600_000).toISOString(),
    });
  });
});
