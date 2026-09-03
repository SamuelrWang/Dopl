/**
 * `dopl_agent` — 🔒 THE FENCES AND THE POLICY REFUSALS. Sibling of
 * `agent-ops.test.ts`, split out at the 500-line cap (2026-08-28); that file
 * holds the happy paths and the three-answer ref resolution.
 *
 *   1. The write refusals that happen BEFORE the round trip, and the server
 *      403s that must arrive as actionable sentences rather than raw throws.
 *   2. The refusals that are POLICY rather than plumbing, and the tool
 *      description that resolves the "Agents" collision.
 *   3. 🔒 `op="grant"` — the ownership fence, the scope/level pairing, and the
 *      uniform unresolvable-scope refusal.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";

import { registerAgentTools } from "./agent";
import { opCreate, opGrantTemplate } from "./agent-ops-write";
import { callTool, stub } from "./narration-fixtures";

const ME = "user-1";

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

/** A standard workspace — nothing here is in the confirm class. */
function standardWorkspace(over: Record<string, unknown> = {}) {
  return {
    getWorkspaceId: vi.fn(() => "ws-1"),
    listWorkspaces: vi.fn(async () => ({
      workspaces: [
        {
          id: "ws-1",
          slug: "acme",
          name: "Acme",
          kind: "standard",
          role: "owner",
          memberCount: 4,
        },
      ],
    })),
    ...over,
  };
}

/** A 403 as the transport actually raises it. */
function apiError(status: number, code: string, apiMessage?: string): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    name: "DoplApiError",
    status,
    code,
    apiMessage,
  });
}

// ── 3. 🔒 The write fences surface ──────────────────────────────────
//
// ⚠ **THE FOUR HOME-SHELF CASES THAT STOOD HERE ARE DELETED (2026-09-02, slice
// B15).** They pinned `resolveTemplateHomeScope`'s 403 surfacing as an
// actionable sentence, the `home shelf` → `personal shelf` re-spelling, and the
// local shelf/visibility contradiction. The column, the fence, the mapper and
// the argument are all gone (ruling B10), so those were assertions about a
// surface that no longer exists — deleted rather than adapted, because there is
// no successor behaviour for them to describe.

describe("what a write refuses before it reaches the server", () => {
  it("a shared credential asking for a PRIVATE template gets the key-class sentence", async () => {
    const res = await opCreate(
      stub({
        ...standardWorkspace(),
        createAgentTemplate: vi.fn(async () => {
          throw apiError(
            403,
            "WORKSPACE_KEY_PRIVATE_VISIBILITY",
            "Workspace-scoped API keys cannot create or own private agent templates.",
          );
        }),
      }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "private" },
    );
    expect(textOf(res)).toContain("cannot create or own private agent templates");
    expect(textOf(res)).toContain("Nothing was created");
  });

  it("an unreadable attached base answers the SAME way an unknown id does", async () => {
    const res = await opCreate(
      stub({
        ...standardWorkspace(),
        createAgentTemplate: vi.fn(async () => {
          throw apiError(404, "KNOWLEDGE_BASE_NOT_FOUND");
        }),
      }) as DoplClient,
      ME,
      { name: "Researcher", knowledge_bases: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] },
    );
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("laundering");
    expect(textOf(res)).toContain("answer the same way here");
  });
});

// ── 4. The policy refusals ───────────────────────────────────────────

describe("what this surface will not do", () => {
  // ⚠ **THE "op=update REFUSES A SHELF" CASE IS DELETED (2026-09-02, slice
  // B15).** There is no shelf to refuse a move between; a template lives in one
  // container and `dopl_agent` no longer publishes the argument.

  // ⚠ THE DELETE REFUSAL USED TO BE PINNED HERE, through
  // `agent-ops-admin.ts › opDelete`. Both are gone (2026-09-02): `dopl_agent`
  // publishes no delete op, `DELETE /api/agent-templates/{id}` has been
  // `sessionOnly` since 2026-08-22, and the surviving claim — "no live `op`
  // enum contains one of these ops" — is asserted over EVERY tool at once in
  // `delete-block.test.ts`. Re-adding a per-tool copy here would be a second
  // declaration of the same rule.

  it("the registrar routes every op and demands the ref where one is needed", async () => {
    const text = await callTool(
      registerAgentTools,
      stub({ listAgentTemplates: vi.fn(async () => []) }),
      "dopl_agent",
      { op: "get" },
    );
    expect(text).toContain('op="get" is missing required param: template');
  });

  it("the tool description sends an agent looking for RUNNING agents elsewhere", async () => {
    // ⚠ Samuel's ruling Q7: `dopl_agent` inherits the two-surfaces collision on
    // the word "Agents", and the description is where it is resolved.
    let description = "";
    registerAgentTools(
      ((name: string, d: string) => {
        if (name === "dopl_agent") description = d;
      }) as never,
      stub({}),
    );
    // ⚠ BOTH ROUTES, not both spellings (A14, 2026-09-02). The house style
    // renders routing as ONE `Use <tool>(op=…)` sentence that may name a second
    // op on the same tool without repeating the tool. What Samuel's ruling Q7
    // requires is that BOTH destinations are named and that the tool carrying
    // them is `dopl_channel`; a second `dopl_channel(` prefix is characters
    // pushed on every connection to repeat a word one clause away.
    //
    // ⚠ **THE TWO OP NAMES CHANGED AT B8 AND THIS CASE HAD NOT (F-592)**: it
    // pinned `read_sessions` and `launch_agent`, both of which retired into the
    // five-op surface, so the assertion was holding the description ON the
    // retired spelling. The DESTINATIONS are what the ruling is about.
    expect(description).toContain('dopl_channel(op="status")');
    expect(description).toContain('manage(action="launch")');
  });
});

