import { describe, expect, it } from "vitest";
import { deviceMeta, mergeDevices, type GlassesSourceRow } from "./merge";
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

const glasses = (over: Partial<GlassesSourceRow>): GlassesSourceRow => ({
  id: "g1",
  name: "G2",
  platform: "even_g2",
  created_at: "2026-09-01T00:00:00Z",
  last_seen: "2026-09-28T00:00:00Z",
  online: false,
  linked_channel: null,
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

  it("labels platforms and keeps glasses' own fields", () => {
    const [g] = mergeDevices([], [glasses({ linked_channel: { id: "ch", name: "Ops" }, has_hey_even_key: true })]);
    expect(g.platformLabel).toBe("Even G2");
    expect(g.linkedChannel).toEqual({ id: "ch", name: "Ops" });
    expect(g.hasHeyEvenKey).toBe(true);
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
