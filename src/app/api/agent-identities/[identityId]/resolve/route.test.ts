/**
 * `GET /api/agent-identities/{identityId}/resolve`, the launch contract. Exact on purpose (`toEqual` and a
 * key set): an added key becomes a dependency, a removed one a broken spawn.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

let params: Record<string, string> = { identityId: ID };

const AUTH: Omit<WorkspaceAuthContext, "params"> = {
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "viewer",
  // The desktop presents a device token, an agent credential.
  agentTokenId: "at-desktop-1",
  apiKeyWorkspaceId: null,
};

// Captured when `./route` evaluates, before any plain `const` exists; hence `vi.hoisted`.
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
    source: auth.agentTokenId ? "agent" : "user",
    role: auth.role,
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId,
  }),
  resolveIdentityForLaunch: vi.fn(),
}));

import { GET } from "./route";
import { resolveIdentityForLaunch } from "@/features/agent-identities/server/service";

const mockResolve = vi.mocked(resolveIdentityForLaunch);

/** The payload, written out: the desktop consumer changes with it. */
const RESOLVED = {
  name: "Researcher",
  instructions: "You are a researcher. Cite sources.",
  model: "opus",
  runtime: "claude",
  fields: [
    { key: "tone", value: "terse" },
    { key: "repo", value: "acme/api" },
  ],
  knowledgeBases: [{ id: "kb-1", name: "Handbook" }],
  // Beside `knowledgeBases`, not replacing it: an older desktop's allowlist drops unknown keys (INVARIANTS §13).
  knowledge: [
    { baseId: "kb-1", baseName: "Handbook", scope: "base" as const, path: "Handbook" },
    {
      baseId: "kb-1",
      baseName: "Handbook",
      scope: "folder" as const,
      folderId: "f-1",
      folderName: "Deploys",
      path: "Handbook / Deploys",
      toolPath: "Deploys",
    },
  ],
  authoredByCaller: true,
  unreachableKnowledgeBaseCount: 0,
};

function req(): NextRequest {
  return new NextRequest(
    `http://localhost/api/agent-identities/${ID}/resolve`,
    { method: "GET" }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  params = { identityId: ID };
  mockResolve.mockResolvedValue(RESOLVED);
});

describe("the launch payload", () => {
  it("is EXACTLY {name, instructions, model, runtime, fields, knowledgeBases, knowledge, authoredByCaller, unreachableKnowledgeBaseCount} — flat, no envelope", async () => {
    const res = await GET(req(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Unwrapped on purpose, unlike the `{ identity }` record endpoints.
    expect(body).toEqual(RESOLVED);
    expect(Object.keys(body).sort()).toEqual([
      "authoredByCaller",
      "fields",
      "instructions",
      "knowledge",
      "knowledgeBases",
      "model",
      "name",
      "runtime",
      "unreachableKnowledgeBaseCount",
    ]);
  });

  it("carries NO id, visibility, ownership or timestamps", async () => {
    const body = await GET(req(), { params: Promise.resolve({}) }).then((r) => r.json());
    // `createdBy` too: the payload carries only the derived `authoredByCaller`.
    for (const key of [
      "id",
      "visibility",
      "teamIds",
      "createdBy",
      "createdAt",
      "updatedAt",
      "workspaceId",
      "description",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("nullable fields travel as NULL, never omitted", async () => {
    mockResolve.mockResolvedValue({
      name: "Bare",
      instructions: null,
      model: null,
      runtime: null,
      fields: [],
      knowledgeBases: [],
      authoredByCaller: false,
      knowledge: [],
      unreachableKnowledgeBaseCount: 0,
    });
    const body = await GET(req(), { params: Promise.resolve({}) }).then((r) => r.json());
    expect(body).toEqual({
      name: "Bare",
      instructions: null,
      model: null,
      runtime: null,
      fields: [],
      knowledgeBases: [],
      authoredByCaller: false,
      knowledge: [],
      unreachableKnowledgeBaseCount: 0,
    });
  });
});

describe("gating", () => {
  it("reads at VIEWER and is NOT sessionOnly — the desktop presents a device token", async () => {
    await GET(req(), { params: Promise.resolve({}) });
    expect(wrapperOptions[0]).toBeUndefined();
  });

  it("resolves for an AGENT-credential caller (source 'agent')", async () => {
    await GET(req(), { params: Promise.resolve({}) });
    expect(mockResolve).toHaveBeenCalledWith(
      expect.objectContaining({ source: "agent", workspaceId: "ws-1" }),
      ID
    );
  });

  it("404s — never 403s — for an identity the caller may not use", async () => {
    const { AgentIdentityNotFoundError } = await import(
      "@/features/agent-identities/server/errors"
    );
    mockResolve.mockRejectedValue(new AgentIdentityNotFoundError(ID));
    const res = await GET(req(), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("AGENT_IDENTITY_NOT_FOUND");
  });

  it("400s a non-UUID id before reaching the service", async () => {
    params = { identityId: "../../etc/passwd" };
    const res = await GET(req(), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
