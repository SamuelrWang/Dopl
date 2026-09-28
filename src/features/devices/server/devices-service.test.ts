import { describe, expect, it } from "vitest";
import {
  COMPUTER_ONLINE_WINDOW_MS,
  heartbeat,
  isComputerOnline,
  legacyComputerName,
  listComputers,
  removeComputer,
  resolveRequestDevice,
  type DevicesDeps,
} from "./devices-service";
import type {
  DesktopDeviceRow,
  DesktopDeviceStore,
  DeviceTokenRow,
  HeartbeatInput,
} from "./desktop-devices-types";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const USER = "user-1";
const INSTALL = "0b8f3c1e-2d4a-4f6b-9c8d-1a2b3c4d5e6f";
const OTHER_INSTALL = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

interface FakeToken extends DeviceTokenRow {
  user_id: string;
  revoked_at: string | null;
}

function fakeStore(seed: { devices?: DesktopDeviceRow[]; tokens?: FakeToken[] } = {}) {
  const devices = [...(seed.devices ?? [])];
  const tokens = [...(seed.tokens ?? [])];
  let seq = devices.length;
  const store: DesktopDeviceStore = {
    async findByInstall(userId, installId) {
      return devices.find((d) => d.user_id === userId && d.install_id === installId) ?? null;
    },
    async upsert(userId, input, now) {
      let row = devices.find((d) => d.user_id === userId && d.install_id === input.installId);
      if (!row) {
        row = {
          id: `00000000-0000-4000-8000-00000000000${++seq}`,
          user_id: userId,
          install_id: input.installId,
          created_at: now,
          revoked_at: null,
        } as DesktopDeviceRow;
        devices.push(row);
      }
      Object.assign(row, {
        name: input.name,
        platform: input.platform,
        os_version: input.osVersion ?? null,
        app_version: input.appVersion ?? null,
        arch: input.arch ?? null,
        status: input.status,
        last_seen: now,
      });
      return row;
    },
    async listActive(userId) {
      return devices.filter((d) => d.user_id === userId && !d.revoked_at);
    },
    async listDeviceTokens(userId) {
      return tokens.filter((t) => t.user_id === userId && !t.revoked_at);
    },
    async linkTokensByLabel(userId, deviceId, label) {
      for (const t of tokens) {
        if (t.user_id === userId && t.client_name === label && !t.device_id && !t.revoked_at) {
          t.device_id = deviceId;
        }
      }
    },
    async revoke(userId, deviceId, now) {
      const row = devices.find((d) => d.user_id === userId && d.id === deviceId && !d.revoked_at);
      if (!row) return false;
      row.revoked_at = now;
      return true;
    },
    async revokeLinkedTokens(userId, deviceId, now) {
      const hit = tokens.filter((t) => t.user_id === userId && t.device_id === deviceId && !t.revoked_at);
      hit.forEach((t) => (t.revoked_at = now));
      return hit.length;
    },
    async revokeLegacyToken(userId, tokenId, now) {
      const token = tokens.find((t) => t.user_id === userId && t.id === tokenId && !t.device_id && !t.revoked_at);
      if (!token) return 0;
      const hit = tokens.filter(
        (t) => t.user_id === userId && !t.device_id && !t.revoked_at && t.client_name === token.client_name
      );
      hit.forEach((t) => (t.revoked_at = now));
      return hit.length;
    },
  };
  return { store, devices, tokens };
}

const deps = (store: DesktopDeviceStore): DevicesDeps => ({ store, now: () => NOW });

const beat = (over: Partial<HeartbeatInput> = {}): HeartbeatInput => ({
  installId: INSTALL,
  name: "Samuel's MacBook Pro",
  platform: "macos",
  osVersion: "26.1",
  appVersion: "1.38.0",
  status: "active",
  ...over,
});

const token = (over: Partial<FakeToken>): FakeToken => ({
  id: "11111111-1111-4111-8111-111111111111",
  user_id: USER,
  client_name: "Dopl Desktop CLI (Samuels-MacBook-Pro-2.local)",
  device_id: null,
  last_used_at: "2026-09-27T10:00:00.000Z",
  created_at: "2026-09-01T10:00:00.000Z",
  revoked_at: null,
  ...over,
});

describe("computer online state", () => {
  const at = (ms: number) => new Date(NOW - ms).toISOString();
  it("is online inside the window and not offline", () => {
    expect(isComputerOnline({ status: "active", last_seen: at(10_000) }, NOW)).toBe(true);
    expect(isComputerOnline({ status: "away", last_seen: at(10_000) }, NOW)).toBe(true);
  });
  it("is offline past the window, when it said so, or when never seen", () => {
    expect(isComputerOnline({ status: "active", last_seen: at(COMPUTER_ONLINE_WINDOW_MS + 1) }, NOW)).toBe(false);
    expect(isComputerOnline({ status: "offline", last_seen: at(1_000) }, NOW)).toBe(false);
    expect(isComputerOnline({ status: "active", last_seen: null }, NOW)).toBe(false);
  });
});

