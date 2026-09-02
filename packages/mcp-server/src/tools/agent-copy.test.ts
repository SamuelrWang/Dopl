/**
 * `dopl_agent(op="copy")` — THE TWO-LEG COPY, driven through the REAL registrar.
 *
 * ⚠ THE TOOL IS DRIVEN, NOT THE OP FUNCTION. The routing, the missing-param
 * refusal and the arg names are half of what this ticket ships, and a suite that
 * called `opCopy` directly would stay green through a mis-wired `case`.
 *
 * ⚠ THE LOAD-BEARING ASSERTION IS *WHICH TENANCY EACH CALL RAN IN*, read off
 * `workspaceContext.getStore()` inside the mocked client. Every other property
 * here (private, no cross-tenancy base ids, no copy onto itself) is a claim
 * about a payload; that one is the claim that the write was FENCED where it was
 * meant to be, which is the whole architecture.
 *
 * ⚠ TRIPWIRE, NOT CONTAINMENT — the container-lock case pins that the TOOL will
 * not aim a copy at another room, not that the server would accept one.
 */

import { describe, expect, it, vi } from "vitest";
import { workspaceContext } from "@dopl/client";
import type {
  AgentTemplate,
  AgentTemplateCreateInput,
  DoplClient,
  WorkspaceListItem,
} from "@dopl/client";
import { createWorkspaceDirectory, type WorkspaceDirectory } from "../workspace-directory.js";
import { registerAgentTools } from "./agent.js";
import type { RegisterTool, ToolResponse } from "./respond.js";

const SOURCE_WS = "ws-source";
const TARGET_WS = "ws-target";
/** ⚠ Real UUIDs: `agent-shared.ts › resolveTemplateRef` matches an id ONLY when
 *  it is UUID-shaped, and falls to an exact NAME match otherwise. */
const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const COPY_ID = "22222222-2222-4222-8222-222222222222";

function wsItem(
  id: string,
  slug: string,
  kind: "standard" | "link" = "standard",
): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name: `${slug} room`,
    slug,
    publicId: `pub-${id}`,
    description: null,
    kind,
    memberCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "member",
  };
}

const SOURCE = wsItem(SOURCE_WS, "source");
const TARGET = wsItem(TARGET_WS, "target");
// ⚠ Its NAME deliberately shares no substring with its slug, so the
// "the slug is never advertised" assertion below cannot pass by accident.
const CONTAINER = { ...wsItem("ws-container", "container-c", "link"), name: "With Dana" };

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: TEMPLATE_ID,
    workspaceId: SOURCE_WS,
    name: "Auditor",
    description: "Checks the numbers",
    instructions: "# Auditor\nDo the audit.",
    model: "opus",
    fields: [{ key: "tone", value: "terse" }],
    visibility: "workspace",
    teamIds: [],
    knowledgeBases: [],
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

/** Every call's tenancy, read off the ALS the way the transport reads it. */
interface Trace {
  calls: Array<{ method: string; workspace: string | undefined }>;
  created: AgentTemplateCreateInput[];
}

function client(source: AgentTemplate, trace: Trace): DoplClient {
  const note = (method: string): void => {
    trace.calls.push({ method, workspace: workspaceContext.getStore() });
  };
  return {
    listAgentTemplates: vi.fn(async () => {
      note("listAgentTemplates");
      return [source];
    }),
    getAgentTemplate: vi.fn(async () => {
      note("getAgentTemplate");
      return source;
    }),
    createAgentTemplate: vi.fn(async (input: AgentTemplateCreateInput) => {
      note("createAgentTemplate");
      trace.created.push(input);
      return template({ ...input, id: COPY_ID, workspaceId: TARGET_WS });
    }),
  } as unknown as DoplClient;
}

function stubDirectory(rows: WorkspaceListItem[]): WorkspaceDirectory {
  return {
    getWorkspaceList: async () => rows,
    resolveWorkspaceRef: async (ref) =>
      rows.find((w) => w.id === ref || w.slug === ref) ?? null,
    noWorkspaceError: async () => ({ content: [], isError: true }),
    lockedWorkspaceId: () => null,
  };
}

type Handler = (args: Record<string, unknown>) => Promise<ToolResponse>;

/** The REAL `dopl_agent` handler, captured off the real registrar. */
function doplAgent(c: DoplClient, directory: WorkspaceDirectory): Handler {
  const handlers = new Map<string, Handler>();
  const capture: RegisterTool = (name, _description, _schema, handler) => {
    handlers.set(name, handler as unknown as Handler);
  };
  registerAgentTools(capture, c, undefined, directory);
  const tool = handlers.get("dopl_agent");
  if (!tool) throw new Error("dopl_agent was not registered");
  return tool;
}

function text(res: ToolResponse): string {
  return res.content.map((c) => c.text).join("\n");
}

