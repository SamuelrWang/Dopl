/**
 * THE CONTAINER LOCK — layer B3 of the audience ceiling (plan §4.4).
 *
 * A session pinned to a SHARED `kind='link'` container (one with a PEER in it)
 * sees and addresses that container ALONE. Pinned here:
 *
 *   - `bootServer` LOCKS on a shared container and does NOT lock on a solo one,
 *     on a standard workspace, or when there is no pin at all;
 *   - 🔒 an ABSENT `memberCount` LOCKS — §8's stale-field rule applied INVERTED,
 *     because unknown must read as "not solo" rather than as the permissive case;
 *   - `getWorkspaceList()` answers `[container]` and `resolveWorkspaceRef`
 *     answers `null` for every other id and slug;
 *   - the INSTRUCTIONS table is empty under a lock, so the briefing cannot
 *     advertise a workspace the tools then refuse;
 *   - 🔒 **`dopl_home` DOES NOT ENUMERATE** (2026-08-28). `/api/home/channels` is
 *     `withUserAuth` and answers the WHOLE ACCOUNT, so the narrowing cannot live
 *     in the route — it lives in `tools/home-scopes.ts`, and a locked session
 *     must see exactly the room it stands in with no evidence another exists.
 *     ⚠ This is the single easiest way to regress B3, which is why it is driven
 *     through the REAL registered tool rather than asserted on the helper.
 *
 * ⚠ THIS IS A TRIPWIRE SUITE, NOT A CONTAINMENT SUITE. Nothing here proves an
 * agent cannot reach another workspace — Bash can open a second MCP connection
 * with no pin. The fences are `knowledge/server/service-audience.ts` and the
 * container-locked credential. Do not let a green run here read as containment.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

const registeredInstructions: string[] = [];
/** Registered tool callbacks, so the wiring can be driven rather than assumed. */
const registeredTools = new Map<
  string,
  (args: unknown) => Promise<{ content: { type: string; text?: string }[] }>
>();

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    constructor(_info: unknown, opts?: { instructions?: string }) {
      registeredInstructions.push(opts?.instructions ?? "");
    }
    // ⚠ `registerTool`, deliberately NOT `tool` — §10's strict-args rule: five
    // mocks in this package expose the former and not the latter, so a revert to
    // the positional overload is a TypeError in each.
    registerTool(
      name: string,
      _config: unknown,
      cb: (args: unknown) => Promise<{
        content: { type: string; text?: string }[];
      }>,
    ) {
      registeredTools.set(name, cb);
    }
  },
}));

import { bootServer } from "./factory.js";
import { createWorkspaceDirectory } from "./workspace-directory.js";

function wsItem(
  id: string,
  slug: string,
  kind?: "standard" | "link",
  memberCount?: number,
): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name: `${slug} workspace`,
    slug,
    publicId: `pub-${id}`,
    description: null,
    ...(kind ? { kind } : {}),
    ...(memberCount === undefined ? {} : { memberCount }),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "member",
  };
}

const STANDARD = wsItem("id-std", "alpha", "standard", 3);
const OTHER_STANDARD = wsItem("id-std2", "beta", "standard", 1);
const SOLO_CONTAINER = wsItem("id-solo", "solo-c", "link", 1);
const SHARED_CONTAINER = wsItem("id-shared", "shared-c", "link", 2);
const COUNTLESS_CONTAINER = wsItem("id-old", "old-c", "link");

/** Every home channel the ACCOUNT has — what the route really answers, which is
 *  the whole point: the narrowing is the MCP layer's, not the route's. */
const ALL_HOME_CHANNELS = [
  {
    workspaceId: "id-shared",
    workspaceSegment: "shared-c-pub",
    channelId: "ch-shared",
    name: "With Dana",
    peers: [{ userId: "u2", displayName: "Dana", email: null, avatarUrl: null }],
    createdAt: "2026-01-01T00:00:00Z",
    lastMessageAt: null,
    lastMessagePreview: null,
  },
  {
    workspaceId: "id-solo",
    workspaceSegment: "solo-c-pub",
    channelId: "ch-solo",
    name: "My own room",
    peers: [],
    createdAt: "2026-01-01T00:00:00Z",
    lastMessageAt: null,
    lastMessagePreview: null,
  },
];

