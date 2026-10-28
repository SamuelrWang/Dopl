/**
 * The Device SDK Connect claim path in the pairing core (A4) and the guarantee that came with it:
 * PROSUMER PAIRING IS UNCHANGED, with or without a `connect` port wired.
 */
import { describe, expect, it, vi } from "vitest";
import { createFakeDeviceStore } from "../testing/fake-device-store";
import { fakeClock } from "../testing/fake-store";
import { PAIRING_TTL_MS, claimPairing, claimPairingForConnect, pairingStatus, startPairing, type ConnectPairingPort } from "./pairing";

const OWNER = "22222222-2222-4222-8222-222222222222";
const SDK_DEVICE = "44444444-4444-4444-8444-444444444444";

function setup() {
  const fake = createFakeDeviceStore();
  const clock = fakeClock();
  const claimed = new Map<string, string>();
  const port: ConnectPairingPort = {
    claimPairing: vi.fn(async (id: string, deviceId: string, now: string) => {
      const p = fake.pairings.find((x) => x.id === id && x.status === "pending" && x.expires_at > now);
      if (!p) return false;
      p.status = "claimed";
      claimed.set(id, deviceId);
      return true;
    }),
    sdkDeviceFor: vi.fn(async (id: string) => claimed.get(id) ?? null),
    setTokenHash: vi.fn(async () => {}),
  };
  return { ...fake, clock, port, deps: { devices: fake.devices, now: clock.now, code: () => "ABC234" } };
}

describe("prosumer pairing with a connect port wired", () => {
  it("claims, polls and issues the token exactly as before; the port is never consulted", async () => {
    const s = setup();
    const deps = { ...s.deps, connect: s.port };
    const started = await startPairing(deps);
    const device = await claimPairing(deps, OWNER, { code: "abc234" });
    const first = await pairingStatus(deps, started.pair_id, started.poll_secret);
    expect(first).toMatchObject({ status: "claimed", device_id: device.id });
    expect(await pairingStatus(deps, started.pair_id, started.poll_secret)).toEqual({ status: "claimed" });
    expect(s.port.sdkDeviceFor).not.toHaveBeenCalled();
    expect(s.port.setTokenHash).not.toHaveBeenCalled();
  });
});

describe("claimPairingForConnect", () => {
  it("claims with no prosumer device; the glasses' poll mints a token for the SDK device once", async () => {
    const s = setup();
    const deps = { ...s.deps, connect: s.port };
    const started = await startPairing(deps);
    const out = await claimPairingForConnect(deps, {
      code: "ABC-234",
      createDevice: async () => SDK_DEVICE,
      discardDevice: async () => {},
    });
    expect(out).toEqual({ device_id: SDK_DEVICE });
    expect(s.deviceRows).toHaveLength(0);
    const polled = await pairingStatus(deps, started.pair_id, started.poll_secret);
    expect(polled).toMatchObject({ status: "claimed", device_id: SDK_DEVICE });
    expect(s.port.setTokenHash).toHaveBeenCalledWith(SDK_DEVICE, expect.stringMatching(/^[0-9a-f]{64}$/), expect.any(String));
    expect(await pairingStatus(deps, started.pair_id, started.poll_secret)).toEqual({ status: "claimed" });
  });

  it("without the port wired, a Connect-claimed pairing answers a bare `claimed` (no token leaks elsewhere)", async () => {
    const s = setup();
    const started = await startPairing(s.deps);
    await claimPairingForConnect({ ...s.deps, connect: s.port }, { code: "ABC234", createDevice: async () => SDK_DEVICE, discardDevice: async () => {} });
    expect(await pairingStatus(s.deps, started.pair_id, started.poll_secret)).toEqual({ status: "claimed" });
  });

  it("refuses an expired or unknown code and discards the device when the claim race is lost", async () => {
    const s = setup();
    const deps = { ...s.deps, connect: s.port };
    await startPairing(deps);
    const discard = vi.fn(async () => {});
    s.port.claimPairing = vi.fn(async () => false);
    await expect(claimPairingForConnect(deps, { code: "ABC234", createDevice: async () => SDK_DEVICE, discardDevice: discard })).rejects.toMatchObject({
      status: 409,
    });
    expect(discard).toHaveBeenCalledWith(SDK_DEVICE, expect.any(String));
    s.clock.advance(PAIRING_TTL_MS + 1);
    await expect(claimPairingForConnect(deps, { code: "ABC234", createDevice: async () => SDK_DEVICE, discardDevice: discard })).rejects.toMatchObject({
      status: 404,
    });
    await expect(claimPairingForConnect(deps, { code: "x", createDevice: async () => SDK_DEVICE, discardDevice: discard })).rejects.toMatchObject({
      status: 400,
    });
  });
});
