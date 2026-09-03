/**
 * `dopl_workspaces(op="create_home_channel")` — the op B13 retired with
 * `dopl_home` and the integration put back (F-621).
 *
 * 🔒 **THE THING THIS FILE EXISTS FOR IS THE DEFAULT.** `op` is OPTIONAL, so an
 * agent that has lost its bearings still calls this tool with `{}` — and
 * `gating.ts › opRefusal` returns `null` for an ABSENT op, because an op-less
 * tool has nothing to gate. **A default that wrote would therefore be a write no
 * scope gate ever sees.** The default is the READ, and the case below is what
 * would notice if it stopped being.
 *
 * ⚠ The write GATE itself is `meta-gate.test.ts`'s — it drives the real
 * `registrar.ts` line through a real MCP client — and the table entry is
 * `parity.test.ts`'s. This file is the HANDLER's dispatch and its result.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DoplClient } from "@dopl/client";
import type { ZodRawShape } from "zod";

import { registerWorkspaceMetaTools } from "./meta-tools.js";
import { UNKNOWN_CALLER } from "./tools/identity.js";
import type { ToolResponse } from "./tools/respond.js";
import type { WorkspaceDirectory } from "./workspace-directory.js";

type Handler = (args: Record<string, unknown>) => Promise<ToolResponse>;

const createHomeChannel = vi.fn(async ({ name }: { name: string }) => ({
  channel: {
    name,
    workspaceId: "ws-new",
    channelId: "ch-new",
  },
}));

const getWorkspaceList = vi.fn(async () => [
  {
    id: "ws-1",
    slug: "alpha",
    name: "Alpha",
    role: "member",
    kind: "standard",
  },
]);

function boot(): { handler: Handler; schema: ZodRawShape } {
  let captured: { handler: Handler; schema: ZodRawShape } | null = null;
  registerWorkspaceMetaTools(
    ((_name, _description, schema, handler) => {
      captured = { handler: handler as Handler, schema };
    }) as Parameters<typeof registerWorkspaceMetaTools>[0],
    {
      directory: { getWorkspaceList } as unknown as WorkspaceDirectory,
      activeWorkspace: null,
      caller: UNKNOWN_CALLER,
      client: { createHomeChannel } as unknown as DoplClient,
    },
  );
  if (!captured) throw new Error("dopl_workspaces did not register");
  return captured;
}

const textOf = (r: ToolResponse) =>
  r.content.map((c) => ("text" in c ? c.text : "")).join("\n");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dopl_workspaces — dispatch", () => {
  it("🔒 an ABSENT op READS, and mints nothing", async () => {
    // The fail-closed pairing with `opRefusal`'s `op === undefined → null`.
    const { handler } = boot();
    expect(textOf(await handler({}))).toContain("Containers you are in:");
    expect(createHomeChannel).not.toHaveBeenCalled();
  });

  it('an explicit op="list" is the same call', async () => {
    const { handler } = boot();
    expect(textOf(await handler({ op: "list" }))).toContain("Containers you are in:");
    expect(createHomeChannel).not.toHaveBeenCalled();
  });

  it("create_home_channel mints, and says the room cannot be populated over MCP", async () => {
    // ⚠ THE REFUSAL RIDES THE RESULT, carried over from `dopl_home` verbatim.
    // An agent that makes a room and is not told it cannot invite anybody will
    // hunt for an invite op, then a link op, then a members op, and read each
    // absence as a broken connection.
    const { handler } = boot();
    const text = textOf(await handler({ op: "create_home_channel", name: "Ops" }));
    expect(createHomeChannel).toHaveBeenCalledWith({ name: "Ops" });
    expect(text).toContain("Created home channel `Ops`");
    expect(text).toContain("workspace=`ws-new`");
    expect(text).toContain("channel=`ch-new`");
    expect(text).toMatch(/cannot add a person/i);
  });

  it("refuses create_home_channel with no name, and mints nothing", async () => {
    const { handler } = boot();
    const res = await handler({ op: "create_home_channel" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("name");
    expect(createHomeChannel).not.toHaveBeenCalled();
  });

  it("publishes both ops and only the two arguments", () => {
    // ⚠ The schema is what the gate tables and the ratchets are checked
    // against, so it is asserted here rather than inferred from the handler.
    const { schema } = boot();
    expect(Object.keys(schema).sort()).toEqual(["name", "op"]);
  });
});
