/**
 * `dopl_agent` and the identity's runtime (rulings 4–6), plus the four MCP
 * identity fixes: P8-01 (an update keeps each field's stored `type`), P8-02
 * (refusals carry the `reason=` codes the description advertises), P8-06 (a
 * same-container name clash warns) and P8-09 (one candidate-list rendering).
 */

import { describe, it, expect, vi } from "vitest";
import type { AgentIdentity, DoplClient } from "@dopl/client";

import { opGet, opList } from "./agent-ops-read";
import { opCreate, opUpdate } from "./agent-ops-write";
import { stub } from "./narration-fixtures";
import { launchIdentityAmbiguous } from "./channel-ops-launch-identity";

const ME = "user-1";
const VERSION = "2026-01-01T00:00:00Z";

function identity(over: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspaceId: "ws-1",
    name: "Coder",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: ME,
    createdAt: VERSION,
    updatedAt: VERSION,
    ...over,
  };
}

const standard = {
  getWorkspaceId: vi.fn(() => "ws-1"),
  listWorkspaces: vi.fn(async () => ({
    workspaces: [{ id: "ws-1", slug: "acme", name: "Acme", kind: "standard", role: "owner", memberCount: 1 }],
  })),
};

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

describe("the identity runtime over MCP", () => {
  it("create carries it, and update can set or clear it", async () => {
    const create = vi.fn(async () => identity({ runtime: "codex", model: "gpt-6-sol" }));
    await opCreate(
      stub({ ...standard, createAgentIdentity: create, listAgentIdentities: vi.fn(async () => []) }) as DoplClient,
      ME,
      { name: "Coder", model: "gpt-6-sol", runtime: "codex" },
    );
    expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-6-sol", runtime: "codex" });

    const update = vi.fn(async () => identity());
    const client = stub({ ...standard, listAgentIdentities: vi.fn(async () => [identity()]), updateAgentIdentity: update }) as DoplClient;
    await opUpdate(client, ME, "Coder", { runtime: null, expected_version: VERSION });
    expect(update.mock.calls[0][1]).toMatchObject({ runtime: null });
  });

  it("a runtime-only update is a real change", async () => {
    const update = vi.fn(async () => identity());
    const client = stub({ ...standard, listAgentIdentities: vi.fn(async () => [identity()]), updateAgentIdentity: update }) as DoplClient;
    const text = textOf(await opUpdate(client, ME, "Coder", { runtime: "claude", expected_version: VERSION }));
    expect(update).toHaveBeenCalled();
    expect(text).not.toContain("changed nothing");
  });

  it("get and list render it", async () => {
    const row = identity({ runtime: "codex", model: "gpt-6-sol" });
    const got = textOf(await opGet(stub({ listAgentIdentities: vi.fn(async () => [row]) }) as DoplClient, "Coder", ME));
    expect(got).toContain("runtime `codex`");
    const listed = textOf(
      await opList(stub({ ...standard, listAgentIdentitiesPayload: vi.fn(async () => ({ identities: [row] })) }) as DoplClient),
    );
    expect(listed).toContain("runtime `codex`");
  });
});

describe("P8-01 — an update keeps each field's stored type", () => {
  it("copies `type` from the stored row by key when the caller omits it", async () => {
    const stored = identity({
      fields: [
        { key: "Deadline", value: "2026-10-01", type: "date" },
        { key: "Seats", value: "4", type: "number" },
      ],
    });
    const update = vi.fn(async () => stored);
    const client = stub({ ...standard, listAgentIdentities: vi.fn(async () => [stored]), updateAgentIdentity: update }) as DoplClient;
    await opUpdate(client, ME, "Coder", {
      fields: [
        { key: "Deadline", value: "2026-11-01" },
        { key: "Fresh", value: "x" },
      ],
      expected_version: VERSION,
    });
    expect(update.mock.calls[0][1].fields).toEqual([
      { key: "Deadline", value: "2026-11-01", type: "date" },
      { key: "Fresh", value: "x" },
    ]);
  });
});

describe("P8-02 — refusals carry the advertised reason codes", () => {
  it("identity_not_found", async () => {
    const res = await opGet(stub({ listAgentIdentities: vi.fn(async () => []) }) as DoplClient, "Nope", ME);
    expect(textOf(res)).toMatch(/^reason=identity_not_found · /);
  });

  it("ambiguous_name", async () => {
    const twin = identity({ id: "22222222-2222-4222-8222-222222222222", visibility: "workspace" });
    const res = await opGet(stub({ listAgentIdentities: vi.fn(async () => [identity(), twin]) }) as DoplClient, "Coder", ME);
    expect(textOf(res)).toMatch(/^reason=ambiguous_name · /);
  });
});

describe("P8-06 — a same-container name clash is warned about", () => {
  it("warns when the new identity shares a name with one in its OWN container", async () => {
    const created = identity({ id: "33333333-3333-4333-8333-333333333333" });
    const text = textOf(
      await opCreate(
        stub({
          ...standard,
          createAgentIdentity: vi.fn(async () => created),
          listAgentIdentities: vi.fn(async () => [created, identity()]),
        }) as DoplClient,
        ME,
        { name: "Coder" },
      ),
    );
    expect(text).toContain("DUPLICATE NAME");
  });
});

describe("P8-09 — one rendering of an ambiguous identity's candidates", () => {
  it("the launch lane lists candidates exactly as dopl_agent does", async () => {
    const twin = identity({ id: "22222222-2222-4222-8222-222222222222", visibility: "workspace" });
    const agentText = textOf(
      await opGet(stub({ listAgentIdentities: vi.fn(async () => [identity(), twin]) }) as DoplClient, "Coder", ME),
    );
    const launchText = textOf(
      launchIdentityAmbiguous("Coder", [
        { id: identity().id, name: "Coder", visibility: "private" },
        { id: twin.id, name: "Coder", visibility: "workspace" },
      ]),
    );
    const lines = (t: string) => t.split("\n").filter((l) => l.startsWith("- `"));
    expect(lines(launchText)).toEqual(lines(agentText));
  });
});