// ── 5. 🔒 op="grant" — the op that replaced op="copy" ────────────────
//
// ⚠ **THE FENCE IS THE SERVER'S AND THESE CASES ARE THE LOCAL HALF.** The route
// refuses a foreign resource and an unreachable scope with an identical 404; what
// is pinned here is that the tool refuses the ones it can already PROVE without
// spending a round trip, and says why — which the server's uniform answer
// deliberately cannot.

describe('dopl_agent op="grant"', () => {
  const TPL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
  const TEMPLATE = {
    id: TPL_ID,
    name: "Researcher",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    workspaceId: "ws-1",
    createdBy: ME,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const directory = {
    resolveWorkspaceRef: vi.fn(async (ref: string) =>
      ref === "container-1" ? { id: "container-1" } : null,
    ),
  } as never;

  function client(over: Record<string, unknown> = {}) {
    return stub({
      ...standardWorkspace(),
      listAgentTemplates: vi.fn(async () => [TEMPLATE]),
      getAgentTemplate: vi.fn(async () => TEMPLATE),
      ...over,
    }) as DoplClient;
  }

  it("LENDS a template the caller created, and says the row did not move", async () => {
    const grant = vi.fn(async () => ({}));
    const res = await opGrantTemplate(
      client({ grantResource: grant }),
      directory,
      ME,
      TPL_ID,
      "channel",
      "ch-1",
      undefined,
    );
    expect(res.isError).toBeFalsy();
    // ⚠ THE DEFAULT LEVEL IS THE NARROWER WORD IN THE CHANNEL VOCABULARY.
    expect(grant).toHaveBeenCalledWith({
      resourceType: "agent_template",
      resourceId: TPL_ID,
      scopeType: "channel",
      scopeId: "ch-1",
      level: "visible",
    });
    expect(textOf(res)).toContain("It is ONE row");
    expect(textOf(res)).toContain("an edit reaches everyone it is lent to");
  });

  it("🔒 REFUSES a template the caller did not create, and writes nothing (R2)", async () => {
    const grant = vi.fn();
    const res = await opGrantTemplate(
      client({
        listAgentTemplates: vi.fn(async () => [{ ...TEMPLATE, createdBy: "somebody-else" }]),
        getAgentTemplate: vi.fn(async () => ({ ...TEMPLATE, createdBy: "somebody-else" })),
        grantResource: grant,
      }),
      directory,
      ME,
      TPL_ID,
      "channel",
      "ch-1",
      undefined,
    );
    expect(res.isError).toBe(true);
    expect(grant).not.toHaveBeenCalled();
    expect(textOf(res)).toContain("NOTHING was shared");
    expect(textOf(res)).toContain("Being able to read it is not the same");
  });

  it("🔒 FAILS CLOSED on an unprovable owner — an unattributed row is not yours", async () => {
    const grant = vi.fn();
    const res = await opGrantTemplate(
      client({
        listAgentTemplates: vi.fn(async () => [{ ...TEMPLATE, createdBy: null }]),
        getAgentTemplate: vi.fn(async () => ({ ...TEMPLATE, createdBy: null })),
        grantResource: grant,
      }),
      directory,
      ME,
      TPL_ID,
      "container",
      "container-1",
      undefined,
    );
    expect(res.isError).toBe(true);
    expect(grant).not.toHaveBeenCalled();
  });

  it("REFUSES a level from the other scope's vocabulary, before resolving anything", async () => {
    const list = vi.fn(async () => [TEMPLATE]);
    const grant = vi.fn();
    const res = await opGrantTemplate(
      client({ listAgentTemplates: list, grantResource: grant }),
      directory,
      ME,
      TPL_ID,
      "channel",
      "ch-1",
      "edit",
    );
    expect(res.isError).toBe(true);
    // ⚠ BEFORE the resolve: a pairing error costs no read at all.
    expect(list).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
    expect(textOf(res)).toContain("not a channel level");
  });

  it("REFUSES an unresolvable container UNIFORMLY, with no fallback to the current workspace", async () => {
    const grant = vi.fn();
    const res = await opGrantTemplate(
      client({ grantResource: grant }),
      directory,
      ME,
      TPL_ID,
      "container",
      "nowhere",
      undefined,
    );
    expect(res.isError).toBe(true);
    expect(grant).not.toHaveBeenCalled();
    expect(textOf(res)).toContain("NOTHING was shared");
    expect(textOf(res)).toContain("never falls back");
  });
});
