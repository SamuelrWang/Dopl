/**
 * F-146 — THE META REGISTRATION PATH IS GATED, AND THIS IS THE ONLY PROOF.
 *
 * THE HOLE IN THE TEST SUITE, not in the code. `registerMetaTool` publishes
 * STRAIGHT onto the SDK server, bypassing `registerTool`'s wrapper by
 * construction, so `registrar.ts` calls the gates explicitly on its own two
 * lines — the suppression check at registration and the `opRefusal` check per
 * call. Both lines could be DELETED and all 548 tests still passed, because
 * they are inert for today's two meta-tools: `list_workspaces` and
 * `current_workspace` are neither hidden, nor blocked, nor carry an `op`. A
 * gate nothing exercises is a gate nobody will notice losing, and the comment
 * above those lines says "do not make it worse" — which is only enforceable if
 * something breaks when someone does.
 *
 * SO THIS FILE MAKES THEM NON-INERT, with the REAL gate tables rather than a
 * mock of them: it registers synthetic meta-tools whose names and ops land in
 * the gating tables and the §2b delete policy, and asks a real MCP `Client`
 * over a real `InMemoryTransport` what it can see and call. Delete either line
 * in `registrar.ts` and a test here goes red naming which gate went missing.
 *
 * ⚠ THE SUPPRESSION LEG DRIVES `READ_ONLY_BLOCKED_TOOLS`, NOT `HIDDEN_TOOLS`.
 * It used to use a `HIDDEN_TOOLS` name (`dopl_workflow`), and that table is
 * EMPTY as of 2026-08-11 — workflows and clusters were its only entries and
 * they were deleted outright. An empty table cannot suppress anything, so
 * pinning the gate against it would be exactly the vacuous pass this file
 * exists to prevent. `isSuppressedTool` is ONE function reading BOTH tables on
 * the same line of `registrar.ts`, so driving it through the non-empty one
 * proves the same line still runs. The empty state of `HIDDEN_TOOLS` is pinned
 * separately, as a value, in `tools/delete-block.test.ts`.
 *
 * WHY SYNTHETIC NAMES. Pinning the behavior against `list_workspaces` is
 * impossible — the gates do not fire on it, which is the whole problem. The
 * subject under test is the PATH, not the two tools that happen to use it
 * today, and the next meta-tool is exactly the one nobody will re-audit.
 *
 * NOT MOCKED, following `strict-args.test.ts`: `createGates` is the real one
 * reading the real `HIDDEN_TOOLS` / `DELETE_BLOCKED_OPS` / `WRITE_OPS` tables,
 * so a table edit that silently un-hides a tool is caught here too.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createToolRegistrars } from "./registrar.js";
import { createGates } from "./gating.js";
import { HIDDEN_TOOLS, READ_ONLY_BLOCKED_TOOLS } from "./gating.js";
import { DELETE_REFUSAL } from "./delete-policy.js";
import { UNKNOWN_CALLER } from "./tools/identity.js";
import type { WorkspaceDirectory } from "./workspace-directory.js";

/** `registerMetaTool` never touches the directory — only `registerTool` does. */
const unusedDirectory = {
  getWorkspaceList: vi.fn(async () => []),
  resolveWorkspaceRef: vi.fn(async () => null),
  noWorkspaceError: vi.fn(async () => ({
    isError: true,
    content: [{ type: "text" as const, text: "no workspace" }],
  })),
} as unknown as WorkspaceDirectory;

/**
 * A name `READ_ONLY_BLOCKED_TOOLS` suppresses. Registered below through the
 * READ-ONLY registrar, which is the posture in which that table bites; the
 * fixture is asserted against the real table before it is trusted.
 */
const SUPPRESSED_NAME = "dopl_kb_admin";
/**
 * An `_admin` name that is NOT in any table, so only `DELETE_OP_SHAPE` — the
 * fail-closed half of §2b — can refuse it. That is the half a future meta-tool
 * would actually rely on.
 */
const ADMIN_NAME = "synthetic_admin";
/** A name no gate touches: the control that proves the path works at all. */
const OPEN_NAME = "synthetic_meta";

let client: Client;
const handlers = {
  hidden: vi.fn(async () => ({ content: [{ type: "text" as const, text: "hidden ran" }] })),
  admin: vi.fn(async () => ({ content: [{ type: "text" as const, text: "admin ran" }] })),
  open: vi.fn(async () => ({ content: [{ type: "text" as const, text: "open ran" }] })),
  writeGated: vi.fn(async () => ({ content: [{ type: "text" as const, text: "write ran" }] })),
};

