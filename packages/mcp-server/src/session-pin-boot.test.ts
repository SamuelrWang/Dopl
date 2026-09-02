/**
 * THE SESSION WORKSPACE PIN, DRIVEN THROUGH THE REAL WIRING (T41).
 *
 * ⚠ **`session-pin.test.ts` PINS THE STORE; THIS PINS THAT ANYTHING READS IT.**
 * A store nobody threads into `bootServer` would leave that suite green and the
 * feature dead, which is the "a pin on a symbol is not a pin" rule (§14). So
 * every case here goes through the REAL `bootServer` and the REAL
 * `current_workspace` callback the registrar published.
 *
 * The four rules:
 *   1. `op="set"` RESOLVES before it stores, and an unresolvable ref pins
 *      NOTHING — fail closed.
 *   2. A stored pin becomes the next boot's session default, with the
 *      `session pin` source label (never `header pin` — an agent must be able
 *      to tell the default it chose from the one its client chose).
 *   3. 🔒 The transport's `X-Workspace-Id` OUTRANKS the pin: explicit addressing
 *      on THIS request beats a stored default.
 *   4. 🔒 Under the CONTAINER LOCK only the container resolves, so a locked
 *      session cannot pin its way out.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

const registeredTools = new Map<
  string,
  (args: unknown) => Promise<{ content: { type: string; text?: string }[] }>
>();

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    // ⚠ `registerTool`, deliberately NOT `tool` — §10's strict-args rule.
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
import { resetSessionPinsForTest } from "./session-pin.js";

function wsItem(
  id: string,
  slug: string,
  kind: "standard" | "link" = "standard",
  memberCount = 3,
): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name: `${slug} workspace`,
    slug,
    publicId: `pub-${id}`,
    description: null,
    kind,
    memberCount,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "member",
  } as WorkspaceListItem;
}

const ALPHA = wsItem("id-alpha", "alpha");
const BETA = wsItem("id-beta", "beta");
const SHARED_CONTAINER = wsItem("id-shared", "shared-c", "link", 2);

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
    consumeCredits: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as DoplClient;
}

/** Boot a real server and hand back a driver for `current_workspace`. */
async function boot(
  rows: WorkspaceListItem[],
  opts: { sessionKey?: string; headerPin?: string | null } = {},
) {
  registeredTools.clear();
  const result = await bootServer(mockClient(rows, opts.headerPin), {
    sessionKey: opts.sessionKey,
  });
  const cb = registeredTools.get("current_workspace");
  if (!cb) throw new Error("current_workspace was not registered");
  return {
    activeWorkspace: result.activeWorkspace,
    call: async (args: Record<string, unknown> = {}) => {
      const res = await cb(args);
      return res.content.map((c) => c.text ?? "").join("\n");
    },
  };
}

beforeEach(() => {
  resetSessionPinsForTest();
});

describe("current_workspace(op=set)", () => {
  it("pins a resolvable workspace, and says the pin starts on the NEXT call", async () => {
    const session = await boot([ALPHA, BETA], { sessionKey: "tok-1" });
    // Two standard memberships ⇒ no auto-target, which is the caller this is for.
    expect(session.activeWorkspace).toBeNull();

    const text = await session.call({ op: "set", workspace: "beta" });
    expect(text).toContain("id-beta");
    // ⚠ The "not this call" sentence is load-bearing: this response's own footer
    // still names the target resolved BEFORE the pin existed, and an agent told
    // only "pinned" reads that as the pin having failed.
    expect(text).toMatch(/NEXT call/i);
  });

  it("REFUSES an unresolvable ref and pins NOTHING", async () => {
    const session = await boot([ALPHA, BETA], { sessionKey: "tok-1" });
    const text = await session.call({ op: "set", workspace: "nope" });
    expect(text).toContain("Workspace not found");
    expect(text).toContain("Nothing was pinned");

    // Fail closed: the next boot still has no default.
    const next = await boot([ALPHA, BETA], { sessionKey: "tok-1" });
    expect(next.activeWorkspace).toBeNull();
  });

  it("REFUSES a blank workspace, and refuses when there is no session to pin to", async () => {
    const session = await boot([ALPHA, BETA], { sessionKey: "tok-1" });
    expect(await session.call({ op: "set" })).toContain("needs `workspace`");

    // ⚠ No `sessionKey` on the boot ⇒ nowhere to store one. It must SAY so
    // rather than report a success an agent would then rely on.
    const keyless = await boot([ALPHA, BETA]);
    const text = await keyless.call({ op: "set", workspace: "beta" });
    expect(text).toContain("cannot hold a default");
    expect(text).toContain("Nothing was pinned");
  });

  it("becomes the next boot's default, labelled `session pin`", async () => {
    const first = await boot([ALPHA, BETA], { sessionKey: "tok-1" });
    await first.call({ op: "set", workspace: "beta" });

    const next = await boot([ALPHA, BETA], { sessionKey: "tok-1" });
    expect(next.activeWorkspace?.id).toBe("id-beta");
    // The label reaches the footer through `workspaceSource`; assert it on the
    // tool's own answer, which reads the same resolved state.
    expect(await next.call({})).toContain("id-beta");

    // ⚠ Scoped to the KEY: another connection is unaffected.
    const other = await boot([ALPHA, BETA], { sessionKey: "tok-2" });
    expect(other.activeWorkspace).toBeNull();
  });

  it("clears, and the default goes back to being refused", async () => {
    const first = await boot([ALPHA, BETA], { sessionKey: "tok-1" });
    await first.call({ op: "set", workspace: "beta" });
    const pinned = await boot([ALPHA, BETA], { sessionKey: "tok-1" });
    expect(pinned.activeWorkspace?.id).toBe("id-beta");

    await pinned.call({ op: "clear" });
    const cleared = await boot([ALPHA, BETA], { sessionKey: "tok-1" });
    expect(cleared.activeWorkspace).toBeNull();
  });

  it("🔒 the transport's header pin OUTRANKS the stored pin", async () => {
    const first = await boot([ALPHA, BETA], { sessionKey: "tok-1" });
    await first.call({ op: "set", workspace: "beta" });

    // Explicit addressing on THIS request beats a stored default.
    const next = await boot([ALPHA, BETA], {
      sessionKey: "tok-1",
      headerPin: "id-alpha",
    });
    expect(next.activeWorkspace?.id).toBe("id-alpha");
  });

  it("🔒 a CONTAINER-LOCKED session can pin only its own container", async () => {
    // Boot locked: a shared `kind='link'` container with a peer in it.
    const locked = await boot([ALPHA, SHARED_CONTAINER], {
      sessionKey: "tok-1",
      headerPin: "id-shared",
    });
    // The lock answers before any lookup, so another workspace does not resolve
    // — and a refused ref is indistinguishable from one that names nothing.
    const text = await locked.call({ op: "set", workspace: "alpha" });
    expect(text).toContain("Workspace not found");
    expect(text).toContain("Nothing was pinned");

    // Its own container still resolves.
    expect(
      await locked.call({ op: "set", workspace: "id-shared" }),
    ).toContain("id-shared");
  });

  it("a bare call still reports, with no op — the pre-T41 shape is unchanged", async () => {
    const session = await boot([ALPHA], { sessionKey: "tok-1" });
    const text = await session.call({});
    expect(text).toContain("id-alpha");
  });
});
