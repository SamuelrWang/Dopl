/**
 * `GET|POST /api/agent-templates`. What is under test is the COMPOSITION, not
 * the service: auth is mocked at the wrapper so the wrapper's own configuration
 * (`minRole`, and the ABSENCE of `sessionOnly`) is assertable as part of the
 * contract. Same idiom as `knowledge/bases/[baseId]/star/route.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
};

/** Captured so a test can assert the wrapper's config — it IS the contract. */
const wrapperOptions: Array<Record<string, unknown> | undefined> = [];

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (
      handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>,
      options?: Record<string, unknown>
    ) =>
    (req: Request) => {
      wrapperOptions.push(options);
      return handler(req, AUTH);
    },
}));

vi.mock("@/features/agent-templates/server/service", () => ({
  buildAgentTemplateContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: "user",
    role: auth.role,
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId,
  }),
  listTemplates: vi.fn(),
  listHomeScopedTemplateIds: vi.fn(),
  createTemplate: vi.fn(),
}));

import { GET, POST } from "./route";
import {
  createTemplate,
  listHomeScopedTemplateIds,
  listTemplates,
} from "@/features/agent-templates/server/service";

const mockList = vi.mocked(listTemplates);
const mockCreate = vi.mocked(createTemplate);
const mockHomeScoped = vi.mocked(listHomeScopedTemplateIds);

const TEMPLATE = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  workspaceId: "ws-1",
  name: "Researcher",
  description: null,
  instructions: "You research.",
  model: "opus",
  fields: [{ key: "tone", value: "terse" }],
  visibility: "workspace" as const,
  teamIds: [],
  knowledgeBases: [{ id: "kb-1", name: "Handbook" }],
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function shelfReq(shelf: string): NextRequest {
  return new NextRequest(`http://localhost/api/agent-templates?shelf=${shelf}`, {
    method: "GET",
  });
}

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/agent-templates", {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  wrapperOptions.length = 0;
  mockList.mockResolvedValue([TEMPLATE]);
  mockHomeScoped.mockResolvedValue([]);
  mockCreate.mockResolvedValue(TEMPLATE);
});

describe("GET /api/agent-templates", () => {
  it("returns `{ templates }` with each row carrying its VISIBILITY", async () => {
    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The client groups on this field; a payload without it forces a second
    // call or a grouping decision made server-side for every consumer.
    expect(body.templates[0].visibility).toBe("workspace");
  });

  it("folds homeScopedTemplateIds in as a SIBLING KEY, never onto the row", async () => {
    // 🔒 `home_scoped` stays out of `server/dto.ts › AGENT_TEMPLATE_COLS` so the
    // cached row payload gains no key and §8's stale-cache rule has nothing to
    // apply to THERE. It applies to this key instead.
    mockHomeScoped.mockResolvedValue([TEMPLATE.id]);

    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(body.homeScopedTemplateIds).toEqual([TEMPLATE.id]);
    expect(mockHomeScoped).toHaveBeenCalledWith(expect.anything(), [TEMPLATE]);
    expect("homeScoped" in body.templates[0]).toBe(false);
    expect("shelf" in body.templates[0]).toBe(false);
  });

  it("degrades a shelf-flag failure to [] — UNLABELLED, never mislabelled", async () => {
    // ⚠ The roster is the answer; the label is decoration over it. `[]` is what
    // every surface showed before the key existed, and the unsafe direction
    // (calling a workspace template personal) is unreachable.
    mockHomeScoped.mockRejectedValue(new Error("flag read down"));

    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.homeScopedTemplateIds).toEqual([]);
    expect(body.templates).toHaveLength(1);
  });

  it("reads at VIEWER — the default, so no options are passed", async () => {
    await GET(req("GET"), { params: Promise.resolve({}) });
    expect(wrapperOptions[0]).toBeUndefined();
  });
});

describe("POST /api/agent-templates", () => {
  it("creates and answers 201 with `{ template }`", async () => {
    const res = await POST(req("POST", { name: "Researcher" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ template: TEMPLATE });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", userId: "user-1" }),
      { name: "Researcher" }
    );
  });

  it("writes require `member`", async () => {
    await POST(req("POST", { name: "R" }), { params: Promise.resolve({}) });
    expect(wrapperOptions.at(-1)).toMatchObject({ minRole: "member" });
  });

  it("is NOT sessionOnly — an orchestrator agent authoring a template is the feature", async () => {
    await POST(req("POST", { name: "R" }), { params: Promise.resolve({}) });
    expect(wrapperOptions.at(-1)).not.toHaveProperty("sessionOnly");
  });

  it("400s on a body the schema refuses, with the zod issues in `details`", async () => {
    const res = await POST(req("POST", { name: "" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    const body = await res.json();
    // ⚠ NESTED envelope — `{ error: { code, message, details? } }`, what
    // `HttpError.toResponseBody()` returns. Any new route uses this shape.
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("maps a domain error to its own status, not a 500", async () => {
    const { TemplateKnowledgeBaseNotFoundError } = await import(
      "@/features/agent-templates/server/errors"
    );
    mockCreate.mockRejectedValue(new TemplateKnowledgeBaseNotFoundError(["kb-x"]));
    const res = await POST(req("POST", { name: "R" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("KNOWLEDGE_BASE_NOT_FOUND");
    expect(body.error.details).toEqual({ knowledgeBaseIds: ["kb-x"] });
  });
});

/**
 * 🔒 `?shelf=` — WHICH SHELF (Samuel's ruling 2026-08-27;
 * `features/agent-templates/types.ts › TemplateShelf`).
 *
 * ⚠ THE MIXED-LIST QUESTION, ANSWERED AT THE ROUTE. A request that ASKED for a
 * shelf must never be answered with both — and the dangerous shape is the
 * MISSPELLING, not the happy path. Absent means "no filter" for compatibility
 * (the launch picker, `resolveTemplateRef`, MCP), so a route that shrugged at
 * `?shelf=hom` would silently serve the WIDER list to a caller that was trying
 * to narrow, and it would look like it worked. There is no client-side fallback:
 * `home_scoped` is never projected.
 */
describe("GET /api/agent-templates?shelf=", () => {
  it("passes a recognised shelf DOWN to the service", async () => {
    await GET(shelfReq("home"), { params: Promise.resolve({}) });
    expect(mockList).toHaveBeenCalledWith(expect.anything(), { shelf: "home" });

    await GET(shelfReq("workspace"), { params: Promise.resolve({}) });
    expect(mockList).toHaveBeenLastCalledWith(expect.anything(), {
      shelf: "workspace",
    });
  });

  it("asks for BOTH shelves when the param is absent", async () => {
    // ⚠ Compatibility, not a default: every pre-shelf caller lands here, and
    // the launch picker MUST keep seeing the operator's whole workspace.
    await GET(req("GET"), { params: Promise.resolve({}) });
    expect(mockList).toHaveBeenCalledWith(expect.anything(), { shelf: undefined });
  });

  it("🔒 400s an UNRECOGNISED shelf instead of widening to the mixed list", async () => {
    const res = await GET(shelfReq("hom"), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    // And it never reached the service — no list was built, wide or narrow.
    expect(mockList).not.toHaveBeenCalled();
  });
});
