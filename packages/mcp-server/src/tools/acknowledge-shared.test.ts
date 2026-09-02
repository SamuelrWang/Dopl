/**
 * 🔒 **G16 / A11 — THE SPENT TOKEN BECOMES THE SERVER'S PRECONDITION.**
 *
 * `shelf-confirm.test.ts` pins the confirm class as a TRIPWIRE: what the preview
 * says, and that nothing is written until a token comes back. This file pins the
 * one thing that made a fence out of it — the write body that follows a spent
 * token carries `acknowledgeShared: true`, and the body that follows any OTHER
 * proceed does not.
 *
 * ⚠ **THE NEGATIVE ARMS ARE THE POINT.** A flag set on every publish would pass
 * the server and buy nothing: it would be the client-side confirm again, wearing
 * a boolean. So each proceed that showed NOBODY anything — a private create, a
 * standard workspace, a solo container — is asserted to send no flag at all.
 *
 * ⚠ AND `undefined`, NEVER `false`. The server examines only an explicit `true`
 * (`src/features/workspaces/server/shared-publish.ts`); a `false` on the wire
 * would tell the next reader that the other value is examined too.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient, KnowledgeBase } from "@dopl/client";

import { opCreate, opUpdate } from "./agent-ops-write";
import { opCreateBase, opSetVisibility } from "./knowledge-ops-write";
import { stub } from "./narration-fixtures";
import { __resetConfirmTokensForTest } from "./confirm-token";

const ME = "user-1";

const TEMPLATE = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "ws-1",
  name: "Researcher",
  description: null,
  instructions: null,
  model: null,
  fields: [],
  visibility: "workspace" as const,
  teamIds: [],
  knowledgeBases: [],
  createdBy: ME,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const BASE: KnowledgeBase = {
  id: "kb-1",
  workspaceId: "ws-1",
  name: "Notes",
  slug: "notes",
  publicId: "pub-1",
  description: null,
  agentWriteEnabled: true,
  visibility: "public",
  accessMode: "workspace",
  createdBy: ME,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

function workspaceStub(kind: "standard" | "link", memberCount: number) {
  return {
    getWorkspaceId: vi.fn(() => "ws-1"),
    listWorkspaces: vi.fn(async () => ({
      workspaces: [
        { id: "ws-1", slug: "acme", name: "Acme", kind, role: "owner", memberCount },
      ],
    })),
  };
}

/** A `kind='link'` container with a PEER in it — the only room the class fires in. */
const sharedContainer = () => workspaceStub("link", 2);

function apiError(status: number, code: string): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    name: "DoplApiError",
    status,
    code,
  });
}

function tokenIn(text: string): string {
  const m = /confirm_token="([^"]+)"/.exec(text);
  expect(m, `no confirm_token in:\n${text}`).not.toBeNull();
  return m![1];
}

afterEach(() => {
  __resetConfirmTokensForTest();
});

// ── The token → the flag ─────────────────────────────────────────────

describe("dopl_agent — a spent token acknowledges the audience", () => {
  it("op=create sends acknowledgeShared on the confirmed write, and nothing before it", async () => {
    const create = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...sharedContainer(),
      createAgentTemplate: create,
    }) as DoplClient;
    const input = { name: "Researcher", visibility: "workspace" as const };

    const preview = await opCreate(client, ME, input);
    expect(create).not.toHaveBeenCalled();

    await opCreate(client, ME, {
      ...input,
      confirm_token: tokenIn(textOf(preview)),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "workspace", acknowledgeShared: true })
    );
  });

  it("op=update carries it on the PATCH, beside the field that actually moves", async () => {
    const update = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...sharedContainer(),
      listAgentTemplates: vi.fn(async () => [TEMPLATE]),
      updateAgentTemplate: update,
    }) as DoplClient;
    const input = { visibility: "workspace" as const };

    const preview = await opUpdate(client, ME, TEMPLATE.id, input);
    expect(update).not.toHaveBeenCalled();

    await opUpdate(client, ME, TEMPLATE.id, {
      ...input,
      confirm_token: tokenIn(textOf(preview)),
    });
    expect(update).toHaveBeenCalledWith(
      TEMPLATE.id,
      expect.objectContaining({ visibility: "workspace", acknowledgeShared: true })
    );
  });
});

