import { describe, expect, it } from "vitest";
import {
  PAIRING_CODE_ALPHABET,
  generatePairingCode,
  hashCredential,
  normalizePairingCode,
} from "./credentials";
import { corsHeaders, pluginOrigins } from "./cors";
import { createFakeDeviceStore, fakeLinker } from "./fake-device-store";
import { fakeClock } from "./fake-store";
import { PAIRING_TTL_MS, claimPairing, pairingStatus, startPairing } from "./pairing-service";

const OWNER = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "33333333-3333-4333-8333-333333333333";

function setup(codes?: string[]) {
  const fake = createFakeDeviceStore();
  const clock = fakeClock();
  const linker = fakeLinker({ [CHANNEL]: { name: "AI Glasses", members: [OWNER] } });
  const queue = codes ? [...codes] : null;
  const deps = { devices: fake.devices, linker, now: clock.now, code: queue ? () => queue.shift()! : undefined };
  return { ...fake, clock, deps };
}

describe("credentials", () => {
  it("draws codes from the unambiguous 32-symbol alphabet", () => {
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32);
    expect(PAIRING_CODE_ALPHABET).not.toMatch(/[IO01]/);
    expect(generatePairingCode(new Uint8Array([0, 31, 32, 63, 255, 8]))).toBe("A9A99J");
    for (let i = 0; i < 50; i++) expect(generatePairingCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("normalizes what a person types", () => {
    expect(normalizePairingCode(" abc-23d ")).toBe("ABC23D");
    expect(normalizePairingCode("ABC1OD")).toBeNull();
    expect(normalizePairingCode("ABC")).toBeNull();
  });

  it("hashes with sha256 hex", () => {
    expect(hashCredential("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("cors", () => {
  const req = (origin: string) => new Request("http://x/api/glasses/device/inbox", { headers: { origin } });
  it("defaults to * (bearer-only routes) and narrows when configured", () => {
    expect(pluginOrigins({})).toEqual(["*"]);
    expect(corsHeaders(req("https://any.test"), ["*"])["Access-Control-Allow-Origin"]).toBe("*");
    const list = pluginOrigins({ GLASSES_PLUGIN_ORIGINS: "https://a.test/, http://127.0.0.1:5180" });
    expect(list).toEqual(["https://a.test", "http://127.0.0.1:5180"]);
    expect(corsHeaders(req("http://127.0.0.1:5180"), list)["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:5180");
    expect(corsHeaders(req("http://evil.test"), list)["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

describe("pairing", () => {
  it("start → claim → status returns the device token exactly once", async () => {
    const { deps, deviceRows } = setup();
    const start = await startPairing(deps);
    expect(start.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(Date.parse(start.expires_at) - deps.now()).toBe(PAIRING_TTL_MS);
    expect(await pairingStatus(deps, start.pair_id, start.poll_secret)).toMatchObject({ status: "pending" });

    const device = await claimPairing(deps, OWNER, { code: start.code.toLowerCase(), name: " Lens ", channel_id: CHANNEL });
    expect(device).toMatchObject({ name: "Lens", platform: "even_g2", linked_channel: { id: CHANNEL, name: "AI Glasses" } });
    expect(deviceRows[0].token_hash).toBeNull();

    const first = await pairingStatus(deps, start.pair_id, start.poll_secret);
    expect(first).toMatchObject({ status: "claimed", device_id: device.id });
    const token = (first as { device_token: string }).device_token;
    expect(token).toMatch(/^glsdt_/);
    expect(deviceRows[0].token_hash).toBe(hashCredential(token));
    expect(JSON.stringify(deviceRows)).not.toContain(token);

    // A second poll never gets a second copy: bare `claimed` tells the device to pair again.
    expect(await pairingStatus(deps, start.pair_id, start.poll_secret)).toEqual({ status: "claimed" });
  });

  it("refuses a wrong poll secret or unknown pair as 404", async () => {
    const { deps } = setup();
    const start = await startPairing(deps);
    await expect(pairingStatus(deps, start.pair_id, "nope")).rejects.toMatchObject({ status: 404 });
    await expect(pairingStatus(deps, "not-a-uuid", start.poll_secret)).rejects.toMatchObject({ status: 404 });
  });

  it("expires after 10 minutes, and an expired code cannot be claimed", async () => {
    const { deps, clock } = setup();
    const start = await startPairing(deps);
    clock.advance(PAIRING_TTL_MS + 1);
    expect(await pairingStatus(deps, start.pair_id, start.poll_secret)).toEqual({ status: "expired" });
    await expect(claimPairing(deps, OWNER, { code: start.code })).rejects.toMatchObject({ status: 404 });
  });

  it("retries a colliding code", async () => {
    const { deps } = setup(["AAAAAA", "AAAAAA", "BBBBBB"]);
    expect((await startPairing(deps)).code).toBe("AAAAAA");
    expect((await startPairing(deps)).code).toBe("BBBBBB");
  });

  it("will not link a channel the claimant is not a member of", async () => {
    const { deps, deviceRows } = setup();
    const start = await startPairing(deps);
    await expect(
      claimPairing(deps, "44444444-4444-4444-8444-444444444444", { code: start.code, channel_id: CHANNEL }),
    ).rejects.toMatchObject({ status: 404, code: "CHANNEL_NOT_FOUND" });
    expect(deviceRows).toHaveLength(0);
  });

  it("rejects malformed codes and double claims", async () => {
    const { deps, deviceRows } = setup();
    await expect(claimPairing(deps, OWNER, { code: "!!" })).rejects.toMatchObject({ status: 400 });
    const start = await startPairing(deps);
    await claimPairing(deps, OWNER, { code: start.code });
    await expect(claimPairing(deps, OWNER, { code: start.code })).rejects.toMatchObject({ status: 404 });
    expect(deviceRows.filter((d) => d.revoked_at === null)).toHaveLength(1);
  });
});