function mockClient(
  directory: WorkspaceListItem[],
  pin?: string | null,
): DoplClient {
  return {
    pingMcpStatus: vi
      .fn()
      .mockResolvedValue({ is_admin: false, user_id: "user-1" }),
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: directory }),
    getWorkspaceId: vi.fn(() => pin ?? null),
    setWorkspaceId: vi.fn(),
    getHomeChannels: vi
      .fn()
      .mockResolvedValue({ channels: ALL_HOME_CHANNELS, pendingLinks: [] }),
    consumeCredits: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as DoplClient;
}

/**
 * Boot a real server and hand back BOTH the briefing it registered and a driver
 * for `list_workspaces` — the meta-tool that reads the directory through the
 * same object `createServer` built. Driving it is what pins the WIRING; the
 * `createWorkspaceDirectory` tests below only pin the object's own behaviour,
 * and a lock that is never threaded in would leave those green.
 */
async function bootDirectory(
  rows: WorkspaceListItem[],
  pin?: string | null,
): Promise<{
  instructions: string;
  listWorkspaces: () => Promise<string>;
  listHomeChannels: () => Promise<string>;
}> {
  registeredInstructions.length = 0;
  registeredTools.clear();
  await bootServer(mockClient(rows, pin));
  const cb = registeredTools.get("list_workspaces");
  const home = registeredTools.get("dopl_home");
  return {
    instructions: registeredInstructions[0] ?? "",
    listWorkspaces: async () => {
      if (!cb) throw new Error("list_workspaces was never registered");
      const res = await cb({});
      return res.content.map((c) => c.text ?? "").join("\n");
    },
    listHomeChannels: async () => {
      if (!home) throw new Error("dopl_home was never registered");
      const res = await home({ op: "list_channels" });
      return res.content.map((c) => c.text ?? "").join("\n");
    },
  };
}

describe("bootServer — when the directory LOCKS", () => {
  it("LOCKS on a shared container: the briefing advertises no workspace", async () => {
    const { instructions } = await bootDirectory(
      [STANDARD, OTHER_STANDARD, SHARED_CONTAINER],
      "id-shared",
    );

    expect(instructions).not.toContain("alpha");
    expect(instructions).not.toContain("beta");
  });

  it("🔒 the lock is WIRED: `list_workspaces` names the container ALONE", async () => {
    // Drives the real meta-tool through the real directory `createServer` built.
    // Without this, dropping `lockedTo` on the way into
    // `createWorkspaceDirectory` leaves every other assertion here green.
    const booted = await bootDirectory(
      [STANDARD, OTHER_STANDARD, SHARED_CONTAINER],
      "id-shared",
    );
    const text = await booted.listWorkspaces();

    expect(text).toContain("shared-c");
    expect(text).not.toContain("alpha");
    expect(text).not.toContain("beta");
  });

  it("does NOT lock on a SOLO container — today's behaviour, untouched", async () => {
    const booted = await bootDirectory(
      [STANDARD, OTHER_STANDARD, SOLO_CONTAINER],
      "id-solo",
    );

    expect(booted.instructions).toContain("alpha");
    expect(booted.instructions).toContain("beta");
    const text = await booted.listWorkspaces();
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
  });

  it("does NOT lock on a pinned STANDARD workspace", async () => {
    const { instructions } = await bootDirectory(
      [STANDARD, OTHER_STANDARD],
      "id-std",
    );

    expect(instructions).toContain("beta");
  });

  it("🔒 an ABSENT memberCount LOCKS — unknown is not solo", async () => {
    // §8 inverted on purpose. An older server sends no count; the reflex
    // fallback would unlock every container for the length of a release window.
    const { instructions } = await bootDirectory(
      [STANDARD, OTHER_STANDARD, COUNTLESS_CONTAINER],
      "id-old",
    );

    expect(instructions).not.toContain("alpha");
    expect(instructions).not.toContain("beta");
  });

  it("🔒 dopl_home DOES NOT ENUMERATE under a lock — one room, no evidence of another", async () => {
    // ⚠ THE ORACLE THIS CLOSES: `/api/home/channels` answers the whole account,
    // so without `home-scopes.ts › narrowToLock` a session pinned into a shared
    // room would hand its operator's PEER the ids of every other room the
    // operator is in.
    const booted = await bootDirectory(
      [STANDARD, OTHER_STANDARD, SHARED_CONTAINER, SOLO_CONTAINER],
      "id-shared",
    );
    const text = await booted.listHomeChannels();

    expect(text).toContain("With Dana");
    expect(text).toContain("id-shared");
    // ⚠ Neither the NAME nor the ID of the other room may appear.
    expect(text).not.toContain("My own room");
    expect(text).not.toContain("id-solo");
  });

  it("an UNLOCKED session's dopl_home lists every home channel", async () => {
    // ⚠ The other direction: a narrowing that always narrowed would pass the
    // assertion above while breaking the tool for everybody.
    const booted = await bootDirectory([STANDARD], null);
    const text = await booted.listHomeChannels();

    expect(text).toContain("With Dana");
    expect(text).toContain("My own room");
  });

  it("does not lock when there is no pin at all", async () => {
    const { instructions } = await bootDirectory([STANDARD, SHARED_CONTAINER]);

    expect(instructions).toContain("alpha");
  });
});

