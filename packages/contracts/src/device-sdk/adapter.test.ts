import { describe, expect, it } from "vitest";

import { ADAPTER_TRANSPORTS, AdapterTransportSchema, type DeviceAdapter } from "./adapter.js";
import { G2_DEVICE } from "./test-fixtures.js";

/** A minimal in-memory adapter: proves the interface is implementable as written. */
const fake: DeviceAdapter = {
  id: "sim",
  version: "0.1.0",
  kinds: ["glasses"],
  transport: "phone_bridge_ble",
  experimental: false,
  describe: (d) => d.capabilities,
  pair: async () => ({ method: "code", code: "ABC123", expires_at: "2026-10-27T12:10:00.000Z" }),
  execute: async () => ({ status: "done", result: { ok: true }, error: null }),
  async *events(device) {
    yield { type: "input.utterance", device_id: device.id, ts: "2026-10-27T12:00:00.000Z", data: { text: "hi" } };
  },
  health: async () => ({ online: true, last_seen: null, firmware: "1.4.2" }),
};

describe("C9 adapter", () => {
  it("transports are the spec's five", () => {
    expect(ADAPTER_TRANSPORTS).toEqual(["cloud_oauth", "phone_bridge_ble", "on_device_runtime", "local_bridge", "os_registry"]);
    expect(AdapterTransportSchema.parse(fake.transport)).toBe("phone_bridge_ble");
  });

  it("a fake adapter satisfies the interface end to end", async () => {
    expect(fake.describe(G2_DEVICE)).toHaveLength(2);
    expect((await fake.pair({ connect_session_id: "cs", project_id: "p", external_user_id: "u", env: "test" })).method).toBe("code");
    expect((await fake.execute(G2_DEVICE, "present.display", {})).status).toBe("done");
    const seen = [];
    for await (const e of fake.events(G2_DEVICE)) seen.push(e.type);
    expect(seen).toEqual(["input.utterance"]);
    expect((await fake.health(G2_DEVICE)).online).toBe(true);
  });
});
