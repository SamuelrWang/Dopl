/**
 * Gap #11 (W1.2 Glasses Seam KB): a display the caller NAMES by `display_id` (`screen_id`) never takes
 * the SDK path. The contract has no replace-by-id, so an SDK copy would stack on the lens and
 * `glasses_update` could not find it; the prosumer copy replaces in place by `card_id`. Proven at the
 * display door and through the real glasses tools (`glasses_render` → `glasses_update`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/channels/server/service", () => ({ postMessage: vi.fn() }));
vi.mock("@/features/channels/server/service-shared", () => ({ requireMemberChannel: vi.fn() }));
vi.mock("@/features/channels/server/repository-messages", () => ({ findMessageById: vi.fn() }));
vi.mock("@/features/channels/server/repository-workspace", () => ({ fetchProfiles: vi.fn(async () => []) }));
vi.mock("./repository", () => ({ findByDisplayId: vi.fn(), hasAnswerMessage: vi.fn(), replaceDisplay: vi.fn(), channelWorkspaceOf: vi.fn() }));
vi.mock("./answer", () => ({ answerDecisionFromLens: vi.fn() }));
vi.mock("@/features/workspaces/server/service", () => ({ resolveActiveWorkspace: vi.fn() }));

import type { ShowDisplayInput, ShowDisplayResult } from "@dopl/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { postMessage } from "@/features/channels/server/service";
import { requireMemberChannel } from "@/features/channels/server/service-shared";
import { findMessageById } from "@/features/channels/server/repository-messages";
import type { ChannelContext } from "@/features/channels/server/service-shared";
import { registerGlassesTools } from "@/features/glasses/core/mcp/tools";
import type { GlassesDeps } from "@/features/glasses/core/messages/service";
import { createFakeGlassesStore, fakeClock } from "@/features/glasses/core/testing/fake-store";
import { findByDisplayId, hasAnswerMessage } from "./repository";
import type { SdkLens, SdkUserLens } from "./sdk-lens";
import { showDisplay, type ShowInput } from "./service";

const USER = "11111111-1111-4111-8111-111111111111";
const CHAN = "22222222-2222-4222-8222-222222222222";
const ctx = { userId: USER, workspaceId: "ws", source: "agent", sessionId: `${CHAN}:main:agent-1` } as unknown as ChannelContext;
const STATUS = [{ type: "heading", text: "Deploy" }, { type: "progress", value: 0.6, label: "Build" }];

/** Flag on, every link migrated, glasses online: everything faithful would go over the SDK. */
function world() {
  const screens: unknown[] = [];
  // Only what a screen needs; an ask here would be a test bug (cast keeps the fake off the ask API).
  const user = {
    state: async () => ({ paired: true, online: true }),
    screen: async (a: unknown) => {
      screens.push(a);
      return { delivery_id: "dl1", routed_to: { device_id: "dev", kind: "glasses", reason: "x" }, status: "queued" };
    },
  } as unknown as SdkUserLens;
  const sdk: SdkLens = { forUser: async () => ({ lens: user, deviceIds: ["dev"] }) };
  const fake = createFakeGlassesStore();
  const clock = fakeClock();
  const devices = { listDevices: async () => [{ id: "dev", name: "G2", last_seen: new Date(clock.now()).toISOString() }] } as unknown as GlassesDeps["devices"];
  const deps = { store: fake.store, devices, now: clock.now, sleep: clock.sleep, sdk };
  return { screens, deps, rows: fake.rows };
}

let logs: string[];
beforeEach(() => {
  vi.clearAllMocks();
  logs = [];
  vi.spyOn(console, "info").mockImplementation((m: string) => void logs.push(m));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireMemberChannel).mockResolvedValue({ channel: { id: CHAN, name: "Lab" } } as never);
  vi.mocked(postMessage).mockImplementation(async (_c, _ch, input) => ({ id: "m1", metadata: {}, body: input.body }) as never);
  vi.mocked(findByDisplayId).mockResolvedValue(null);
  vi.mocked(hasAnswerMessage).mockResolvedValue(false);
  vi.mocked(findMessageById).mockResolvedValue({ metadata: {} } as never);
});

const shownLogs = () => logs.filter((l) => l.includes('"display_shown"')).map((l) => JSON.parse(l.slice("[display] ".length)));

describe("Gap #11: a named display stays prosumer", () => {
  it("explicit display_id: the SDK seam never receives it; prosumer row keyed by the id, logged", async () => {
    const w = world();
    const r = await showDisplay(ctx, { blocks: STATUS, target: "glasses", display_id: "deploy" }, undefined, w.deps);
    expect(w.screens).toEqual([]);
    expect(w.rows).toEqual([expect.objectContaining({ kind: "screen", card_id: "deploy" })]);
    expect(r).toMatchObject({ display_id: "deploy", glasses: "shown", glasses_message_id: w.rows[0].id });
    expect(shownLogs()).toEqual([expect.objectContaining({ path: "prosumer_fallback", fallback_reason: "explicit display_id" })]);
  });

  it("control: the same screen without a display_id goes over the SDK", async () => {
    const w = world();
    await showDisplay(ctx, { blocks: STATUS, target: "glasses" }, undefined, w.deps);
    expect(w.screens).toHaveLength(1);
    expect(w.rows).toEqual([]);
  });

  it("🔒 glasses_render(screen_id) then glasses_update finds it on prosumer and replaces in place; SDK untouched", async () => {
    const w = world();
    const server = new McpServer({ name: "dopl-glasses", version: "0" });
    const show = (input: ShowDisplayInput) => showDisplay(ctx, input as ShowInput, undefined, w.deps) as unknown as Promise<ShowDisplayResult>;
    registerGlassesTools(server, w.deps, USER, { canWrite: true, show });
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      expect(res.isError, res.content[0].text).toBeFalsy();
      return JSON.parse(res.content[0].text) as Record<string, unknown>;
    };

    const first = await call("glasses_render", { screen_id: "build", blocks: [{ id: "b1", type: "text", content: "Building" }] });
    expect(first).toMatchObject({ screen_id: "build", id: w.rows[0].id });
    const patched = await call("glasses_update", { screen_id: "build", patches: [{ id: "b1", content: "Built" }] });
    expect(patched).toMatchObject({ screen_id: "build" });

    expect(w.screens).toEqual([]);
    expect(w.rows).toHaveLength(1);
    expect(JSON.stringify(w.rows[0].payload)).toContain("Built");
    expect(shownLogs().map((l) => l.fallback_reason)).toEqual(["explicit display_id", "explicit display_id"]);
  });
});