beforeAll(async () => {
  const server = new McpServer({ name: "dopl-test", version: "0.0.0" });
  // A WRITE-CAPABLE session on purpose: the delete refusal is unconditional
  // (§2b), so gating it behind a read-only session would prove the weaker
  // thing. The read-only leg gets its own registrar below.
  const { registerMetaTool } = createToolRegistrars({
    server,
    gates: createGates(true),
    directory: unusedDirectory,
    activeWorkspace: null,
    sessionEffective: () => null,
    caller: UNKNOWN_CALLER,
  });

  registerMetaTool(
    ADMIN_NAME,
    "a synthetic admin meta-tool",
    { op: z.string() },
    handlers.admin,
  );
  registerMetaTool(OPEN_NAME, "an ungated meta-tool", { op: z.string() }, handlers.open);

  // A second registrar on the SAME server for the read-only scope gate — a
  // meta-tool carrying a WRITE op must be refused when the token lacks
  // `dopl.write`, exactly as a domain tool would be.
  const readOnly = createToolRegistrars({
    server,
    gates: createGates(false),
    directory: unusedDirectory,
    activeWorkspace: null,
    sessionEffective: () => null,
    caller: UNKNOWN_CALLER,
  });
  readOnly.registerMetaTool(
    "dopl_kb",
    "a synthetic meta-tool wearing a real WRITE_OPS name",
    { op: z.string() },
    handlers.writeGated,
  );
  // The suppression leg: a READ_ONLY_BLOCKED_TOOLS name on the read-only
  // registrar must not publish at all.
  readOnly.registerMetaTool(
    SUPPRESSED_NAME,
    "should never be published",
    {},
    handlers.hidden,
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client?.close();
});

describe("registerMetaTool runs isSuppressedTool (registrar.ts:299)", () => {
  it("the table this pins against is real and still suppresses the name", () => {
    // A test whose fixture drifted out of the table would pass vacuously.
    expect(READ_ONLY_BLOCKED_TOOLS.has(SUPPRESSED_NAME)).toBe(true);
  });

  it("HIDDEN_TOOLS is empty, which is WHY this drives the other table", () => {
    // Stated here as well as in `delete-block.test.ts`, because this is the
    // file whose fixture choice depends on it: the day a name goes back into
    // `HIDDEN_TOOLS`, this expectation fails and the failure is the prompt to
    // add a second suppression leg driving that table too.
    expect([...HIDDEN_TOOLS]).toEqual([]);
  });

  it("a SUPPRESSED meta-tool is absent from tools/list — not registered at all", async () => {
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).not.toContain(SUPPRESSED_NAME);
  });

  it("…and it is not merely unlisted: calling it fails as an UNKNOWN tool", async () => {
    // "Suppress, don't refuse" means the tool does not EXIST — the failure
    // names it as not found, which is a different sentence from a policy
    // refusal. If suppression were dropped the call would succeed and
    // `handlers.hidden` would run.
    const res = await client.callTool({ name: SUPPRESSED_NAME, arguments: {} });
    expect(res.isError).toBe(true);
    expect(
      (res.content as Array<{ text: string }>).map((c) => c.text).join(""),
    ).toContain("not found");
    expect(handlers.hidden).not.toHaveBeenCalled();
  });

  it("the control registers, so absence above is the GATE and not a broken fixture", async () => {
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toContain(OPEN_NAME);
  });
});

describe("registerMetaTool runs opRefusal (registrar.ts:303)", () => {
  it("a delete op on a meta-tool is refused by §2b, and the handler never runs", async () => {
    const res = await client.callTool({
      name: ADMIN_NAME,
      arguments: { op: "delete_everything" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>).map((c) => c.text).join("");
    expect(text).toContain(DELETE_REFUSAL);
    // The refusal is the POINT: it fires before the handler, so a refused
    // delete cannot half-happen.
    expect(handlers.admin).not.toHaveBeenCalled();
  });

  it("a WRITE op on a read-only session's meta-tool is refused too", async () => {
    const res = await client.callTool({
      name: "dopl_kb",
      arguments: { op: "create_base" },
    });
    expect(res.isError).toBe(true);
    expect(
      (res.content as Array<{ text: string }>).map((c) => c.text).join(""),
    ).toContain("read-only");
    expect(handlers.writeGated).not.toHaveBeenCalled();
  });

  it("a non-refused op still reaches its handler (the gate is not a wall)", async () => {
    const res = await client.callTool({ name: OPEN_NAME, arguments: { op: "read" } });
    expect(res.isError).toBeFalsy();
    expect(handlers.open).toHaveBeenCalledTimes(1);
    expect(
      (res.content as Array<{ text: string }>).map((c) => c.text).join(""),
    ).toContain("open ran");
  });
});