describe("dopl_agent(op=copy)", () => {
  it("creates in the TARGET tenancy and reads in the SOURCE one", async () => {
    const trace: Trace = { calls: [], created: [] };
    const res = await doplAgent(
      client(template(), trace),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy", template: TEMPLATE_ID, to_workspace: "target" });

    expect(res.isError).toBeUndefined();
    // 🔒 THE ASSERTION THIS SUITE EXISTS FOR: leg 1 read where the call already
    // was, leg 2 wrote inside the target's own scope.
    expect(trace.calls).toEqual([
      { method: "listAgentTemplates", workspace: undefined },
      { method: "getAgentTemplate", workspace: SOURCE_WS },
      { method: "createAgentTemplate", workspace: TARGET_WS },
    ]);
    // The new id and the handle to reach it are both on the result.
    expect(text(res)).toContain(COPY_ID);
    expect(text(res)).toContain('workspace="target"');
  });

  it("carries the identity and FORCES visibility private", async () => {
    const trace: Trace = { calls: [], created: [] };
    await doplAgent(
      // ⚠ Source is `workspace`-visible on purpose: carrying it would publish
      // the copy, and inside a shared container that is the confirm class.
      client(template({ visibility: "workspace" }), trace),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy", template: TEMPLATE_ID, to_workspace: "target" });

    expect(trace.created).toEqual([
      {
        name: "Auditor",
        description: "Checks the numbers",
        instructions: "# Auditor\nDo the audit.",
        model: "opus",
        fields: [{ key: "tone", value: "terse" }],
        visibility: "private",
      },
    ]);
  });

  it("DROPS attached knowledge bases and says so, by count", async () => {
    const trace: Trace = { calls: [], created: [] };
    const res = await doplAgent(
      client(
        template({
          knowledgeBases: [
            { id: "kb-1", name: "Handbook" },
            { id: "kb-2", name: "Playbook" },
          ],
        }),
        trace,
      ),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy", template: TEMPLATE_ID, to_workspace: "target" });

    // 🔒 No cross-tenancy reference reaches the create payload at all.
    expect(trace.created[0]).not.toHaveProperty("knowledgeBaseIds");
    // ⚠ And the agent is TOLD — silence here is what makes it believe the copy
    // carries its knowledge.
    expect(text(res)).toContain("2 attached knowledge bases were NOT carried");
    expect(text(res)).toContain('dopl_kb(op="copy_base"');
  });

  it("says NOTHING about attachments when there are none", async () => {
    const trace: Trace = { calls: [], created: [] };
    const res = await doplAgent(
      client(template(), trace),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy", template: TEMPLATE_ID, to_workspace: "target" });
    expect(text(res)).not.toContain("NOT carried");
  });

  it("REFUSES an unresolvable to_workspace and creates nothing", async () => {
    const trace: Trace = { calls: [], created: [] };
    const res = await doplAgent(
      client(template(), trace),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy", template: TEMPLATE_ID, to_workspace: "nowhere" });

    expect(res.isError).toBe(true);
    expect(text(res)).toContain("does not resolve for you");
    // ⚠ Nothing was even READ — the target resolves before the template does.
    expect(trace.calls).toEqual([]);
    expect(trace.created).toEqual([]);
  });

  it("REFUSES a copy onto the workspace the template already lives in", async () => {
    const trace: Trace = { calls: [], created: [] };
    const res = await doplAgent(
      client(template(), trace),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy", template: TEMPLATE_ID, to_workspace: "source" });

    expect(res.isError).toBe(true);
    expect(text(res)).toContain("already lives in");
    expect(trace.created).toEqual([]);
  });

  it("🔒 a CONTAINER-LOCKED session cannot aim a copy at another workspace", async () => {
    const trace: Trace = { calls: [], created: [] };
    // ⚠ The REAL directory under a real lock, not a stub imitating one — the
    // lock is the behaviour under test.
    const locked = createWorkspaceDirectory(client(template(), trace), {
      directory: [SOURCE, TARGET, CONTAINER],
      lockedTo: CONTAINER,
    });
    const tool = doplAgent(client(template(), trace), locked);

    for (const ref of ["target", TARGET_WS, "source"]) {
      const res = await tool({ op: "copy", template: TEMPLATE_ID, to_workspace: ref });
      expect(res.isError, `to_workspace=${ref} was not refused`).toBe(true);
      expect(text(res)).toContain("does not resolve for you");
    }
    expect(trace.created).toEqual([]);
    // The locked container itself still resolves — the lock narrows, it does not
    // disable the op.
    const own = await tool({
      op: "copy",
      template: TEMPLATE_ID,
      to_workspace: CONTAINER.id,
    });
    expect(own.isError).toBeUndefined();
    // ⚠ A container is addressed by ID; §4A keeps its slug off this surface.
    expect(text(own)).toContain(`workspace="${CONTAINER.id}"`);
    expect(text(own)).not.toContain(CONTAINER.slug);
  });

  it("refuses by NAME when to_workspace is missing", async () => {
    const trace: Trace = { calls: [], created: [] };
    const res = await doplAgent(
      client(template(), trace),
      stubDirectory([SOURCE, TARGET]),
    )({ op: "copy", template: TEMPLATE_ID });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("to_workspace");
    expect(trace.calls).toEqual([]);
  });
});
