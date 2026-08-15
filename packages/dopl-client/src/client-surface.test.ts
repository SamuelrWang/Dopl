/**
 * THE GUARD ON THE PER-DOMAIN CLIENT SPLIT — `DoplClient` must look identical
 * to a caller however its methods are distributed across the
 * `client-<domain>.ts` chain (see `client-base.ts`). The package's other test
 * files touch almost none of the surface, so a method lost in a move would go
 * green without this.
 *
 *  1. THE SURFACE. `PUBLIC_SURFACE` is the frozen method list — the API
 *     `@dopl/mcp-server` and the app compile against. Checked BOTH ways: every
 *     frozen name resolves to a function on an instance, and the prototype
 *     chain exposes nothing off the list. Adding a method to a link means
 *     adding it here, deliberately.
 *
 *  2. THE ROUTES THAT MOVED — path, verb, tool header, and the
 *     `encodeURIComponent` on every interpolated segment (the detail a move is
 *     most likely to drop). Only `workspaces.ts` remains pinned; the
 *     `encodeURIComponent` assertion survives on `getWorkspace`.
 */

import { afterEach, describe, expect, it } from "vitest";

import { DoplClient } from "./client.js";

const BASE = "https://api.example.test";

/**
 * Every public method of `DoplClient`, extracted mechanically from a `.d.ts`,
 * not typed by hand. docs/ENGINEERING.md defers to this arithmetic — keep it
 * stated, so a diff of seven or eighteen reads as a deliberate change rather
 * than the class silently eating methods:
 *
 *   92 — HEAD's `client.d.ts` at the split (93 members, less constructor)
 *   85 — less the SEVEN the trash teardown removed in the same working tree
 *        (`listChatsTrash`, `listKbTrash`, `restoreChat`, `restoreKbBase`,
 *        `restoreKbEntry`, `restoreKbFolder`, `restoreOntologyCluster`). The
 *        split itself moved declarations between files and dropped none.
 *   67 — less the EIGHTEEN that went with the workflows + clusters deletion
 *        (five `*Cluster` + thirteen `*Workflow*`), along with `clusters.ts`,
 *        `workflows.ts` and both of their chain links.
 *   68 — PLUS ONE: `consumeCredits`, added with the `BillingMethods` link
 *        (`client-billing.ts`). First ADDITION this list has recorded — every
 *        prior delta was a removal — so stated as one, not folded in.
 */
const PUBLIC_SURFACE = [
  "appendChatMessages",
  "awaitChannelMessages",
  "claimOntologyAnchor",
  "closeChannelThread",
  "consumeCredits",
  "createChannel",
  "createChannelThread",
  "createChatFolder",
  "createKbBase",
  "createKbFolderByPath",
  "createOntologyCluster",
  "createOntologyObject",
  "createSkill",
  "deleteChat",
  "deleteChatFolder",
  "deleteKbBase",
  "deleteKbByPath",
  "deleteOntologyCluster",
  "deleteOntologyObject",
  "deleteSkill",
  "exportChat",
  "getAccessMatrix",
  "getActiveWorkspace",
  "getBaseUrl",
  "getChannel",
  "getChannelThread",
  "getChat",
  "getKbBase",
  "getKbTree",
  "getMemberAccess",
  "getMyAccess",
  "getMyMembership",
  "getOntology",
  "getOntologyAnchor",
  "getSkill",
  "getWorkspace",
  "getWorkspaceId",
  "inviteToChannel",
  "listChannelMembers",
  "listChannelSessions",
  "listChannelThreads",
  "listChannels",
  "listChatFolders",
  "listChats",
  "listKbBases",
  "listKbDirByPath",
  "listSkills",
  "listWorkspaceMembers",
  "listWorkspaceTeams",
  "listWorkspaces",
  "moveKbByPath",
  "pingMcpStatus",
  "postChannelMessage",
  "proposeChannelThreadClose",
  "readChannelMessages",
  "readKbFileByPath",
  "readSkillBody",
  "searchKb",
  "setChannelThreadMode",
  "setWorkspaceId",
  "updateChat",
  "updateChatFolder",
  "updateKbBase",
  "updateOntologyCluster",
  "updateOntologyObject",
  "updateSkill",
  "writeKbFileByPath",
  "writeSkillBody",
] as const;

/** Every method reachable on an instance, across the whole chain. */
function prototypeChainMethods(instance: object): string[] {
  const names = new Set<string>();
  let proto: object | null = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      names.add(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...names].sort();
}

