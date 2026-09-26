import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const countActiveDevices = vi.fn();
const consumeMcpCredits = vi.fn();
vi.mock("./devices-repository", () => ({ deviceRepository: { countActiveDevices: (u: string) => countActiveDevices(u) } }));
vi.mock("./repository", () => ({ glassesRepository: {} }));
vi.mock("@/features/billing/server/credits-service", () => ({
  consumeMcpCredits: (...a: unknown[]) => consumeMcpCredits(...a),
}));
vi.mock("@/features/workspaces/server/service", () => ({
  resolveActiveWorkspace: async () => ({ workspace: { id: "home-1", kind: "home" }, membership: { role: "owner" } }),
}));

const { glassesCreditCharger, hasActiveGlasses, maybeRegisterGlassesTools } = await import("./mcp-exposure");

async function toolNames(server: McpServer) {
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return (await client.listTools()).tools.map((t) => t.name);
}

describe("main /api/mcp exposure", () => {
  beforeEach(() => {
    countActiveDevices.mockReset();
    consumeMcpCredits.mockReset();
  });

  it("adds the glasses tools only for a user with an active device", async () => {
    countActiveDevices.mockImplementation(async (u: string) => (u === "with-glasses" ? 1 : 0));
    const plain = new McpServer({ name: "main", version: "0" });
    plain.registerTool("dopl_search", { description: "x" }, async () => ({ content: [] }));
    await maybeRegisterGlassesTools(plain, "no-glasses", { canWrite: true });
    expect(await toolNames(plain)).toEqual(["dopl_search"]);

    const withGlasses = new McpServer({ name: "main", version: "0" });
    withGlasses.registerTool("dopl_search", { description: "x" }, async () => ({ content: [] }));
    await maybeRegisterGlassesTools(withGlasses, "with-glasses", { canWrite: true });
    const names = await toolNames(withGlasses);
    expect(names).toContain("glasses_notify");
    expect(names).toContain("glasses_render");
    expect(names.filter((n) => n.startsWith("glasses_"))).toHaveLength(11);
  });

  it("caches the device check for 30s and hides tools when the read fails", async () => {
    countActiveDevices.mockResolvedValue(1);
    expect(await hasActiveGlasses("cache-user", 1_000)).toBe(true);
    countActiveDevices.mockResolvedValue(0);
    expect(await hasActiveGlasses("cache-user", 20_000)).toBe(true);
    expect(await hasActiveGlasses("cache-user", 40_000)).toBe(false);
    countActiveDevices.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await hasActiveGlasses("broken-user", 0)).toBe(false);
    err.mockRestore();
  });
});

describe("credit metering", () => {
  it("charges the caller's home wallet with the session's channel hint", async () => {
    consumeMcpCredits.mockResolvedValue({ allowed: true });
    const channel = "9e6a4b44-d780-474e-be83-a90772724b94";
    expect(await glassesCreditCharger("u1", `${channel}::abcdefgh`)()).toBeNull();
    expect(consumeMcpCredits).toHaveBeenCalledWith("home-1", { userId: "u1", workspaceKind: "home", channelId: channel });
  });

  it("refuses when the wallet is empty and fails open on a thrown charge", async () => {
    consumeMcpCredits.mockResolvedValue({ allowed: false, upgradeUrl: "https://x/billing" });
    expect(await glassesCreditCharger("u1", null)()).toBe("Your Dopl credits are used up for this period. Upgrade: https://x/billing");
    consumeMcpCredits.mockRejectedValue(new Error("rpc"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await glassesCreditCharger("u1", null)()).toBeNull();
    err.mockRestore();
  });
});
