import { describe, expect, it } from "vitest";
import type { GlassesDevice } from "@/features/glasses/settings/glasses-api";
import { deviceMeta, mergeDevices } from "./merge";
import type { ComputerDeviceDto } from "./types";

const computer = (over: Partial<ComputerDeviceDto>): ComputerDeviceDto => ({
  id: "c1",
  kind: "computer",
  name: "Mac",
  platform: "macos",
  online: false,
  status: "offline",
  last_seen: "2026-09-27T00:00:00Z",
  created_at: "2026-09-01T00:00:00Z",
  app_version: null,
  os_version: null,
  current: false,
  legacy: false,
  ...over,
});

const glasses = (over: Partial<GlassesDevice>): GlassesDevice => ({
  id: "g1",
  name: "G2",
  platform: "even_g2",
  created_at: "2026-09-01T00:00:00Z",
  last_seen: "2026-09-28T00:00:00Z",
  online: false,
  has_hey_even_key: false,
  ...over,
});

describe("mergeDevices", () => {
  it("puts this computer first, then online devices, then the rest by last seen", () => {
    const list = mergeDevices(
      [computer({ id: "old" }), computer({ id: "here", current: true })],
      [glasses({ id: "worn", online: true }), glasses({ id: "drawer" })]
    );
    expect(list.map((d) => `${d.kind}:${d.id}`)).toEqual([
      "computer:here",
      "glasses:worn",
      "glasses:drawer",
      "computer:old",
    ]);
  });

  it("labels platforms from their registries and carries the glasses row", () => {
    const row = glasses({});
    const [g] = mergeDevices([], [row]);
    expect(g.platformLabel).toBe("Even G2");
    expect(g.glasses).toBe(row);
    expect(mergeDevices([], [glasses({ platform: "future_x" })])[0].platformLabel).toBe("future_x");
    const [c] = mergeDevices([computer({ platform: "" })], []);
    expect(c.platformLabel).toBe("Computer");
  });
});

describe("deviceMeta", () => {
  it("says Online, the last-seen text, or Offline when never seen", () => {
    const [online] = mergeDevices([computer({ online: true })], []);
    const [seen] = mergeDevices([computer({})], []);
    const [never] = mergeDevices([computer({ last_seen: null })], []);
    expect(deviceMeta(online, "2h ago")).toBe("macOS · Online");
    expect(deviceMeta(seen, "2h ago")).toBe("macOS · 2h ago");
    expect(deviceMeta(never, "—")).toBe("macOS · Offline");
  });
});
