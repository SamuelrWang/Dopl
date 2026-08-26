/**
 * `GET /api/agent-templates/{templateId}/resolve` — THE LAUNCH CONTRACT.
 *
 * ⚠ THIS FILE IS THE CONTRACT PIN, not a smoke test. The launch integration
 * codes against these keys verbatim, so the assertions are deliberately EXACT
 * (`toEqual`, and an explicit key-set check) rather than `toMatchObject`: a field
 * quietly added to the payload is a field a consumer will start depending on, and
 * a field quietly removed is a broken spawn.
 *
 * ⚠ FIVE KEYS BECAME SIX ON 2026-08-22, AND THIS FILE GOING RED WAS THE POINT
 * (G-1). `authoredByCaller` is what lets the desktop's ROLE block choose between
 * the operator posture and the `UNTRUSTED_SKILL_BODY_HEADER`-shaped one; the pin
 * is exact precisely so that widening had to be a deliberate, reviewed edit here
 * rather than something a consumer discovered at runtime.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

let params: Record<string, string> = { templateId: ID };

const AUTH: Omit<WorkspaceAuthContext, "params"> = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "viewer",
  // ⚠ A DEVICE TOKEN IS AN AGENT CREDENTIAL. The desktop is the caller this
  // endpoint exists for, so the fixture carries one — a route that only ever
  // worked for a session would fail in exactly the deployment that needs it.
  agentTokenId: "at-desktop-1",
  apiKeyWorkspaceId: null,
};

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
    source: auth.agentTokenId ? "agent" : "user",
    role: auth.role,
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId,
  }),
  resolveTemplateForLaunch: vi.fn(),
}));

import { GET } from "./route";
import { resolveTemplateForLaunch } from "@/features/agent-templates/server/service";

const mockResolve = vi.mocked(resolveTemplateForLaunch);

/** ⚠ THE PAYLOAD, WRITTEN OUT. If this literal changes, the integration
 *  builder's consumer changes with it — that is the whole reason it is here. */
const RESOLVED = {
  name: "Researcher",
  instructions: "You are a researcher. Cite sources.",
  model: "opus",
  fields: [
    { key: "tone", value: "terse" },
    { key: "repo", value: "acme/api" },
  ],
  knowledgeBases: [{ id: "kb-1", name: "Handbook" }],
  authoredByCaller: true,
};

function req(): NextRequest {
  return new NextRequest(
    `http://localhost/api/agent-templates/${ID}/resolve`,
    { method: "GET" }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  params = { templateId: ID };
  mockResolve.mockResolvedValue(RESOLVED);
});

describe("the launch payload", () => {
  it("is EXACTLY {name, instructions, model, fields, knowledgeBases, authoredByCaller} — flat, no envelope", async () => {
    const res = await GET(req(), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // ⚠ Unwrapped on purpose. The record endpoints answer `{ template }`; this
    // one is consumed by a launcher that wants the payload, not a container.
    expect(body).toEqual(RESOLVED);
    expect(Object.keys(body).sort()).toEqual([
      "authoredByCaller",
      "fields",
      "instructions",
      "knowledgeBases",
      "model",
      "name",
    ]);
  });

  it("carries NO id, visibility, ownership or timestamps", async () => {
    const body = await GET(req(), { params: Promise.resolve({}) }).then((r) => r.json());
    // ⚠ `createdBy` STAYS ON THIS LIST even though `authoredByCaller` is derived
    // from it. The boolean is the whole point: a raw creator id in a launch
    // payload is ownership information the launcher has no use for, and the
    // derived answer discloses nothing the caller cannot already read off the
    // list endpoint.
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
    // A launcher distinguishing "absent" from "null" is a launcher with two
    // code paths for one state.
    mockResolve.mockResolvedValue({
      name: "Bare",
      instructions: null,
      model: null,
      fields: [],
      knowledgeBases: [],
      authoredByCaller: false,
    });
    const body = await GET(req(), { params: Promise.resolve({}) }).then((r) => r.json());
    expect(body).toEqual({
      name: "Bare",
      instructions: null,
      model: null,
      fields: [],
      knowledgeBases: [],
      authoredByCaller: false,
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

  it("404s — never 403s — for a template the caller may not use", async () => {
    const { AgentTemplateNotFoundError } = await import(
      "@/features/agent-templates/server/errors"
    );
    mockResolve.mockRejectedValue(new AgentTemplateNotFoundError(ID));
    const res = await GET(req(), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("AGENT_TEMPLATE_NOT_FOUND");
  });

  it("400s a non-UUID id before reaching the service", async () => {
    params = { templateId: "../../etc/passwd" };
    const res = await GET(req(), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
