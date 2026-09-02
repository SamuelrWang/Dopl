/**
 * `dopl_agent` — 🔒 THE FENCES AND THE POLICY REFUSALS. Sibling of
 * `agent-ops.test.ts`, split out at the 500-line cap (2026-08-28); that file
 * holds the happy paths and the three-answer ref resolution.
 *
 *   1. 🔒 THE SHELF FENCE SURFACES. A 403 from `resolveTemplateHomeScope` must
 *      arrive as an actionable sentence naming the three conditions, never as a
 *      raw throw and never as a silent downgrade onto the other shelf.
 *   2. The refusals that are POLICY rather than plumbing: no shelf move on
 *      update, and the tool description that resolves the "Agents" collision.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";

import { registerAgentTools } from "./agent";
import { opCreate, opUpdate } from "./agent-ops-write";
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

// ── 3. 🔒 The shelf fence surfaces ───────────────────────────────────

describe("the home-shelf fence, surfaced", () => {
  it("a SHARED-credential 403 becomes an actionable sentence, and nothing is created", async () => {
    const create = vi.fn(async () => {
      throw apiError(
        403,
        "TEMPLATE_HOME_SCOPE_FORBIDDEN",
        "This agent cannot be created on your home shelf — a shared credential has no personal shelf.",
      );
    });
    const res = await opCreate(
      stub({ ...standardWorkspace(), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", shelf: "personal" },
    );
    const text = textOf(res);

    expect(res.isError).toBe(true);
    // ⚠ The server's own reason survives — it is the ONLY text that knows which
    // of the three conditions failed.
    expect(text).toContain("a shared credential has no personal shelf");
    expect(text).toContain("Nothing was created");
    expect(text).toContain("a credential that stands for a PERSON");
  });

  it("a container-target 403 names the workspace condition, not a permission problem", async () => {
    // ⚠ A container-locked session is refused by B1 on the WORKSPACE axis, not
    // by the shelf fence — F-336 is that confusion. The copy must send the
    // caller at the target, not at their credential.
    const res = await opCreate(
      stub({
        ...standardWorkspace(),
        createAgentTemplate: vi.fn(async () => {
          throw apiError(
            403,
            "TEMPLATE_HOME_SCOPE_FORBIDDEN",
            "This agent cannot be created on your home shelf — it is not your home workspace.",
          );
        }),
      }) as DoplClient,
      ME,
      { name: "Researcher", shelf: "personal" },
    );
    expect(textOf(res)).toContain("it is not your home workspace");
    expect(textOf(res)).toContain("your OWN default workspace as the target");
  });

  it("RE-SPELLS THE WIRE NOUN: the server's 'home shelf' surfaces as 'personal shelf' (T32)", async () => {
    // "home" is the word for the CHANNEL on this surface. A refusal that said
    // "the home shelf" and "personal shelf" in one breath is the conflation the
    // tenancy-naming pass exists to remove — and the server's spelling is the
    // one thing an agent cannot correct for itself.
    const res = await opCreate(
      stub({
        ...standardWorkspace(),
        createAgentTemplate: vi.fn(async () => {
          throw apiError(
            403,
            "TEMPLATE_HOME_SCOPE_FORBIDDEN",
            "This agent cannot be created on your home shelf — the home shelf holds private agents only.",
          );
        }),
      }) as DoplClient,
      ME,
      { name: "Researcher", shelf: "personal" },
    );
    const text = textOf(res);

    expect(text).not.toContain("home shelf");
    expect(text).toContain("created on your personal shelf");
    // ⚠ A NOUN, AND NOTHING ELSE: the server's reason is the only text that
    // knows WHICH condition failed, so it must still arrive intact.
    expect(text).toContain("the personal shelf holds private agents only");
  });

  it("REFUSES THE CONTRADICTION LOCALLY — no round trip when personal meets a non-private visibility", async () => {
    const create = vi.fn();
    const res = await opCreate(
      stub({ ...standardWorkspace(), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", shelf: "personal", visibility: "workspace" },
    );
    expect(res.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(textOf(res)).toContain("Refused before sending");
    expect(textOf(res)).toContain("contradict each other");
  });

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
  it("op=update REFUSES a shelf rather than dropping it — there is no move", async () => {
    const update = vi.fn();
    const res = await opUpdate(
      stub({ updateAgentTemplate: update }) as DoplClient,
      ME,
      "Researcher",
      { shelf: "personal", name: "Renamed" },
    );
    expect(res.isError).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(textOf(res)).toContain("there is no move");
    // ⚠ Says the copy is a STRANGER — a caller told only "no" writes the copy
    // and then believes the two are linked.
    expect(textOf(res)).toContain("STRANGERS");
  });

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
    expect(description).toContain('dopl_channel(op="read_sessions")');
    expect(description).toContain('dopl_channel(op="launch_agent")');
  });
});
