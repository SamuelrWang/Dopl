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
 *   66 — less the TWO that went with thread closing (wiring plan Phase 4,
 *        2026-08-18): `closeChannelThread` and `proposeChannelThreadClose`.
 *        The `PATCH /tasks/[id]` route arms behind them are deleted too, so
 *        restoring either binding would 400 rather than fail quietly.
 *   70 — PLUS FOUR with the `AgentTemplateMethods` link (MCP surface v2 wave A,
 *        2026-08-28): `listAgentTemplates`, `getAgentTemplate`,
 *        `createAgentTemplate`, `updateAgentTemplate`. ⚠ FOUR, NOT FIVE — the
 *        DELETE verb is deliberately unbound (`sessionOnly` on the route AND
 *        app-only by standing policy), so there is no `deleteAgentTemplate` to
 *        forget to gate.
 *   75 — PLUS FIVE with wave B (2026-08-28): `getHomeChannels`,
 *        `createHomeChannel` (the `HomeMethods` link), `updateChannel`, and the
 *        two sibling-key payload readers `listKbBasesPayload` /
 *        `listAgentTemplatesPayload`. ⚠ TWO home methods, not five — link MINT,
 *        link REVOKE and the CLAIM are all `sessionOnly` and deliberately
 *        unbound, the same omission the template DELETE makes. ⚠ And the two
 *        `*Payload` readers each DELEGATE to nothing new on the wire: they are
 *        the same request their array sibling makes, so the surface grew by two
 *        names and by zero round trips.
 *   77 — PLUS TWO with the ACCOUNT-WIDE reads (2026-09-01, T20/T21/T22):
 *        `getAccountStatus` and `readAccountMessages`. ⚠ TWO, NOT THREE — the
 *        all-sessions read (T22) is `getAccountStatus({view:"sessions"})`, a
 *        query PARAMETER over one resource rather than a second endpoint
 *        (INVARIANTS §9), so it costs no third name and no third route to gate.
 *   80 — PLUS THREE with PINNED STARTUP CONTEXT (2026-09-01, T81):
 *        `setKbBasePinned`, `setKbEntryPinned` and `getKbStartupContext`.
 *        ⚠ TWO WRITE NAMES FOR ONE FLAG, and that is the count being deliberate
 *        rather than lazy: a base and an entry are different objects with
 *        different gates (the entry write chases the row up to its base), so
 *        folding them into one `setKbPinned(kind, id)` would put two
 *        authorization stories behind one signature. ⚠ And THREE, not five —
 *        each write is ONE method covering both directions, because `pinned` is
 *        an argument choosing the VERB (`PUT`/`DELETE`) rather than a second
 *        binding: two idempotent verbs, never a toggle, and never two names.
 *   83 — PLUS THREE with THE "NEEDS YOU" SIGNAL (2026-09-01, T70): `createPing`,
 *        `listPings`, `awaitPings`.
 *   80 — LESS THOSE SAME THREE (2026-09-02, slice B16, Samuel's ruling B8). The
 *        ping lane is DELETED, table and all: a directed `send` IS the delivery
 *        record, and "what is addressed to me and unanswered" is DERIVED by
 *        `getAccountStatus` from the transcript rather than kept in a second
 *        mailbox. ⚠ **THE NUMBER GOING DOWN IS THE POINT** — this list has only
 *        ever grown by a capability arriving, so a shrink is a capability
 *        leaving, and it must be argued for exactly like an arrival.
 *   81 — PLUS ONE with SECTION READS (2026-09-03): `readKbFilePart`.
 *        ⚠ ONE, NOT TWO, AND NOT A FLAG ON `readKbFileByPath`. The whole-entry
 *        read is on every existing caller's path and answers a different SHAPE
 *        (an entry, not an entry-plus-outline), so widening it would have made
 *        every caller handle a key it did not ask for. ⚠ And there is no
 *        `outlineKbFile`: an outline is `readKbFilePart(…, {outline: true})`, a
 *        query PARAMETER over one resource rather than a second endpoint — the
 *        rule `getAccountStatus({view:"sessions"})` states one lane over
 *        (INVARIANTS §9).
 */
const PUBLIC_SURFACE = [
    // ⚠ +3 on 2026-09-06 (artifacts wave): readChannelArtifact, readChannelTranscript,
    // writeChannelArtifact — new client ops for the artifact feature; a sanctioned pin move.
  "appendChatMessages",
  "awaitChannelMessages",
  // WORKSPACE-WIDE hold (2026-08-22) — one cursor across every channel the
  // caller is a MEMBER of. A SIBLING of the per-channel await, never a flag on
  // it: different fence, different stop rule.
  "awaitWorkspaceMessages",
  "claimOntologyAnchor",
  "consumeCredits",
  "createChannel",
  "createHomeChannel",
  "createLaunchDirective",
  // AGENT MANAGEMENT OVER MCP (2026-09-01, Samuel's end/rename ruling) — ONE more
  // method and no more, because it is the SAME mailbox with a different `kind`.
  // ⚠ THERE IS NO `getAgentDirective` AND THERE MUST NOT BE: the row it files IS a
  // launch directive, so `getLaunchDirective` polls it. A second poll method would
  // be a second name for one endpoint and would invite a second expiry rule.
  "createAgentDirective",
  "createChannelThread",
  "createChatFolder",
  "createAgentTemplate",
  "createKbBase",
  "createKbFolderByPath",
  "createOntologyCluster",
  "createOntologyObject",
  "createSkill",
  "deleteChat",
  "deleteChatFolder",
  // 🔒 THE CREATE'S GATES WITHOUT ITS WRITE (2026-09-06) — one more method over
  // the SAME endpoint (`?dryRun=1`), the `listKbBases`/`listKbBasesPayload`
  // shape, so the MCP confirm class can ask the server whether a create would
  // be accepted BEFORE it mints a token promising one. ⚠ NOT a flag on
  // `createKbBase`: that would make it answer `KnowledgeBase | null`.
  "dryRunKbBase",
  "deleteKbBase",
  "deleteKbByPath",
  "deleteOntologyCluster",
  "deleteOntologyObject",
  "deleteSkill",
  "exportChat",
  "getAccessMatrix",
  // ACCOUNT-WIDE, USER-SCOPED (2026-09-01, T20/T22) — every channel the caller
  // is in, across every workspace AND every home-channel container, in one read.
  // A SIBLING of the per-workspace reads, never a flag on them: different
  // wrapper, different fence, and no workspace argument anywhere on the path.
  "getAccountStatus",
  "getActiveWorkspace",
  "getAgentTemplate",
  "getBaseUrl",
  "getChannel",
  // LAUNCH-OVER-MCP (2026-08-22): file a directive, then poll the row. ⚠ EXACTLY
  // TWO METHODS, and the omissions are the point — CLAIM, DECIDE and the
  // pending-directives LIST are the DESKTOP's lane, reached from
  // `main/launch-directives.js` over its own authenticated fetch. Publishing
  // them here would put "claim another machine's directive" and "enumerate my
  // operator's launch queue" on the SDK every MCP tool holds.
  "getLaunchDirective",
  // THE PRIVATE DIRECT LANE (2026-08-31): file a direction, poll the row, list my own.
  // ⚠ EXACTLY THREE METHODS, AND THE OMISSIONS ARE THE SAME POINT ONE LANE OVER — CLAIM and
  // DECIDE are the DESKTOP's, reached from `main/agent-directions.js` over its own
  // authenticated fetch. Publishing them here would put "claim another machine's direction" on
  // the SDK every MCP tool holds, and — sharper than on the launch lane — would let a tool
  // WRITE the `reply` an operator reads as their own agent's words.
  // ⚠ A THIRD METHOD WHERE LAUNCH HAS TWO, deliberately: a direction has no second surface. A
  // launch's answer is findable in `read_sessions`; a direction's answer IS the row, so without
  // a list a timed-out hold would strand it forever.
  "createAgentDirection",
  "getAgentDirection",
  "listAgentDirections",
  // THE "NEEDS YOU" SIGNAL (2026-09-01): send one, catch up, hold for the next.
  // ⚠ NO ACK / DISMISS / DELETE binding, because v1 has no write on a ping past
  // its insert — a name here for a route arm that does not exist would publish a
  // capability an agent would then plan around.
  "getChannelThread",
  "getChat",
  "getHomeChannels",
  "getKbBase",
  // PINNED STARTUP CONTEXT (2026-09-01, T81) — the capped reading list a
  // session starts with. ⚠ Read `truncated`/`omitted`: a clipped payload that
  // renders as the whole of what is pinned is the bug (INVARIANTS §9).
  "getKbStartupContext",
  "getKbTree",
  "getMemberAccess",
  "getMyAccess",
  "getMyMembership",
  "getOntology",
  "getOntologyAnchor",
  "getSkill",
  "getWorkspace",
  "getWorkspaceId",
  // LEND ONE RESOURCE TO ONE SCOPE (2026-09-02, wave B B15) — the write that
  // replaced the two MCP copy ops. On link 2 because a grant is cross-domain.
  "grantResource",
  "inviteToChannel",
  "listAgentTemplates",
  "listAgentTemplatesPayload",
  "listChannelMembers",
  "listChannelSessions",
  "listChannelThreads",
  "listChannels",
  "listChatFolders",
  "listChats",
  "listKbBases",
  "listKbBasesPayload",
  "listKbDirByPath",
  "listSkills",
  "listWorkspaceMembers",
  "listWorkspaceTeams",
  "listWorkspaces",
  "moveKbByPath",
  "pingMcpStatus",
  "postChannelMessage",
  // ACCOUNT-WIDE cross-channel page (2026-09-01, T21) — one cursor, every
  // channel, because seq is a TABLE-WIDE identity.
  "readAccountMessages",
  "readChannelArtifact",
  "readChannelMessages",
  "readChannelTranscript",
  "readKbFileByPath",
  // SECTION READS (2026-09-03) — one section, or the outline alone.
  "readKbFilePart",
  "readSkillBody",
  "searchKb",
  "setChannelThreadMode",
  // T81 — ONE method per object, each covering BOTH directions: `pinned` picks
  // the verb (PUT/DELETE), so there is no `unpinKbBase` to forget to gate.
  "setKbBasePinned",
  "setKbEntryPinned",
  "setWorkspaceId",
  "updateAgentTemplate",
  "updateChannel",
  "updateChat",
  "updateChatFolder",
  "updateKbBase",
  "updateOntologyCluster",
  "updateOntologyObject",
  "updateSkill",
  "writeChannelArtifact",
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
    ["listWorkspaces", (c) => c.listWorkspaces(), { path: "/api/workspaces", method: "GET", tool: "dopl_workspaces" }],
    ["getWorkspace", (c) => c.getWorkspace("s p"), { path: "/api/workspaces/s%20p", method: "GET", tool: "get_workspace" }],
    ["getActiveWorkspace", (c) => c.getActiveWorkspace(), { path: "/api/workspaces/me", method: "GET", tool: "get_active_workspace" }],
    ["pingMcpStatus", (c) => c.pingMcpStatus(), { path: "/api/user/mcp-status", method: "POST", tool: "_mcp_status_ping" }],
    // ⚠ PUT, not POST: the write states an END STATE and the server upserts on
    // the grant's primary key, so a retry after an ambiguous failure is a no-op.
    [
      "grantResource",
      (c) =>
        c.grantResource({
          resourceType: "knowledge_base",
          resourceId: "kb-1",
          scopeType: "channel",
          scopeId: "ch-1",
          level: "visible",
        }),
      { path: "/api/resource-grants", method: "PUT", tool: "resource_grant" },
    ],
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
