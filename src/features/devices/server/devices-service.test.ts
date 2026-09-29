import { describe, expect, it } from "vitest";
import {
  COMPUTER_ONLINE_WINDOW_MS,
  heartbeat,
  isComputerOnline,
  legacyComputerName,
  listComputers,
  removeComputer,
  renameComputer,
  requestComputer,
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
const SESSION = "5e5510a0-0000-4000-8000-000000000001";

interface FakeToken extends DeviceTokenRow {
  user_id: string;
  revoked_at: string | null;
}

function fakeStore(seed: { devices?: DesktopDeviceRow[]; tokens?: FakeToken[] } = {}) {
  const devices = [...(seed.devices ?? [])];
  const tokens = [...(seed.tokens ?? [])];
  const ended: string[] = [];
  const calls: string[] = [];
  let seq = devices.length;
  const write = (row: DesktopDeviceRow, input: HeartbeatInput, sessionId: string | null, now: string) =>
    Object.assign(row, {
      name: input.name,
      platform: input.platform,
      os_version: input.osVersion ?? null,
      app_version: input.appVersion ?? null,
      arch: input.arch ?? null,
      status: input.status,
      last_seen: now,
      ...(sessionId ? { auth_session_id: sessionId } : {}),
    });
  const store: DesktopDeviceStore = {
    async findByInstall(userId, installId) {
      calls.push("find");
      return devices.find((d) => d.user_id === userId && d.install_id === installId) ?? null;
    },
    async touch(userId, input, sessionId, now) {
      calls.push("touch");
      const row = devices.find(
        (d) => d.user_id === userId && d.install_id === input.installId && !d.revoked_at
      );
      return row ? write(row, input, sessionId, now) : null;
    },
    async insert(userId, input, sessionId, now) {
      calls.push("insert");
      if (devices.some((d) => d.user_id === userId && d.install_id === input.installId)) return null;
      const row = {
        id: `00000000-0000-4000-8000-00000000000${++seq}`,
        user_id: userId,
        install_id: input.installId,
        created_at: now,
        revoked_at: null,
        auth_session_id: null,
        display_name: null,
      } as DesktopDeviceRow;
      devices.push(row);
      return write(row, input, sessionId, now);
    },
    async listActive(userId) {
      return devices.filter((d) => d.user_id === userId && !d.revoked_at);
    },
    async listDeviceTokens(userId) {
      return tokens.filter((t) => t.user_id === userId && !t.revoked_at);
    },
    async linkTokenById(userId, deviceId, tokenId) {
      calls.push("linkId");
      for (const t of tokens) {
        if (t.user_id === userId && t.id === tokenId && !t.device_id && !t.revoked_at) t.device_id = deviceId;
      }
    },
    async linkTokensByLabel(userId, deviceId, label) {
      calls.push("linkLabel");
      for (const t of tokens) {
        if (t.user_id === userId && t.client_name === label && !t.device_id && !t.revoked_at) {
          t.device_id = deviceId;
        }
      }
    },
    async setDisplayName(userId, deviceId, displayName) {
      const row = devices.find((d) => d.user_id === userId && d.id === deviceId && !d.revoked_at);
      if (!row) return null;
      row.display_name = displayName;
      return row;
    },
    async revoke(userId, deviceId, now) {
      const row = devices.find((d) => d.user_id === userId && d.id === deviceId && !d.revoked_at);
      if (!row) return null;
      row.revoked_at = now;
      return row;
    },
    async revokeLinkedTokens(userId, deviceId, now) {
      const hit = tokens.filter((t) => t.user_id === userId && t.device_id === deviceId && !t.revoked_at);
      hit.forEach((t) => (t.revoked_at = now));
      return hit.length;
    },
    async revokeLegacyToken(userId, tokenId, now) {
      const hit = tokens.filter((t) => t.user_id === userId && t.id === tokenId && !t.device_id && !t.revoked_at);
      hit.forEach((t) => (t.revoked_at = now));
      return hit.length;
    },
    async endAuthSession(_userId, sessionId) {
      ended.push(sessionId);
      return true;
    },
  };
  return { store, devices, tokens, ended, calls };
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

  it("links the device token this machine names, by id, and only when named", async () => {
    const mine = token({});
    const sameLabel = token({ id: "88888888-8888-4888-8888-888888888888" });
    const { store, tokens, calls } = fakeStore({ tokens: [mine, sameLabel] });
    await heartbeat(deps(store), USER, beat({ tokenId: mine.id }));
    expect(tokens.map((t) => Boolean(t.device_id))).toEqual([true, false]);
    calls.length = 0;
    await heartbeat(deps(store), USER, beat());
    expect(calls).toEqual(["touch"]);
  });

  it("falls back to the label for an older record with no token id", async () => {
    const t = token({});
    const { store, tokens } = fakeStore({ tokens: [t] });
    await heartbeat(deps(store), USER, beat({ tokenLabel: t.client_name! }));
    expect(tokens[0].device_id).not.toBeNull();
  });

  it("records the sign-in's session id, keeping the last known one when a beat has none", async () => {
    const { store, devices } = fakeStore();
    await heartbeat(deps(store), USER, beat(), SESSION);
    await heartbeat(deps(store), USER, beat());
    expect(devices[0].auth_session_id).toBe(SESSION);
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
  it("lists this computer first, marks it current, and appends each unlinked legacy token", async () => {
    const { store } = fakeStore({
      tokens: [
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

describe("renameComputer", () => {
  it("overrides the detected name, survives heartbeats, and a blank name restores it", async () => {
    const { store, devices } = fakeStore();
    await heartbeat(deps(store), USER, beat());
    const id = devices[0].id;
    const renamed = await renameComputer(deps(store), USER, id, "  Studio Mac ", INSTALL);
    expect(renamed.device).toMatchObject({ name: "Studio Mac", detected_name: "Samuel's MacBook Pro", renamed: true, current: true });
    await heartbeat(deps(store), USER, beat({ name: "Renamed In macOS" }));
    const [listed] = (await listComputers(deps(store), USER, null)).devices;
    expect([listed.name, listed.detected_name]).toEqual(["Studio Mac", "Renamed In macOS"]);
    const cleared = await renameComputer(deps(store), USER, id, "   ");
    expect(cleared.device).toMatchObject({ name: "Renamed In macOS", renamed: false });
    expect(devices[0].display_name).toBeNull();
  });

  it("404s a legacy, removed or foreign computer", async () => {
    const { store, devices } = fakeStore();
    await heartbeat(deps(store), USER, beat());
    await expect(renameComputer(deps(store), "user-2", devices[0].id, "x")).rejects.toMatchObject({ status: 404 });
    await expect(renameComputer(deps(store), USER, "legacy-abc", "x")).rejects.toMatchObject({ status: 404 });
    await removeComputer(deps(store), USER, devices[0].id);
    await expect(renameComputer(deps(store), USER, devices[0].id, "x")).rejects.toMatchObject({ status: 404 });
  });
});

describe("requestComputer", () => {
  it("answers the active row for this install, else null", async () => {
    const { store, devices } = fakeStore();
    expect(await requestComputer(deps(store), USER, INSTALL)).toBeNull();
    await heartbeat(deps(store), USER, beat());
    expect((await requestComputer(deps(store), USER, INSTALL))?.id).toBe(devices[0].id);
    expect(await requestComputer(deps(store), USER, "not-a-uuid")).toBeNull();
    await removeComputer(deps(store), USER, devices[0].id);
    expect(await requestComputer(deps(store), USER, INSTALL)).toBeNull();
  });
});

describe("removeComputer", () => {
  it("revokes every credential the computer minted and ends its sign-in", async () => {
    const { store, devices, tokens, ended } = fakeStore();
    await heartbeat(deps(store), USER, beat(), SESSION);
    const id = devices[0].id;
    tokens.push(
      token({ id: "44444444-4444-4444-8444-444444444444", device_id: id }),
      token({ id: "55555555-5555-4555-8555-555555555555", device_id: id, client_name: "Dopl Desktop (container session)" }),
      token({ id: "66666666-6666-4666-8666-666666666666", device_id: null, client_name: "Other" })
    );
    expect(await removeComputer(deps(store), USER, id)).toEqual({
      ok: true,
      revokedTokens: 2,
      endedSession: true,
    });
    expect(tokens.map((t) => Boolean(t.revoked_at))).toEqual([true, true, false]);
    expect(ended).toEqual([SESSION]);
  });

  it("revokes a legacy computer's token by id, never a same-label sibling", async () => {
    const { store, tokens } = fakeStore({
      tokens: [token({}), token({ id: "99999999-9999-4999-8999-999999999999" })],
    });
    const result = await removeComputer(deps(store), USER, `legacy-${tokens[0].id}`);
    expect(result).toEqual({ ok: true, revokedTokens: 1, endedSession: false });
    expect(tokens.map((t) => Boolean(t.revoked_at))).toEqual([true, false]);
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
  it("resolves an install to its computer, or says it was removed", async () => {
    const { store, devices } = fakeStore();
    expect(await resolveRequestDevice(deps(store), USER, null)).toBeNull();
    expect(await resolveRequestDevice(deps(store), USER, "not-a-uuid")).toBeNull();
    await heartbeat(deps(store), USER, beat());
    expect(await resolveRequestDevice(deps(store), USER, INSTALL)).toEqual({ deviceId: devices[0].id });
    await removeComputer(deps(store), USER, devices[0].id);
    expect(await resolveRequestDevice(deps(store), USER, INSTALL)).toEqual({ removed: true });
  });
});
