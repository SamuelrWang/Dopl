/**
 * THE `team` AXIS IS OFF THIS SURFACE — and it stays off (A8, 2026-09-02).
 *
 * ⚠ WHAT IS BEING PINNED IS WHAT AN AGENT IS **TAUGHT**, not what the database
 * holds. `TemplateVisibility` still has three arms, the column still stores
 * `'team'`, and `team_resource_access` / `agent_template_teams` are still there
 * — dropping those is B4. What this file forbids is the MCP surface OFFERING or
 * DESCRIBING an axis with **0 live rows behind it** (measured in production
 * 2026-09-02: 0 teams-mode KBs, 0 team-visibility templates, 0
 * `agent_template_teams` rows), because every arm of an enum and every clause of
 * a description is read, weighed and occasionally PICKED by every connected
 * client, forever, whether or not anything is behind it.
 *
 * ⚠ MEASURED AS **SERVED**, over a real `Client.listTools()` on a real
 * transport, for the reason `tool-budget.test.ts` gives: the registrar injects a
 * `workspace` argument and the SDK renders the JSON Schema, so a constant read
 * at its source is not the string an agent receives.
 *
 * ⚠ SCOPE IS THE FOUR TOOLS A8 OWNS. `dopl_members` describes teams because
 * teams are its SUBJECT (op="teams" / "get_team" / "access_matrix"), and
 * `dopl_skill` / `dopl_chats` carry their own `accessMode` wording — those come
 * off with B4, and widening this scan now would only make it fail on work this
 * slice is not allowed to do.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AgentTemplate, DoplClient, WorkspaceListItem } from "@dopl/client";

import { createServer } from "../server.js";
import { opList } from "./agent-ops-read.js";
import { TEMPLATE_VISIBILITY_VALUES } from "./agent-shared.js";
import { stub } from "./narration-fixtures.js";

const WS: WorkspaceListItem = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerId: "owner",
  name: "Alpha",
  slug: "alpha",
  publicId: "pub-1",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  role: "owner",
};

/**
 * The tools A8 owns. ⚠ A NAME LEAVING THIS LIST IS A DECISION, and TWO LEFT ON
 * 2026-09-02 AT WAVE A's INTEGRATION: A3 deleted `dopl_agent_admin` and
 * `dopl_kb_admin` outright (every op on both was refused unconditionally), so
 * there is no served prose left on them to scan. The rule they were here for
 * did not relax — the surface that could break it got smaller.
 *
 * ⚠ THE `toBeDefined` FENCE IN {@link servedProse} IS WHAT MADE THAT VISIBLE
 * rather than silently vacuous, and it is the reason this list may not simply be
 * pruned when a scan goes quiet: a name here that nothing serves fails loudly.
 */
const OWNED_TOOLS = ["dopl_agent", "dopl_kb"];

/** ⚠ Word-bounded: it must catch "team", "teams", "team-scoped" and "teammate"
 *  in served prose, and must NOT be a substring match that fires on unrelated
 *  words. Comments are not served and are deliberately out of range. */
const TEAM_AXIS = /\bteam\w*\b/i;

const created = vi.fn();

/** Enough of the client for registration + the one write we actually attempt. */
function stubClient(): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [WS] }),
    getWorkspaceId: vi.fn(() => WS.id),
    setWorkspaceId: vi.fn(),
    listChannels: vi.fn().mockResolvedValue([]),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ clusters: [], objects: {} }),
    createAgentTemplate: created,
  } as unknown as DoplClient;
}

let client: Client;
let listed: Awaited<ReturnType<Client["listTools"]>>;