describe("DoplClient public surface (frozen across the §2 split)", () => {
  const client = new DoplClient(BASE, "k");

  it("still exposes every method the pre-split class declared", () => {
    const missing = PUBLIC_SURFACE.filter(
      (name) => typeof (client as unknown as Record<string, unknown>)[name] !== "function"
    );
    expect(missing).toEqual([]);
  });

  it("exposes NOTHING beyond that list (the chain adds no surface)", () => {
    expect(prototypeChainMethods(client)).toEqual([...PUBLIC_SURFACE].sort());
  });

  it("is a single flat class — no sub-client namespaces were introduced", () => {
    // The tempting shortcut that would break every caller:
    // `client.kb.listBases()` instead of `client.listKbBases()`.
    for (const ns of ["workspaces", "kb", "channels", "skills"]) {
      expect((client as unknown as Record<string, unknown>)[ns]).toBeUndefined();
    }
  });

  it("keeps the constructor's three-argument shape", () => {
    const withOpts = new DoplClient(BASE, "k", { clientIdentifier: "x@1" });
    expect(withOpts.getBaseUrl()).toBe(BASE);
    expect(withOpts.getWorkspaceId()).toBeNull();
    withOpts.setWorkspaceId("ws-1");
    expect(withOpts.getWorkspaceId()).toBe("ws-1");
  });
});

interface Wire {
  path: string;
  method: string;
  tool: string | undefined;
}

/** Captures the single request a method makes: path / verb / tool header. */
function captureWire(): { wires: Wire[]; restore: () => void } {
  const wires: Wire[] = [];
  const original = global.fetch;
  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    wires.push({
      path: String(input).replace(BASE, ""),
      method: init?.method ?? "GET",
      tool: headers["X-MCP-Tool"],
    });
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    wires,
    restore: () => {
      global.fetch = original;
    },
  };
}

describe("routes that MOVED out of client.ts", () => {
  let cap: ReturnType<typeof captureWire>;
  afterEach(() => cap?.restore());

  async function wireOf(call: (c: DoplClient) => Promise<unknown>): Promise<Wire> {
    cap = captureWire();
    await call(new DoplClient(BASE, "k"));
    expect(cap.wires).toHaveLength(1);
    return cap.wires[0];
  }

  const cases: Array<[string, (c: DoplClient) => Promise<unknown>, Wire]> = [
    // ── workspaces.ts ────────────────────────────────────────────────
    ["listWorkspaces", (c) => c.listWorkspaces(), { path: "/api/workspaces", method: "GET", tool: "list_workspaces" }],
    ["getWorkspace", (c) => c.getWorkspace("s p"), { path: "/api/workspaces/s%20p", method: "GET", tool: "get_workspace" }],
    ["getActiveWorkspace", (c) => c.getActiveWorkspace(), { path: "/api/workspaces/me", method: "GET", tool: "get_active_workspace" }],
    ["pingMcpStatus", (c) => c.pingMcpStatus(), { path: "/api/user/mcp-status", method: "POST", tool: "_mcp_status_ping" }],
  ];

  for (const [name, call, expected] of cases) {
    it(`${name} hits ${expected.method} ${expected.path}`, async () => {
      expect(await wireOf(call)).toEqual(expected);
    });
  }

  /**
   * Not a moved route — pinned because what makes it correct is invisible at
   * the call site: the charged workspace rides an EXPLICIT per-request
   * override (the registrar calls it outside the handler's AsyncLocalStorage
   * scope on one of its two paths), and POST is outside `IDEMPOTENT_METHODS`
   * so the transport never retries a spend.
   */
  it("consumeCredits POSTs the consume route with an explicit workspace header", async () => {
    cap = captureWire();
    const original = global.fetch;
    const headers: Array<Record<string, string>> = [];
    global.fetch = (async (...args: Parameters<typeof fetch>) => {
      headers.push((args[1]?.headers ?? {}) as Record<string, string>);
      return original(...args);
    }) as typeof fetch;
    await new DoplClient(BASE, "k").consumeCredits("ws-42");
    global.fetch = original;

    expect(cap.wires).toEqual([
      {
        path: "/api/mcp/credits/consume",
        method: "POST",
        tool: "_mcp_credits_consume",
      },
    ]);
    expect(headers[0]["X-Workspace-Id"]).toBe("ws-42");
  });

  it("pingMcpStatus still normalises a missing envelope to false / null", async () => {
    cap = captureWire();
    const res = await new DoplClient(BASE, "k").pingMcpStatus();
    expect(res).toEqual({ is_admin: false, user_id: null });
  });
});
