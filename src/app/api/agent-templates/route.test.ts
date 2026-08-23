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
  createTemplate: vi.fn(),
}));

import { GET, POST } from "./route";
import {
  createTemplate,
  listTemplates,
} from "@/features/agent-templates/server/service";

const mockList = vi.mocked(listTemplates);
const mockCreate = vi.mocked(createTemplate);

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
  mockCreate.mockResolvedValue(TEMPLATE);
});

describe("GET /api/agent-templates", () => {
  it("returns `{ templates }` with each row carrying its VISIBILITY", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // The client groups on this field; a payload without it forces a second
    // call or a grouping decision made server-side for every consumer.
    expect(body.templates[0].visibility).toBe("workspace");
  });

  it("reads at VIEWER — the default, so no options are passed", async () => {
    await GET(req("GET"));
    expect(wrapperOptions[0]).toBeUndefined();
  });
});

describe("POST /api/agent-templates", () => {
  it("creates and answers 201 with `{ template }`", async () => {
    const res = await POST(req("POST", { name: "Researcher" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ template: TEMPLATE });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", userId: "user-1" }),
      { name: "Researcher" }
    );
  });

  it("writes require `member`", async () => {
    await POST(req("POST", { name: "R" }));
    expect(wrapperOptions.at(-1)).toMatchObject({ minRole: "member" });
  });

  it("is NOT sessionOnly — an orchestrator agent authoring a template is the feature", async () => {
    await POST(req("POST", { name: "R" }));
    expect(wrapperOptions.at(-1)).not.toHaveProperty("sessionOnly");
  });

  it("400s on a body the schema refuses, with the zod issues in `details`", async () => {
    const res = await POST(req("POST", { name: "" }));
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
    const res = await POST(req("POST", { name: "R" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("KNOWLEDGE_BASE_NOT_FOUND");
    expect(body.error.details).toEqual({ knowledgeBaseIds: ["kb-x"] });
  });
});
