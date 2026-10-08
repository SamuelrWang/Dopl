/**
 * `launchOptions` over the desktop's PUBLISHED catalogs (2026-10-08). Split from `menu.test.ts`
 * (500-line cap); same fakes, minimal gateway.
 */
import { describe, expect, it } from "vitest";
import { createFakeDeviceStore, fakeLinker } from "../testing/fake-device-store";
import { launchOptions } from "./service";
import type { MenuGateway } from "./types";

const OWNER = "22222222-2222-4222-8222-222222222222";
const OPS = "33333333-3333-4333-8333-333333333333";

function gateway(over: Partial<MenuGateway>): MenuGateway {
  const none = async () => {
    throw new Error("not used");
  };
  return {
    listChannels: async () => [],
    listSessions: async () => [],
    runtimesFor: async () => new Map(),
    launchHistory: async () => [{ runtime: "codex", model: "gpt-6" }],
    modelCatalogs: async () => [],
    recentLaunchNames: async () => [],
    openChannel: none,
    persistedAgentNames: async () => new Map(),
    ...over,
  };
}

async function run(over: Partial<MenuGateway>) {
  const { devices } = createFakeDeviceStore();
  const linker = fakeLinker({ [OPS]: { name: "Ops", members: [OWNER] } });
  const d = await devices.insertDevice({ userId: OWNER, name: "Lens", platform: "even_g2", now: "t" });
  return launchOptions({ gateway: gateway(over), linker, devices }, d, OPS);
}

describe("launch options from published catalogs", () => {
  it("offers the desktop's roster when fresh, and says to refresh where there is none", async () => {
    const { runtimes } = await run({
      modelCatalogs: async () => [
        {
          runtime: "claude",
          deviceId: "mac-a",
          models: [
            { id: "claude-x-1", label: "Claude X 1", short: "X 1", isDefault: true },
            { id: "claude-y-2", label: "Claude Y 2" },
          ],
          defaultId: "claude-x-1",
          publishedAt: new Date().toISOString(),
        },
      ],
    });
    expect(runtimes.map((r) => r.id)).toEqual(["claude", "codex"]);
    const claude = runtimes[0];
    expect(claude.models).toEqual([
      { id: "", label: "Default" },
      { id: "claude-x-1", label: "X 1" },
      { id: "claude-y-2", label: "Claude Y 2" },
    ]);
    expect(claude.stale).toBe(false);
    expect(claude).not.toHaveProperty("note");
    const codex = runtimes[1];
    expect(codex.models.map((m) => m.id)).toEqual(["", "gpt-6"]);
    expect(codex.stale).toBe(true);
    expect(codex.note).toMatch(/Open Dopl on your computer/);
  });

  it("🔒 a catalog read that fails never fails the menu: history still answers", async () => {
    const { runtimes } = await run({
      modelCatalogs: async () => {
        throw new Error("db down");
      },
    });
    expect(runtimes.map((r) => r.id)).toEqual(["codex", "claude"]);
  });
});
