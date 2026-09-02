/**
 * `GET|PATCH|DELETE /api/agent-templates/{templateId}`.
 *
 * ⚠ THE LOAD-BEARING ASSERTION IN THIS FILE IS THE PER-METHOD GATE. `DELETE` is
 * `sessionOnly` and `GET`/`PATCH` are deliberately NOT — an orchestrator agent
 * listing and editing templates is the entire point of making them persistent,
 * and gating the whole route would gate the feature. The pin in
 * `src/shared/auth/write-gate-coverage.test.ts` sees only that the FILE contains
 * `sessionOnly: true`; only this file can say WHICH method carries it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** Mutable so one test can hand the route a malformed param. */
let params: Record<string, string> = { templateId: ID };

const AUTH: Omit<WorkspaceAuthContext, "params"> = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
};

/** Options captured PER EXPORT, in module-evaluation order: GET, PATCH, DELETE. */
// ⚠ `vi.hoisted` IS REQUIRED HERE AND NOT IN THE COLLECTION-ROUTE TEST.
// `vi.mock` factories are hoisted above every `const`, and this factory
// captures the options AT WRAPPER-CONSTRUCTION TIME (module evaluation of
// `./route`) rather than per request — which is the only way to see which
// METHOD carries `sessionOnly`. A plain `const` is in its TDZ at that
// moment and the whole suite fails to import.
const wrapperOptions = vi.hoisted(
  () => [] as Array<Record<string, unknown> | undefined>
);

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (
      handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>,
      options?: Record<string, unknown>
    ) => {
      wrapperOptions.push(options);
      return (req: Request) => handler(req, { ...AUTH, params });
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
  readTemplateById: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

import { GET, PATCH, DELETE } from "./route";
import {
  deleteTemplate,
  readTemplateById,
  updateTemplate,
} from "@/features/agent-templates/server/service";

const mockGet = vi.mocked(readTemplateById);
const mockUpdate = vi.mocked(updateTemplate);
const mockDelete = vi.mocked(deleteTemplate);

const TEMPLATE = {
  id: ID,
  workspaceId: "ws-1",
  name: "Researcher",
  description: null,
  instructions: null,
  model: null,
  fields: [],
  visibility: "private" as const,
  teamIds: [],
  knowledgeBases: [],
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

/** Export order is fixed by the module body: GET, PATCH, DELETE. */
const [GET_OPTS, PATCH_OPTS, DELETE_OPTS] = wrapperOptions;

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/agent-templates/${ID}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  params = { templateId: ID };
  mockGet.mockResolvedValue(TEMPLATE);
  mockUpdate.mockResolvedValue(TEMPLATE);
  mockDelete.mockResolvedValue(undefined);
});

describe("the per-method gate", () => {
  it("DELETE is sessionOnly; GET and PATCH are not", () => {
    expect(DELETE_OPTS).toMatchObject({ minRole: "member", sessionOnly: true });
    expect(GET_OPTS).toBeUndefined();
    expect(PATCH_OPTS).toMatchObject({ minRole: "member" });
    expect(PATCH_OPTS).not.toHaveProperty("sessionOnly");
  });
});

describe("GET", () => {
  it("returns `{ template }`", async () => {
    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ template: TEMPLATE });
    expect(mockGet).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1" }),
      ID
    );
  });

  it("400s on a non-UUID id BEFORE the service is reached", async () => {
    params = { templateId: "researcher" };
    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("surfaces a not-found as 404 with the domain code", async () => {
    const { AgentTemplateNotFoundError } = await import(
      "@/features/agent-templates/server/errors"
    );
    mockGet.mockRejectedValue(new AgentTemplateNotFoundError(ID));
    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("AGENT_TEMPLATE_NOT_FOUND");
  });
});

describe("PATCH", () => {
  it("passes the parsed patch through and answers `{ template }`", async () => {
    const res = await PATCH(req("PATCH", { name: "Renamed" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1" }),
      ID,
      { name: "Renamed" }
    );
  });

  it("400s an EMPTY patch rather than firing a no-op write", async () => {
    const res = await PATCH(req("PATCH", {}), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("403s when the caller may see but not edit", async () => {
    const { TemplateWriteForbiddenError } = await import(
      "@/features/agent-templates/server/errors"
    );
    mockUpdate.mockRejectedValue(new TemplateWriteForbiddenError("edit"));
    const res = await PATCH(req("PATCH", { name: "X" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("RESOURCE_ACCESS_DENIED");
  });
});

describe("DELETE", () => {
  it("answers 204 with NO body", async () => {
    const res = await DELETE(req("DELETE"), { params: Promise.resolve({}) });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1" }),
      ID
    );
  });
});
