/** `GET|POST /api/agent-identities` composition; auth is mocked at the wrapper so its options are assertable. */

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

/** The wrapper's options are the contract. */
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

vi.mock("@/features/agent-identities/server/service", () => ({
  buildAgentIdentityContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: "user",
    role: auth.role,
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId,
  }),
  listIdentities: vi.fn(),
  listHomeScopedIdentityIds: vi.fn(),
  createIdentity: vi.fn(),
}));

import { GET, POST } from "./route";
import {
  createIdentity,
  listHomeScopedIdentityIds,
  listIdentities,
} from "@/features/agent-identities/server/service";

const mockList = vi.mocked(listIdentities);
const mockCreate = vi.mocked(createIdentity);
const mockHomeScoped = vi.mocked(listHomeScopedIdentityIds);

const IDENTITY = {
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
  return new NextRequest(`http://localhost/api/agent-identities?shelf=${shelf}`, {
    method: "GET",
  });
}

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/agent-identities", {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  wrapperOptions.length = 0;
  mockList.mockResolvedValue([IDENTITY]);
  mockHomeScoped.mockResolvedValue([]);
  mockCreate.mockResolvedValue(IDENTITY);
});

describe("GET /api/agent-identities", () => {
  it("returns `{ identities }` with each row carrying its VISIBILITY", async () => {
    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The client groups on this field.
    expect(body.identities[0].visibility).toBe("workspace");
  });

  it("folds homeScopedIdentityIds in as a SIBLING KEY, never onto the row", async () => {
    // A sibling key, so the cached row payload gains no field; the stale-cache rule applies to this key (INVARIANTS §8).
    mockHomeScoped.mockResolvedValue([IDENTITY.id]);

    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    const body = await res.json();
    expect(body.homeScopedIdentityIds).toEqual([IDENTITY.id]);
    expect(mockHomeScoped).toHaveBeenCalledWith(expect.anything(), [IDENTITY]);
    expect("homeScoped" in body.identities[0]).toBe(false);
    expect("shelf" in body.identities[0]).toBe(false);
  });

  it("degrades a shelf-flag failure to [] — UNLABELLED, never mislabelled", async () => {
    // The roster is the answer and the label decoration; `[]` can never call a workspace identity personal.
    mockHomeScoped.mockRejectedValue(new Error("flag read down"));

    const res = await GET(req("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.homeScopedIdentityIds).toEqual([]);
    expect(body.identities).toHaveLength(1);
  });

  it("reads at VIEWER — the default, so no options are passed", async () => {
    await GET(req("GET"), { params: Promise.resolve({}) });
    expect(wrapperOptions[0]).toBeUndefined();
  });
});

describe("POST /api/agent-identities", () => {
  it("creates and answers 201 with `{ identity }`", async () => {
    const res = await POST(req("POST", { name: "Researcher" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ identity: IDENTITY });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", userId: "user-1" }),
      { name: "Researcher" }
    );
  });

  it("writes require `member`", async () => {
    await POST(req("POST", { name: "R" }), { params: Promise.resolve({}) });
    expect(wrapperOptions.at(-1)).toMatchObject({ minRole: "member" });
  });

  it("is NOT sessionOnly — an orchestrator agent authoring an identity is the feature", async () => {
    await POST(req("POST", { name: "R" }), { params: Promise.resolve({}) });
    expect(wrapperOptions.at(-1)).not.toHaveProperty("sessionOnly");
  });

  it("400s on a body the schema refuses, with the zod issues in `details`", async () => {
    const res = await POST(req("POST", { name: "" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    const body = await res.json();
    // The nested `HttpError.toResponseBody()` envelope: `{ error: { code, message, details? } }`.
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("maps a domain error to its own status, not a 500", async () => {
    const { IdentityKnowledgeBaseNotFoundError } = await import(
      "@/features/agent-identities/server/errors"
    );
    mockCreate.mockRejectedValue(new IdentityKnowledgeBaseNotFoundError(["kb-x"]));
    const res = await POST(req("POST", { name: "R" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("KNOWLEDGE_BASE_NOT_FOUND");
    expect(body.error.details).toEqual({ knowledgeBaseIds: ["kb-x"] });
  });
});

/** `?shelf=` (`types.ts › IdentityShelf`): absent means both, so a misspelling must 400, never widen. */
describe("GET /api/agent-identities?shelf=", () => {
  it("passes a recognised shelf DOWN to the service", async () => {
    await GET(shelfReq("home"), { params: Promise.resolve({}) });
    expect(mockList).toHaveBeenCalledWith(expect.anything(), { shelf: "home" });

    await GET(shelfReq("workspace"), { params: Promise.resolve({}) });
    expect(mockList).toHaveBeenLastCalledWith(expect.anything(), {
      shelf: "workspace",
    });
  });

  it("asks for BOTH shelves when the param is absent", async () => {
    // Every pre-shelf caller lands here; the launch picker must keep seeing both shelves.
    await GET(req("GET"), { params: Promise.resolve({}) });
    expect(mockList).toHaveBeenCalledWith(expect.anything(), { shelf: undefined });
  });

  it("400s an UNRECOGNISED shelf instead of widening to the mixed list", async () => {
    const res = await GET(shelfReq("hom"), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });
});
