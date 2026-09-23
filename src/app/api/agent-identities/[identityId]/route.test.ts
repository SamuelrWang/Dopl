/**
 * `GET|PATCH|DELETE /api/agent-identities/{identityId}`. Only `DELETE` is `sessionOnly`: agents list and
 * edit identities. `write-gate-coverage.test.ts` sees the file; only this sees which method.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** Mutable so one test can hand the route a malformed param. */
let params: Record<string, string> = { identityId: ID };

const AUTH: Omit<WorkspaceAuthContext, "params"> = {
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
};

// Captured per export when `./route` evaluates, before any plain `const` exists; hence `vi.hoisted`.
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

vi.mock("@/features/agent-identities/server/service", () => ({
  buildAgentIdentityContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: "user",
    role: auth.role,
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId,
  }),
  readIdentityById: vi.fn(),
  updateIdentity: vi.fn(),
  deleteIdentity: vi.fn(),
}));

import { GET, PATCH, DELETE } from "./route";
import {
  deleteIdentity,
  readIdentityById,
  updateIdentity,
} from "@/features/agent-identities/server/service";

const mockGet = vi.mocked(readIdentityById);
const mockUpdate = vi.mocked(updateIdentity);
const mockDelete = vi.mocked(deleteIdentity);

const IDENTITY = {
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

function req(method: string, body?: unknown, expectedVersion?: string): NextRequest {
  return new NextRequest(`http://localhost/api/agent-identities/${ID}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            ...(expectedVersion ? { "x-updated-at": expectedVersion } : {}),
          },
        }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  params = { identityId: ID };
  mockGet.mockResolvedValue(IDENTITY);
  mockUpdate.mockResolvedValue(IDENTITY);
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
  it("returns `{ identity }`", async () => {
    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ identity: IDENTITY });
    expect(mockGet).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1" }),
      ID
    );
  });

  it("400s on a non-UUID id BEFORE the service is reached", async () => {
    params = { identityId: "researcher" };
    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("surfaces a not-found as 404 with the domain code", async () => {
    const { AgentIdentityNotFoundError } = await import(
      "@/features/agent-identities/server/errors"
    );
    mockGet.mockRejectedValue(new AgentIdentityNotFoundError(ID));
    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("AGENT_IDENTITY_NOT_FOUND");
  });
});

describe("PATCH", () => {
  it("passes the parsed patch through and answers `{ identity }`", async () => {
    const res = await PATCH(req("PATCH", { name: "Renamed" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    // No `X-Updated-At`: last-writer-wins, what an older bundled client sends.
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1" }),
      ID,
      { name: "Renamed" },
      undefined
    );
  });

  // The header is the precondition (F-747); the route only relays it.
  it("relays `X-Updated-At` as the update's expected version", async () => {
    const res = await PATCH(
      req("PATCH", { name: "Renamed" }, "2026-01-01T00:00:00Z"),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.anything(),
      ID,
      { name: "Renamed" },
      "2026-01-01T00:00:00Z"
    );
  });

  it("412s a stale write with the domain code and the two versions", async () => {
    const { IdentityStaleVersionError } = await import(
      "@/features/agent-identities/server/errors"
    );
    mockUpdate.mockRejectedValue(
      new IdentityStaleVersionError("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")
    );
    const res = await PATCH(
      req("PATCH", { name: "Renamed" }, "2026-01-01T00:00:00Z"),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(412);
    const body = await res.json();
    expect(body.error.code).toBe("AGENT_IDENTITY_STALE_VERSION");
    expect(body.error.details).toMatchObject({
      expected: "2026-01-01T00:00:00Z",
      actual: "2026-01-02T00:00:00Z",
    });
  });

  it("400s an EMPTY patch rather than firing a no-op write", async () => {
    const res = await PATCH(req("PATCH", {}), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("403s when the caller may see but not edit", async () => {
    const { IdentityWriteForbiddenError } = await import(
      "@/features/agent-identities/server/errors"
    );
    mockUpdate.mockRejectedValue(new IdentityWriteForbiddenError("edit"));
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
