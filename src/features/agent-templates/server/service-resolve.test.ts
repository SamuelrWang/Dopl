/**
 * `resolveTemplateForLaunch` — THE LAUNCH CONTRACT, at the SERVICE layer.
 *
 * ⚠ THE ROUTE TEST MOCKS THIS FUNCTION, so it pins the SHAPE and can say nothing
 * about the VALUE. `authoredByCaller` is a security gate — it chooses which
 * header the desktop's ROLE block wears over another member's instructions — so
 * the thing that has to be pinned is what it ANSWERS, for each caller kind, and
 * that only exists here.
 *
 * ⚠ AND THE OTHER HALF: resolve is not a second, weaker door. It composes
 * `getTemplateById`, so the visibility matrix applies unchanged — 404, never 403.
 * `service-visibility.test.ts` owns the grid; this file owns the composition.
 *
 * Through the public service with the repository mocked: no Supabase, no network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTemplate, AgentTemplateContext } from "../types";

vi.mock("./repository", () => ({
  listTemplatesForWorkspace: vi.fn(),
  findTemplateById: vi.fn(),
  listTeamLinksForTemplates: vi.fn(),
  listTeamIdsForUser: vi.fn(),
  listKnowledgeLinksForTemplates: vi.fn(),
  listKnowledgeBaseAccessRows: vi.fn(),
  listKnowledgeBaseTeamGrants: vi.fn(),
}));

// ⚠ THE CROSS-TENANCY PAIR (T35) LIVES IN ITS OWN MODULE, and is mocked EMPTY so
// the default is "nothing to say" — every assertion in this file is about the
// answer THIS workspace gives, and a classifier that answered would change the
// error's DETAIL, never its visibility.
vi.mock("./repository-tenancy", () => ({
  listWorkspaceIdsForUser: vi.fn(async () => []),
  findTemplateTenancyRows: vi.fn(async () => []),
}));

import * as repo from "./repository";
import * as tenancyRepo from "./repository-tenancy";
import { resolveTemplateForLaunch } from "./service";
import { AgentTemplateNotFoundError } from "./errors";
import { mapAgentTemplateError } from "./http-mapping";

const mockRepo = vi.mocked(repo);
const mockTenancy = vi.mocked(tenancyRepo);

const CREATOR = "user-creator";
const OTHER = "user-other";
const ADMIN = "user-admin";

function ctx(overrides: Partial<AgentTemplateContext> = {}): AgentTemplateContext {
  return {
    workspaceId: "ws-1",
    userId: CREATOR,
    source: "user",
    role: "member",
    apiKeyWorkspaceId: null,
    ...overrides,
  };
}

function template(overrides: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Code Auditor",
    description: "ignored by the launch payload",
    instructions: "Audit the diff.",
    model: "claude-opus-5",
    fields: [{ key: "repo", value: "acme/api" }],
    visibility: "workspace",
    teamIds: [],
    knowledgeBases: [],
    createdBy: CREATOR,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.listKnowledgeLinksForTemplates.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseAccessRows.mockResolvedValue([]);
  mockRepo.listKnowledgeBaseTeamGrants.mockResolvedValue([]);
  mockRepo.listTeamLinksForTemplates.mockResolvedValue([]);
  mockRepo.listTeamIdsForUser.mockResolvedValue([]);
});

describe("authoredByCaller (G-1)", () => {
  it("is TRUE for the caller who wrote it", async () => {
    mockRepo.findTemplateById.mockResolvedValue(template());
    const resolved = await resolveTemplateForLaunch(ctx(), "tpl-1");
    expect(resolved.authoredByCaller).toBe(true);
  });

  it("is FALSE for another member resolving the same workspace template", async () => {
    // ⚠ THE CASE THE WHOLE FIELD EXISTS FOR. The same row, resolved by two
    // people, gets two different SECURITY HEADERS on the desktop — the operator
    // posture for its author, the untrusted-skill-body posture for everyone else.
    mockRepo.findTemplateById.mockResolvedValue(template());
    const resolved = await resolveTemplateForLaunch(ctx({ userId: OTHER }), "tpl-1");
    expect(resolved.authoredByCaller).toBe(false);
  });

  it("is FALSE for a workspace ADMIN who did not write it — authorship, not permission", async () => {
    // Being able to SEE a template is not having written it. An admin reading
    // somebody else's instructions is exactly the case the stronger header is for.
    mockRepo.findTemplateById.mockResolvedValue(
      template({ visibility: "team", createdBy: OTHER })
    );
    const resolved = await resolveTemplateForLaunch(
      ctx({ userId: ADMIN, role: "admin" }),
      "tpl-1"
    );
    expect(resolved.authoredByCaller).toBe(false);
  });

  it("is FALSE when the author has LEFT the workspace (`created_by` SET NULL)", async () => {
    // ⚠ A NULL AUTHOR MUST NEVER MATCH A NULL-ISH CALLER. `null === null` would
    // make an orphaned template read as everyone's own, which is the header
    // downgrade this field exists to prevent. Fail-closed direction: nobody left
    // can vouch for it.
    mockRepo.findTemplateById.mockResolvedValue(template({ createdBy: null }));
    const resolved = await resolveTemplateForLaunch(ctx(), "tpl-1");
    expect(resolved.authoredByCaller).toBe(false);
  });

  it("is FALSE for a workspace-scoped API key, which authored nothing", async () => {
    mockRepo.findTemplateById.mockResolvedValue(template());
    const resolved = await resolveTemplateForLaunch(
      ctx({ userId: CREATOR, apiKeyWorkspaceId: "ws-1", source: "agent" }),
      "tpl-1"
    );
    // The key's bearer id happens to equal the creator's; it is still not the
    // author, and the matrix would have refused a non-`workspace` row outright.
    expect(resolved.authoredByCaller).toBe(true);
  });
});

describe("the payload, and the door it comes through", () => {
  it("carries EXACTLY the six launch keys — no id, no visibility, no ownership", async () => {
    mockRepo.findTemplateById.mockResolvedValue(template());
    const resolved = await resolveTemplateForLaunch(ctx(), "tpl-1");
    expect(Object.keys(resolved).sort()).toEqual([
      "authoredByCaller",
      "fields",
      "instructions",
      "knowledgeBases",
      "model",
      "name",
    ]);
    expect(resolved).not.toHaveProperty("createdBy");
    expect(resolved).not.toHaveProperty("description");
  });

  it("404s — never 403s — for a template this caller may not see", async () => {
    // ⚠ IT IS NOT A SECOND, WEAKER DOOR. It composes `getTemplateById`, so a
    // private row is invisible to everyone but its creator here too, and the
    // failure is indistinguishable from "deleted" by construction.
    mockRepo.findTemplateById.mockResolvedValue(template({ visibility: "private" }));
    await expect(
      resolveTemplateForLaunch(ctx({ userId: OTHER }), "tpl-1")
    ).rejects.toBeInstanceOf(AgentTemplateNotFoundError);
  });

  // ── T35 — THE DESKTOP'S DOOR MAKES THE SAME DISTINCTION, WITH THE SAME HELPER
  //
  // ⚠ THE STATUS DOES NOT MOVE: still 404, still never 403. What the desktop's
  // resolve may now carry is the ONE non-leaky classification — a template THIS
  // OPERATOR could already list for themselves, living in another tenancy — so
  // the operator's own log can say "it is on your personal shelf" instead of
  // "something went wrong". `classifyMissingTemplateRef` is the single producer,
  // shared with the MCP create fence; a second copy of it here is the shape
  // F-278 is filed against.

  it("a miss the caller CAN account for carries the tenancy — same 404, extra fact", async () => {
    mockRepo.findTemplateById.mockResolvedValue(null);
    mockTenancy.listWorkspaceIdsForUser.mockResolvedValue(["ws-1", "ws-2"]);
    mockTenancy.findTemplateTenancyRows.mockResolvedValue([
      {
        id: "tpl-1",
        name: "Code Auditor",
        workspaceId: "ws-2",
        workspaceName: "Acme",
        workspaceKind: "standard",
        homeScoped: false,
      },
    ]);
    const err = await resolveTemplateForLaunch(ctx(), "tpl-1").catch((e) => e);
    expect(err).toBeInstanceOf(AgentTemplateNotFoundError);
    expect((err as AgentTemplateNotFoundError).elsewhere).toEqual({
      name: "Code Auditor",
      label: "the workspace “Acme”",
    });
  });

  it("a miss it cannot account for stays the BARE 404 — no key, not an empty one", async () => {
    // 🔒 Somebody else's private template anywhere is exactly this: the query
    // returns nothing, so there is nothing to name and nothing to infer from.
    mockRepo.findTemplateById.mockResolvedValue(template({ visibility: "private" }));
    mockTenancy.listWorkspaceIdsForUser.mockResolvedValue(["ws-1", "ws-2"]);
    mockTenancy.findTemplateTenancyRows.mockResolvedValue([]);
    const err = await resolveTemplateForLaunch(ctx({ userId: OTHER }), "tpl-1").catch((e) => e);
    expect((err as AgentTemplateNotFoundError).elsewhere).toBeNull();
  });

  it("costs NOTHING on the hit path — a resolved template never asks the classifier", async () => {
    mockRepo.findTemplateById.mockResolvedValue(template());
    await resolveTemplateForLaunch(ctx(), "tpl-1");
    expect(mockTenancy.listWorkspaceIdsForUser).not.toHaveBeenCalled();
    expect(mockTenancy.findTemplateTenancyRows).not.toHaveBeenCalled();
  });

  it("404s for a row that does not exist at all — the same error, deliberately", async () => {
    mockRepo.findTemplateById.mockResolvedValue(null);
    await expect(resolveTemplateForLaunch(ctx(), "tpl-1")).rejects.toBeInstanceOf(
      AgentTemplateNotFoundError
    );
  });
});

// ── T35 — THE DESKTOP'S 404 BODY ────────────────────────────────────────
//
// ⚠ ABSENT, NOT NULL, for the same reason the channels mapper's arm gives: the
// PRESENCE of a `details` key must not itself be a fact about a row the caller
// may not see. `HttpError.toResponseBody` omits `undefined` details.
describe("the 404 the desktop reads", () => {
  it("carries `details.elsewhere` when the miss was accounted for", () => {
    const http = mapAgentTemplateError(
      new AgentTemplateNotFoundError("tpl-1", {
        name: "Code Auditor",
        label: "your personal shelf",
      })
    );
    expect(http?.status).toBe(404);
    expect(http?.details).toEqual({
      elsewhere: { name: "Code Auditor", label: "your personal shelf" },
    });
  });

  it("carries no details at all for an ordinary miss", () => {
    const http = mapAgentTemplateError(new AgentTemplateNotFoundError("tpl-1"));
    expect(http?.status).toBe(404);
    expect(http?.details).toBeUndefined();
  });
});
