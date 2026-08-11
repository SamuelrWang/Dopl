/**
 * C-12 — the members route's CALLER-TYPE matrix.
 *
 * THE SECURITY PROPERTY THIS FILE EXISTS FOR: an agent must not be able to
 * operate the control that contains it. `PATCH` writes `agentToolProfile` and
 * (since F-170 took notify scope out) nothing else, so the profile the operator
 * sets is the whole of that method. The desktop hands every spawned agent a
 * 90-day `dopl.read`+`dopl.write` device token, and a `full` profile has live
 * Bash — so without the gate the agent reads its own bearer off disk and PATCHes
 * its profile back to `full` after the operator tightens it, durably.
 *
 * The three cases that matter are pinned per-METHOD rather than inferred from an
 * option object: PATCH refuses every bearer regardless of scope, and GET / POST /
 * DELETE stay reachable — invites are deliberately untouched by this change
 * (C-13's invite half is a separate, unmade decision).
 *
 * Only the token layer, the workspace resolution and the channels service are
 * mocked. `withWorkspaceAuth` and its inner `withUserAuth` are the SHIPPING
 * ones, so the discriminator under test is the real one: an `Authorization:
 * Bearer dopl_at_*` header selects the agent branch, a Supabase JWT bearer and
 * a cookie both select the session branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  token: null as { userId: string; scopes: string[]; tokenId: string } | null,
  sessionUser: null as { id: string } | null,
  /** The bundled desktop SPA's credential: a Supabase access JWT as a bearer. */
  jwtUser: null as { id: string } | null,
}));

vi.mock("@/shared/auth/mcp-session", () => ({
  touchMcpStatus: vi.fn(),
  // The OAuth branch rate-limits BEFORE the sessionOnly gate; admit everything
  // so the refusal under test is the caller-type one, not the ceiling.
  checkAndRecordRateLimitSubject: vi.fn(async () => true),
}));
vi.mock("@/features/analytics/server/mcp-events", () => ({ logMcpEvent: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
vi.mock("@/features/analytics/server/mcp-tool-calls", () => ({ logMcpToolCall: vi.fn() }));
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
// The JWKS verification itself (`bearer-jwt.ts`) is exercised by its own suite;
// stubbed here so a NON-`dopl_at_` bearer can take its real branch in the
// wrapper without a live Supabase project.
vi.mock("@/shared/auth/bearer-jwt", () => ({
  getBearerJwtUser: vi.fn(async () => state.jwtUser),
}));
vi.mock("@/shared/auth/mcp-oauth", () => ({
  validateAccessToken: vi.fn(async () => state.token),
  // The wrapper discriminates bearer KINDS through this predicate before it
  // ever validates: a Supabase JWT presented as a bearer takes the SESSION
  // branch. Mirror the real prefix check.
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
  listChannelMembers: vi.fn(async () => []),
  addMember: vi.fn(async () => ({ userId: "u-2" })),
  removeMember: vi.fn(async () => undefined),
  updateMyMemberSettings: vi.fn(async () => ({ agentToolProfile: "read_only" })),
}));

import { GET, POST, DELETE, PATCH } from "./route";
import {
  addMember,
  removeMember,
  updateMyMemberSettings,
} from "@/features/channels/server/service";

const CHANNEL = "22222222-2222-4222-8222-222222222222";
const URL_ = `http://localhost/api/channels/${CHANNEL}/members`;
const params = { params: Promise.resolve({ channelId: CHANNEL }) };

const WRITE_TOKEN = {
  userId: "agent-user",
  scopes: ["dopl.read", "dopl.write"],
  tokenId: "tok-agent",
};

/** A `dopl_at_*` bearer — the agent branch. */
function agentReq(method: string, body?: unknown): NextRequest {
  return new NextRequest(URL_, {
    method,
    headers: {
      authorization: "Bearer dopl_at_agent",
      "content-type": "application/json",
      "x-workspace-id": "ws-1",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** No Authorization header — the cookie-session branch. */
function sessionReq(method: string, body?: unknown): NextRequest {
  return new NextRequest(URL_, {
    method,
    headers: { "content-type": "application/json", "x-workspace-id": "ws-1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.token = null;
  state.sessionUser = null;
  state.jwtUser = null;
});

describe("PATCH (agent tool profile) — the C-12 gate", () => {
  it("a cookie SESSION caller writes the profile", async () => {
    state.sessionUser = { id: "user-9" };
    const res = await PATCH(sessionReq("PATCH", { agentToolProfile: "full" }), params);
    expect(res.status).toBe(200);
    expect(updateMyMemberSettings).toHaveBeenCalledTimes(1);
  });

  it("a FULL-WRITE agent bearer is REFUSED 403 SESSION_REQUIRED, service never runs", async () => {
    state.token = WRITE_TOKEN;
    const res = await PATCH(agentReq("PATCH", { agentToolProfile: "full" }), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SESSION_REQUIRED");
    expect(updateMyMemberSettings).not.toHaveBeenCalled();
  });

  it("a read-only bearer is refused too — the gate is caller TYPE, not scope", async () => {
    state.token = { userId: "agent-user", scopes: ["dopl.read"], tokenId: "tok-ro" };
    const res = await PATCH(agentReq("PATCH", { agentToolProfile: "read_only" }), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SESSION_REQUIRED");
    expect(updateMyMemberSettings).not.toHaveBeenCalled();
  });

  it("the refusal precedes the body — even a well-formed narrowing patch is refused", async () => {
    state.token = WRITE_TOKEN;
    const res = await PATCH(agentReq("PATCH", { agentToolProfile: "read_only" }), params);
    expect(res.status).toBe(403);
  });
});

describe("the DESKTOP is unaffected — a Supabase JWT bearer is a SESSION", () => {
  it("a non-`dopl_at_` bearer takes the session branch and the write lands", async () => {
    // This is the desktop outage case, stated as a test: the bundled SPA
    // authenticates with a Supabase access JWT and the desktop main process
    // with the session cookie jar. Neither is `dopl_at_*`, so neither sets
    // `agentTokenId` and neither meets the gate — the operator's own tightening
    // and re-widening of the profile keeps working from both surfaces.
    state.jwtUser = { id: "desktop-user" };
    const req = new NextRequest(URL_, {
      method: "PATCH",
      headers: {
        authorization: "Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6ImsxIn0.e30.sig",
        "content-type": "application/json",
        "x-workspace-id": "ws-1",
      },
      body: JSON.stringify({ agentToolProfile: "full" }),
    });
    const res = await PATCH(req, params);
    expect(res.status).toBe(200);
    expect(updateMyMemberSettings).toHaveBeenCalledTimes(1);
  });
});

describe("the OTHER methods are deliberately NOT gated (invites stay as-is)", () => {
  it("GET is open to an agent bearer — reading the roster decides nothing", async () => {
    state.token = WRITE_TOKEN;
    expect((await GET(agentReq("GET"), params)).status).toBe(200);
  });

  it("POST (add a member) still admits a write-scoped agent bearer", async () => {
    state.token = WRITE_TOKEN;
    const res = await POST(
      agentReq("POST", { userId: "33333333-3333-4333-8333-333333333333" }),
      params
    );
    expect(res.status).toBe(201);
    expect(addMember).toHaveBeenCalledTimes(1);
  });

  it("DELETE (remove a member) still admits a write-scoped agent bearer", async () => {
    state.token = WRITE_TOKEN;
    const res = await DELETE(
      agentReq("DELETE", { userId: "33333333-3333-4333-8333-333333333333" }),
      params
    );
    expect(res.status).toBe(204);
    expect(removeMember).toHaveBeenCalledTimes(1);
  });
});