describe("legacyComputerName", () => {
  it("reads the host out of the desktop's device-token label", () => {
    expect(legacyComputerName("Dopl Desktop CLI (Samuels-MacBook-Pro-2.local)")).toBe("Samuels-MacBook-Pro-2");
    expect(legacyComputerName("Dopl Desktop CLI (mac.lan)")).toBe("mac");
    expect(legacyComputerName("Dopl Desktop CLI")).toBe("Computer");
    expect(legacyComputerName("some-script")).toBe("some-script");
    expect(legacyComputerName(null)).toBe("Computer");
  });
});

describe("heartbeat", () => {
  it("registers a computer, then refreshes the same row", async () => {
    const { store, devices } = fakeStore();
    const first = await heartbeat(deps(store), USER, beat());
    const second = await heartbeat(deps(store), USER, beat({ status: "away" }));
    expect(first).toEqual({ device: { id: devices[0].id, revoked: false } });
    expect(second).toEqual(first);
    expect(devices).toHaveLength(1);
    expect(devices[0].status).toBe("away");
  });

  it("links the device token this machine already holds", async () => {
    const t = token({});
    const { store, tokens } = fakeStore({ tokens: [t] });
    await heartbeat(deps(store), USER, beat({ tokenLabel: t.client_name! }));
    expect(tokens[0].device_id).not.toBeNull();
  });

  it("answers revoked for a removed computer and never resurrects it", async () => {
    const { store, devices } = fakeStore();
    await heartbeat(deps(store), USER, beat());
    await removeComputer(deps(store), USER, devices[0].id);
    expect(await heartbeat(deps(store), USER, beat())).toEqual({ device: { revoked: true } });
    expect(devices[0].revoked_at).not.toBeNull();
  });
});

describe("listComputers", () => {
  it("lists this computer first, marks it current, and appends unlinked legacy tokens once per label", async () => {
    const { store } = fakeStore({
      tokens: [
        token({ id: "22222222-2222-4222-8222-222222222222" }),
        token({ id: "33333333-3333-4333-8333-333333333333", last_used_at: "2026-09-27T11:00:00.000Z" }),
      ],
    });
    await heartbeat({ store, now: () => NOW - 60 * 60_000 }, USER, beat({ installId: OTHER_INSTALL, name: "Air" }));
    await heartbeat(deps(store), USER, beat());
    const { devices } = await listComputers(deps(store), USER, INSTALL);
    expect(devices.map((d) => [d.name, d.current, d.online, d.legacy])).toEqual([
      ["Samuel's MacBook Pro", true, true, false],
      ["Air", false, false, false],
      ["Samuels-MacBook-Pro-2", false, false, true],
    ]);
    expect(devices[2].id).toBe("legacy-33333333-3333-4333-8333-333333333333");
    expect(devices[2].platform).toBe("macos");
  });
});

describe("removeComputer", () => {
  it("revokes every credential the computer minted", async () => {
    const { store, devices, tokens } = fakeStore();
    await heartbeat(deps(store), USER, beat());
    const id = devices[0].id;
    tokens.push(
      token({ id: "44444444-4444-4444-8444-444444444444", device_id: id }),
      token({ id: "55555555-5555-4555-8555-555555555555", device_id: id, client_name: "Dopl Desktop (container session)" }),
      token({ id: "66666666-6666-4666-8666-666666666666", device_id: null, client_name: "Other" })
    );
    expect(await removeComputer(deps(store), USER, id)).toEqual({ ok: true, revokedTokens: 2 });
    expect(tokens.map((t) => Boolean(t.revoked_at))).toEqual([true, true, false]);
  });

  it("revokes a legacy computer's tokens by label", async () => {
    const { store, tokens } = fakeStore({ tokens: [token({})] });
    const result = await removeComputer(deps(store), USER, `legacy-${tokens[0].id}`);
    expect(result.revokedTokens).toBe(1);
  });

  it("404s an unknown, foreign or malformed id", async () => {
    const { store } = fakeStore();
    await expect(removeComputer(deps(store), USER, "nope")).rejects.toMatchObject({ status: 404 });
    await expect(
      removeComputer(deps(store), USER, "77777777-7777-4777-8777-777777777777")
    ).rejects.toMatchObject({ status: 404 });
    await expect(removeComputer(deps(store), USER, "legacy-x")).rejects.toMatchObject({ status: 404 });
  });
});

describe("resolveRequestDevice", () => {
  it("resolves only an active registered install", async () => {
    const { store, devices } = fakeStore();
    expect(await resolveRequestDevice(deps(store), USER, null)).toBeNull();
    expect(await resolveRequestDevice(deps(store), USER, "not-a-uuid")).toBeNull();
    await heartbeat(deps(store), USER, beat());
    expect(await resolveRequestDevice(deps(store), USER, INSTALL)).toBe(devices[0].id);
    await removeComputer(deps(store), USER, devices[0].id);
    expect(await resolveRequestDevice(deps(store), USER, INSTALL)).toBeNull();
  });
});