beforeAll(async () => {
  const server = createServer(stubClient(), {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "team-axis-probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  listed = await client.listTools();
});

afterAll(async () => {
  await client?.close();
});

/** Every string a client is pushed for one tool: its description and each of its
 *  arguments' own `.describe()`, which is billed on the same connection. */
function servedProse(name: string): Array<[string, string]> {
  const tool = listed.tools.find((t) => t.name === name);
  expect(tool, `${name} is not registered — a scan over nothing is not a guard`)
    .toBeDefined();
  const props = (tool?.inputSchema?.properties ?? {}) as Record<
    string,
    { description?: string }
  >;
  return [
    [`${name}.description`, tool?.description ?? ""],
    ...Object.entries(props).map(
      ([arg, schema]): [string, string] => [`${name}.${arg}`, schema.description ?? ""],
    ),
  ];
}

describe("the visibility enum dopl_agent SERVES", () => {
  it("is exactly the two offered values, in order", () => {
    const visibility = (
      listed.tools.find((t) => t.name === "dopl_agent")?.inputSchema
        ?.properties as Record<string, { enum?: unknown[] }>
    )?.visibility;
    // ⚠ TOSTRICTLY the whole array, not `.not.toContain("team")` — a third arm
    // arriving under any other spelling is the same regression.
    expect(visibility?.enum).toEqual(["private", "workspace"]);
    expect(visibility?.enum).toEqual([...TEMPLATE_VISIBILITY_VALUES]);
  });
});

describe("no description this slice owns TEACHES the team axis", () => {
  it.each(OWNED_TOOLS)("%s — description and every argument's", (name) => {
    const offenders = servedProse(name)
      .filter(([, text]) => TEAM_AXIS.test(text))
      .map(([where, text]) => `${where}: …${text.match(TEAM_AXIS)?.[0]}…`);
    expect(
      offenders,
      `these SERVED strings still teach an axis with 0 live rows behind it (B4 drops the column; this surface must not offer it):\n- ${offenders.join("\n- ")}`,
    ).toEqual([]);
  });
});

describe("a `team` value arriving over MCP is REFUSED", () => {
  it("-32602 with a one-line reason that names the retired value, and NOTHING is written", async () => {
    const res = await client.callTool({
      name: "dopl_agent",
      arguments: { op: "create", name: "Researcher", visibility: "team" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)
      .map((c) => c.text)
      .join("");
    expect(text).toContain("-32602");
    // ⚠ THE REASON, not just "Invalid option" — zod's default reads as a typo
    // and invites the same call again. (Asserted UNQUOTED: the SDK renders the
    // issue as JSON, so the message's own quotes arrive backslash-escaped.)
    expect(text).toContain("is no longer a sharing option on this surface");
    expect(text).toContain("team");
    expect(created).not.toHaveBeenCalled();
  });

  it("the two offered values still reach the handler (this is a narrowing, not a break)", async () => {
    created.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Researcher",
      visibility: "workspace",
    });
    const res = await client.callTool({
      name: "dopl_agent",
      arguments: { op: "create", name: "Researcher", visibility: "workspace" },
    });
    expect(res.isError).toBeFalsy();
    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "workspace" }),
    );
  });
});

describe("op=list RENDERS a row at a visibility the surface no longer offers", () => {
  it("groups it under a neutral heading instead of dropping it", async () => {
    // 🔒 THE SILENT-DROP GUARD. The column keeps `'team'` until B4, so a read
    // that grouped ONLY by the write enum would hide such a row with no error
    // anywhere — which is a data-loss bug wearing a simplification's clothes.
    const rows: AgentTemplate[] = [
      { ...base(), id: "a", name: "Mine", visibility: "private" },
      { ...base(), id: "b", name: "Legacy", visibility: "team" },
    ];
    const text = (
      await opList(
        stub({
          listAgentTemplatesPayload: vi.fn(async () => ({ templates: rows })),
        }) as DoplClient,
      )
    ).content
      .map((c) => c.text)
      .join("\n");

    expect(text).toContain("### Private to you");
    expect(text).toContain("Legacy");
    expect(text).toContain("### Shared");
    // ⚠ AND the heading does not name the axis back into the reader's context.
    expect(text).not.toContain("### Shared with a team");
  });
});

function base(): AgentTemplate {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspaceId: WS.id,
    name: "Researcher",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}
