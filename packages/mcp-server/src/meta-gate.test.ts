/**
 * THE META REGISTRATION PATH IS GATED, AND THIS IS THE ONLY PROOF.
 *
 * `registerMetaTool` publishes STRAIGHT onto the SDK server, bypassing
 * `registerTool`'s wrapper by construction, so `registrar.ts` calls the gates
 * explicitly on two of its own lines. ⚠ Both lines are INERT for today's two
 * meta-tools (neither is hidden, blocked, or carries an `op`), so without this
 * file they could be deleted with every other test still green.
 *
 * ⚠ SYNTHETIC NAMES on purpose: the gates do not fire on `list_workspaces`,
 * which is the whole problem. The subject is the PATH, not today's two tools.
 * Registered against the REAL gate tables and driven through a real MCP
 * `Client` over `InMemoryTransport`.
 *
 * ⚠ THE SUPPRESSION LEG DRIVES THE PROFILE OFFER, NOT A NAME TABLE
 * (2026-09-02). `HIDDEN_TOOLS` is legitimately empty — it is the
 * hide-before-delete seam, and `READ_ONLY_BLOCKED_TOOLS` was deleted with the
 * five `_admin` tools it held — and an empty table cannot suppress anything, so
 * pinning against one is the vacuous pass this file exists to prevent.
 * `createGates` takes the RESOLVED offer set rather than a profile name
 * precisely so this file can hand it a synthetic one: the subject is the LINE,
 * and a real `gating.ts › PROFILE_TOOLS` row reaches it the same way — that
 * table's own rows are driven end to end by `tool-profile.test.ts`.
 * `HIDDEN_TOOLS`'s emptiness is pinned as a value in `tools/delete-block.test.ts`.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createToolRegistrars } from "./registrar.js";
import { createGates } from "./gating.js";
import { HIDDEN_TOOLS } from "./gating.js";
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
 * A name OUTSIDE the profile offer below, registered through the narrowed
 * registrar. ⚠ Synthetic like the other two: the offer set is data, so the
 * fixture is the set, and there is no table to drift from.
 */
const SUPPRESSED_NAME = "synthetic_out_of_profile";
/**
 * The profile's whole offer, applied to the SECOND registrar below. Everything not
 * in it is absent from `tools/list`. ⚠ `dopl_kb` is the one name that registrar
 * publishes, so the set is exactly "what survives", and the two legs below
 * assert both polarities of the same line.
 */
const PROFILE_OFFER = new Set(["dopl_kb"]);
/**
 * An `_admin` name in NO table, so only `DELETE_OP_SHAPE` — the fail-closed
 * half — can refuse it. That is the half a future meta-tool relies on.
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
  // ⚠ WRITE-CAPABLE on purpose: the delete refusal is unconditional, so gating
  // it behind a read-only session proves the weaker thing.
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

  // Second registrar on the SAME server for the read-only scope gate: a
  // meta-tool carrying a WRITE op must be refused without `dopl.write`. ⚠ It
  // also carries the PROFILE offer, so one registrar drives both narrowing
  // axes and neither can hide the other's line going missing.
  const readOnly = createToolRegistrars({
    server,
    gates: createGates(false, PROFILE_OFFER),
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
  // Suppression leg: a name outside the profile's offer must not publish at all.
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
  it("the fixture really is outside the offer this registrar was built with", () => {
    // ⚠ An offer that had grown to include the name would pass vacuously.
    expect(PROFILE_OFFER.has(SUPPRESSED_NAME)).toBe(false);
  });

  it("the NAME table is empty, which is WHY this drives the profile offer", () => {
    // ⚠ This file's fixture choice depends on it: the day a name goes back into
    // `HIDDEN_TOOLS`, this fails, and that is the prompt to add a suppression
    // leg driving the real table.
    expect([...HIDDEN_TOOLS]).toEqual([]);
  });

  it("a tool INSIDE the offer still registers — it narrows, it does not empty", async () => {
    // ⚠ The other polarity, and the one a fail-closed bug would break:
    // `isSuppressedTool` returning true for everything passes every assertion
    // above and leaves the session with no tools at all.
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toContain("dopl_kb");
  });

  it("a SUPPRESSED meta-tool is absent from tools/list — not registered at all", async () => {
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).not.toContain(SUPPRESSED_NAME);
  });

  it("…and it is not merely unlisted: calling it fails as an UNKNOWN tool", async () => {
    // ⚠ "Suppress, don't refuse" means the tool does not EXIST — not-found, a
    // different sentence from a policy refusal. Drop suppression and the call
    // succeeds with `handlers.hidden` running.
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
    // ⚠ Fires BEFORE the handler, so a refused delete cannot half-happen.
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