describe("WorkspaceDirectory — the lock itself", () => {
  function lockedDirectory(rows: WorkspaceListItem[]) {
    return createWorkspaceDirectory(mockClient(rows), {
      directory: rows,
      lockedTo: SHARED_CONTAINER,
    });
  }

  it("getWorkspaceList answers the container ALONE", async () => {
    const list = await lockedDirectory([
      STANDARD,
      OTHER_STANDARD,
      SHARED_CONTAINER,
    ]).getWorkspaceList();

    expect(list.map((w) => w.id)).toEqual(["id-shared"]);
  });

  it("resolveWorkspaceRef answers null for every OTHER workspace, by id and slug", async () => {
    const dir = lockedDirectory([STANDARD, OTHER_STANDARD, SHARED_CONTAINER]);

    expect(await dir.resolveWorkspaceRef("id-std")).toBeNull();
    expect(await dir.resolveWorkspaceRef("alpha")).toBeNull();
    expect(await dir.resolveWorkspaceRef("id-std2")).toBeNull();
    expect(await dir.resolveWorkspaceRef("beta")).toBeNull();
  });

  it("resolveWorkspaceRef still resolves the container, by id AND by slug", async () => {
    const dir = lockedDirectory([STANDARD, SHARED_CONTAINER]);

    expect((await dir.resolveWorkspaceRef("id-shared"))?.id).toBe("id-shared");
    expect((await dir.resolveWorkspaceRef("shared-c"))?.id).toBe("id-shared");
  });

  it("a refused ref costs NO directory refresh — no oracle, no round trip", async () => {
    const client = mockClient([STANDARD, SHARED_CONTAINER]);
    const dir = createWorkspaceDirectory(client, {
      directory: [STANDARD, SHARED_CONTAINER],
      lockedTo: SHARED_CONTAINER,
    });

    await dir.resolveWorkspaceRef("id-std");

    expect(client.listWorkspaces).not.toHaveBeenCalled();
  });

  it("an UNLOCKED directory is unchanged — the lock is opt-in", async () => {
    const dir = createWorkspaceDirectory(
      mockClient([STANDARD, SHARED_CONTAINER]),
      { directory: [STANDARD, SHARED_CONTAINER] },
    );

    expect((await dir.getWorkspaceList()).map((w) => w.id)).toEqual(["id-std"]);
    expect((await dir.resolveWorkspaceRef("id-shared"))?.id).toBe("id-shared");
  });
});
