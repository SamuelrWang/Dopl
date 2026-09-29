import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient } from "@dopl/client";

const countActiveDevices = vi.fn();
const consumeMcpCredits = vi.fn();
const resolveActiveWorkspace = vi.fn();
vi.mock("../devices/repository", () => ({ deviceRepository: { countActiveDevices: (u: string) => countActiveDevices(u) } }));
vi.mock("../messages/repository", () => ({ glassesRepository: {} }));
vi.mock("@/features/billing/server/credits-service", () => ({
  consumeMcpCredits: (...a: unknown[]) => consumeMcpCredits(...a),
}));
vi.mock("@/features/workspaces/server/service", () => ({
  resolveActiveWorkspace: (...a: unknown[]) => resolveActiveWorkspace(...a),
}));

const { exposeGlassesTools, hasActiveGlasses, mcpToolCharger, profileOffersGlasses, utteranceCharger } =
  await import("./exposure");

const expose = (server: McpServer, userId: string, client: DoplClient, toolProfile?: string, requireDevice = true) =>
  exposeGlassesTools(server, { userId, scopes: ["dopl.write"], toolProfile, client, lockedContainerId: null }, { requireDevice });

const fakeClient = (consume: (ws: string, call: unknown) => Promise<unknown>) =>
  ({ consumeCredits: vi.fn(consume) }) as unknown as DoplClient & { consumeCredits: ReturnType<typeof vi.fn> };

async function toolNames(server: McpServer) {
  const client = new Client({ name: "t", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return (await client.listTools()).tools.map((t) => t.name);
}

function mainServer() {
  const s = new McpServer({ name: "main", version: "0" });
  s.registerTool("dopl_search", { description: "x" }, async () => ({ content: [] }));
  return s;
}

beforeEach(() => {
  countActiveDevices.mockReset();
  consumeMcpCredits.mockReset();
  resolveActiveWorkspace.mockReset();
  resolveActiveWorkspace.mockImplementation(async (_u: string, ws: string | null) => ({
    workspace: { id: ws ?? "home-1", kind: ws ? "standard" : "home" },
    membership: { role: "owner" },
  }));
});

describe("main /api/mcp exposure", () => {
  const client = fakeClient(async () => ({ allowed: true }));

  it("adds the glasses tools only for a user with an active device", async () => {
    countActiveDevices.mockImplementation(async (u: string) => (u === "with-glasses" ? 1 : 0));
    const plain = mainServer();
    await expose(plain, "no-glasses", client);
    expect(await toolNames(plain)).toEqual(["dopl_search"]);

    const withGlasses = mainServer();
    await expose(withGlasses, "with-glasses", client);
    expect((await toolNames(withGlasses)).filter((n) => n.startsWith("glasses_"))).toHaveLength(11);
  });

  it("respects the containment profile: read_only and dopl_only sessions never see them", async () => {
    countActiveDevices.mockResolvedValue(1);
    for (const profile of ["read_only", "dopl_only", "garbage", ""]) {
      const s = mainServer();
      await expose(s, "profile-user", client, profile);
      expect(await toolNames(s)).toEqual(["dopl_search"]);
    }
    expect(profileOffersGlasses(undefined)).toBe(true);
    expect(profileOffersGlasses("channel_agent")).toBe(true);
    expect(profileOffersGlasses("full")).toBe(true);
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
  it("charges MCP calls through the loopback client, on the credential's locked container", async () => {
    const client = fakeClient(async () => ({ allowed: true }));
    expect(await mcpToolCharger(client, "u1", null)(true)).toBeNull();
    expect(client.consumeCredits).toHaveBeenCalledWith("home-1", { tool: "glasses", op: "", write: true });
    const locked = fakeClient(async () => ({ allowed: true }));
    await mcpToolCharger(locked, "u1", "container-9")(false);
    expect(locked.consumeCredits).toHaveBeenCalledWith("container-9", { tool: "glasses", op: "", write: false });
  });

  it("refuses when the wallet is empty and fails open on a thrown charge", async () => {
    const empty = fakeClient(async () => ({ allowed: false, upgradeUrl: "https://x/billing" }));
    expect(await mcpToolCharger(empty, "u1", null)(false)).toBe(
      "Your Dopl credits are used up for this period. Upgrade: https://x/billing",
    );
    const broken = fakeClient(async () => {
      throw new Error("rpc");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await mcpToolCharger(broken, "u1", null)(false)).toBeNull();
    err.mockRestore();
  });

  it("charges utterances in-process to the owner's home wallet", async () => {
    consumeMcpCredits.mockResolvedValue({ allowed: true });
    expect(await utteranceCharger("u2")).toBeNull();
    expect(consumeMcpCredits).toHaveBeenCalledWith("home-1", { userId: "u2", workspaceKind: "home", channelId: null });
    consumeMcpCredits.mockResolvedValue({ allowed: false, upgradeUrl: "" });
    expect(await utteranceCharger("u2")).toBe("Your Dopl credits are used up for this period.");
  });
});
