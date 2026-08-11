/**
 * C-13 (visibility half) — the channel PATCH's FIELD-level session gate.
 *
 * THE SECURITY PROPERTY: private→public exposes the entire channel AND its
 * history to every member of the workspace. Samuel's ruling (2026-08-10) is
 * that the widening takes a human. The gate is per-FIELD rather than per-METHOD
 * because this one PATCH is four writes behind one verb — `name`, `topic`,
 * `archived` have no audience consequence and stay agent-reachable, which is
 * exactly what the last two cases here pin. Take the gate off and the first
 * three fail; widen it to the whole method and the last two fail.
 *
 * Both DIRECTIONS are refused for an agent, not only the widening: no MCP op or
 * desktop call reaches this field today, so there is no narrowing caller to
 * break, and a direction-free gate needs no read of the current row.
 *
 * Mocking is the `members/route.test.ts` idiom — token layer, workspace
 * resolution and the channels service only. `withWorkspaceAuth` / `withUserAuth`
 * are the shipping ones, so the agent-vs-session discrimination is real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  token: null as { userId: string; scopes: string[]; tokenId: string } | null,
  sessionUser: null as { id: string } | null,
  jwtUser: null as { id: string } | null,
}));

vi.mock("@/shared/auth/mcp-session", () => ({
  touchMcpStatus: vi.fn(),
  checkAndRecordRateLimitSubject: vi.fn(async () => true),
}));
vi.mock("@/features/analytics/server/mcp-events", () => ({ logMcpEvent: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
vi.mock("@/features/analytics/server/mcp-tool-calls", () => ({ logMcpToolCall: vi.fn() }));
vi.mock("@/shared/auth/bearer-jwt", () => ({
  getBearerJwtUser: vi.fn(async () => state.jwtUser),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: state.sessionUser
          ? {
              claims: { sub: state.sessionUser.id },
              header: { alg: "ES256", typ: "JWT", kid: "kid-1" },
              signature: new Uint8Array(64),
            }
          : null,
        error: null,
      }),
      getUser: async () => ({ data: { user: state.sessionUser } }),
    },
  }),
}));
vi.mock("@/shared/auth/mcp-oauth", () => ({
  validateAccessToken: vi.fn(async () => state.token),
  isOAuthAccessToken: (token: string) => token.startsWith("dopl_at_"),
}));
vi.mock("@/features/workspaces/server/service", () => ({
  resolveActiveWorkspace: vi.fn(async (userId: string) => ({
    workspace: { id: "ws-1", slug: "acme", publicId: "pub-1" },
    membership: { userId, role: "member" },
  })),
  WorkspaceResolutionError: class WorkspaceResolutionError extends Error {},
}));
vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: (auth: { workspaceId: string; userId: string }) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
  }),
  getChannel: vi.fn(async () => ({ id: "c-1" })),
  updateChannel: vi.fn(async () => ({ id: "c-1", visibility: "public" })),
  deleteChannel: vi.fn(async () => undefined),
}));

import { PATCH } from "./route";
import { updateChannel } from "@/features/channels/server/service";

const CHANNEL = "22222222-2222-4222-8222-222222222222";
const URL_ = `http://localhost/api/channels/${CHANNEL}`;
const params = { params: Promise.resolve({ channelId: CHANNEL }) };

const WRITE_TOKEN = {
  userId: "agent-user",
  scopes: ["dopl.read", "dopl.write"],
  tokenId: "tok-agent",
};

function agentReq(body: unknown): NextRequest {
  return new NextRequest(URL_, {
    method: "PATCH",
    headers: {
      authorization: "Bearer dopl_at_agent",
      "content-type": "application/json",
      "x-workspace-id": "ws-1",
    },
    body: JSON.stringify(body),
  });
}

function sessionReq(body: unknown): NextRequest {
  return new NextRequest(URL_, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-workspace-id": "ws-1" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.token = null;
  state.sessionUser = null;
  state.jwtUser = null;
});

describe("visibility is session-only", () => {
  it("an agent bearer WIDENING private→public is refused 403, service never runs", async () => {
    state.token = WRITE_TOKEN;
    const res = await PATCH(agentReq({ visibility: "public" }), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("SESSION_REQUIRED");
    expect(body.error.message).toMatch(/visibility/);
    expect(updateChannel).not.toHaveBeenCalled();
  });

  it("an agent bearer NARROWING public→private is refused too (direction-free)", async () => {
    state.token = WRITE_TOKEN;
    const res = await PATCH(agentReq({ visibility: "private" }), params);
    expect(res.status).toBe(403);
    expect(updateChannel).not.toHaveBeenCalled();
  });

  it("a mixed patch is refused WHOLE — the gated field does not slip through beside a legal one", async () => {
    state.token = WRITE_TOKEN;
    const res = await PATCH(agentReq({ name: "renamed", visibility: "public" }), params);
    expect(res.status).toBe(403);
    expect(updateChannel).not.toHaveBeenCalled();
  });

  it("a cookie SESSION caller goes public — the human path is untouched", async () => {
    state.sessionUser = { id: "user-9" };
    const res = await PATCH(sessionReq({ visibility: "public" }), params);
    expect(res.status).toBe(200);
    expect(updateChannel).toHaveBeenCalledWith(expect.anything(), CHANNEL, {
      visibility: "public",
    });
  });

  it("a Supabase-JWT bearer (the bundled desktop SPA) is a SESSION and goes public", async () => {
    state.jwtUser = { id: "desktop-user" };
    const req = new NextRequest(URL_, {
      method: "PATCH",
      headers: {
        authorization: "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6ImsxIn0.e30.sig",
        "content-type": "application/json",
        "x-workspace-id": "ws-1",
      },
      body: JSON.stringify({ visibility: "public" }),
    });
    expect((await PATCH(req, params)).status).toBe(200);
    expect(updateChannel).toHaveBeenCalledTimes(1);
  });
});

describe("the OTHER fields on the same PATCH stay agent-reachable", () => {
  it("an agent bearer may archive", async () => {
    state.token = WRITE_TOKEN;
    const res = await PATCH(agentReq({ archived: true }), params);
    expect(res.status).toBe(200);
    expect(updateChannel).toHaveBeenCalledWith(expect.anything(), CHANNEL, {
      archived: true,
    });
  });

  it("an agent bearer may rename / re-topic", async () => {
    state.token = WRITE_TOKEN;
    const res = await PATCH(agentReq({ name: "renamed", topic: "new topic" }), params);
    expect(res.status).toBe(200);
    expect(updateChannel).toHaveBeenCalledTimes(1);
  });
});