describe("dopl_kb — a spent token acknowledges the audience", () => {
  it("op=create_base sends acknowledgeShared on the confirmed write", async () => {
    const create = vi.fn(async () => BASE);
    const client = stub({
      ...sharedContainer(),
      createKbBase: create,
    }) as DoplClient;
    const input = { name: "Notes", visibility: "public" as const };

    const preview = await opCreateBase(client, ME, input);
    expect(create).not.toHaveBeenCalled();

    await opCreateBase(client, ME, {
      ...input,
      confirm_token: tokenIn(textOf(preview)),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "public", acknowledgeShared: true })
    );
  });
});

// ── Every OTHER proceed sends nothing ────────────────────────────────

describe("a proceed that showed nobody anything sends NO flag", () => {
  it("a PRIVATE template — the class never fired", async () => {
    const create = vi.fn(async () => ({ ...TEMPLATE, visibility: "private" as const }));
    await opCreate(
      stub({ ...sharedContainer(), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "private" }
    );
    expect(create.mock.calls[0][0]).toMatchObject({ acknowledgeShared: undefined });
  });

  it("a STANDARD workspace — publishing to colleagues is not this class", async () => {
    const create = vi.fn(async () => TEMPLATE);
    await opCreate(
      stub({ ...workspaceStub("standard", 9), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "workspace" }
    );
    expect(create.mock.calls[0][0]).toMatchObject({ acknowledgeShared: undefined });
  });

  it("a SOLO container — there is no second audience to acknowledge", async () => {
    const create = vi.fn(async () => TEMPLATE);
    await opCreate(
      stub({ ...workspaceStub("link", 1), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "workspace" }
    );
    // 🔒 `undefined`, NOT `false`. The server reads only an explicit `true`, and
    // the negative spelling on the wire is a claim nobody needs to interpret.
    expect(create.mock.calls[0][0].acknowledgeShared).toBeUndefined();
  });
});

// ── The server's own refusal, made legible ───────────────────────────

describe("400 CONTAINER_PUBLISH_UNACKNOWLEDGED reaches the agent as a next action", () => {
  it("on a previewed op it says to preview again — this can only be a race", async () => {
    const client = stub({
      ...workspaceStub("standard", 9),
      createAgentTemplate: vi.fn(async () => {
        throw apiError(400, "CONTAINER_PUBLISH_UNACKNOWLEDGED");
      }),
    }) as DoplClient;
    const res = await opCreate(client, ME, {
      name: "Researcher",
      visibility: "workspace",
    });
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("Nothing was written");
    expect(text).toContain("somebody ELSE is standing in");
    expect(text).toContain("WITHOUT `confirm_token`");
  });

  it("on set_visibility it names the HUMAN as the remedy — that op has no preview", async () => {
    // ⚠ THE ASYMMETRY IS RECORDED, NOT HIDDEN. `tools/knowledge.ts` passes this
    // op neither the caller id nor `confirm_token`, and that file belongs to
    // another slice of this wave — so the preview is a cross-slice request and
    // this refusal is what the agent gets until it lands. A remedy an agent
    // cannot perform ("re-issue with a flag you have no argument for") would be
    // worse than the silent publish it replaces; a remedy a person can perform
    // is not.
    const client = stub({
      ...sharedContainer(),
      listKbBases: vi.fn(async () => [{ ...BASE, visibility: "private" as const }]),
      updateKbBase: vi.fn(async () => {
        throw apiError(400, "CONTAINER_PUBLISH_UNACKNOWLEDGED");
      }),
    }) as DoplClient;
    const res = await opSetVisibility(client, BASE.id, "public");
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("Nothing was written");
    expect(text).toContain("ask your operator");
    expect(text).not.toContain("confirm_token");
  });

  it("leaves every OTHER 400 alone — the mapper is keyed on the code", async () => {
    const client = stub({
      ...workspaceStub("standard", 9),
      createAgentTemplate: vi.fn(async () => {
        throw apiError(400, "VALIDATION_FAILED");
      }),
    }) as DoplClient;
    await expect(
      opCreate(client, ME, { name: "Researcher", visibility: "workspace" })
    ).rejects.toThrow("HTTP 400");
  });
});
