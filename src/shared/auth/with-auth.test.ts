/**
 * H-3 — OAuth write-scope + session-only gates inside `withUserAuth`.
 *
 * Drives the REAL `withUserAuth` with a stubbed `validateAccessToken` (the
 * bearer branch) and a stubbed Supabase `getUser` (the cookie/session branch),
 * so this exercises the actual discriminator: presence of an `Authorization`
 * header selects the token branch; its absence selects the session branch.
 *
 * Guarantees pinned here:
 *   - a read-only OAuth token (scopes lack `dopl.write`) is refused on every
 *     write method (fail-closed on missing/empty scopes too), with the
 *     `WWW-Authenticate: insufficient_scope` challenge, and the handler never
 *     runs;
 *   - a `dopl.write` token passes writes; any token passes reads;
 *   - a SESSION (cookie) caller is NEVER scope- or session-gated — the
 *     "don't lock out the web app" guarantee;
 *   - `writeScopeExempt` lets the read-only liveness ping through;
 *   - `sessionOnly` refuses EVERY OAuth token (even `dopl.write`) but admits a
 *     session caller.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({
  token: null as { userId: string; scopes: string[]; tokenId: string } | null,
  sessionUser: null as { id: string } | null,
}));

vi.mock("./mcp-session", () => ({ touchMcpStatus: vi.fn() }));
vi.mock("./mcp-oauth", () => ({
  validateAccessToken: vi.fn(async () => state.token),
}));
vi.mock("@/features/analytics/server/mcp-events", () => ({ logMcpEvent: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.sessionUser } }) },
  }),
}));

import { withUserAuth } from "./with-auth";

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

type RouteHandler = (
  request: NextRequest,
  context: {
    userId: string;
    agentTokenId?: string;
    apiKeyWorkspaceId?: string | null;
    params?: Record<string, string>;
  }
) => Promise<NextResponse>;

function handlerSpy() {
  return vi.fn<RouteHandler>(async () => NextResponse.json({ ok: true }));
}

/** Request carrying an OAuth bearer (routes to the token branch). */
function bearerReq(method: string): NextRequest {
  return new NextRequest("http://localhost/api/x", {
    method,
    headers: { authorization: "Bearer dopl_at_test" },
  });
}

/** Request with no Authorization header (routes to the session branch). */
function sessionReq(method: string): NextRequest {
  return new NextRequest("http://localhost/api/x", { method });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.token = null;
  state.sessionUser = null;
});

describe("write-scope gate — read-only OAuth token", () => {
  it.each(WRITE_METHODS)(
    "%s → 403 WRITE_SCOPE_REQUIRED, handler not invoked, insufficient_scope challenge",
    async (method) => {
      state.token = { userId: "u1", scopes: ["dopl.read"], tokenId: "t1" };
      const handler = handlerSpy();
      const res = await withUserAuth(handler)(bearerReq(method));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("WRITE_SCOPE_REQUIRED");
      expect(body).not.toHaveProperty("upgrade_url");
      expect(res.headers.get("WWW-Authenticate")).toContain("insufficient_scope");
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it("GET → handler runs (reads are always allowed)", async () => {
    state.token = { userId: "u1", scopes: ["dopl.read"], tokenId: "t1" };
    const handler = handlerSpy();
    const res = await withUserAuth(handler)(bearerReq("GET"));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("empty scopes + POST → 403 (fail-closed, mirrors server.ts)", async () => {
    state.token = { userId: "u1", scopes: [], tokenId: "t1" };
    const res = await withUserAuth(handlerSpy())(bearerReq("POST"));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("WRITE_SCOPE_REQUIRED");
  });

  it("missing scopes (undefined) + POST → 403 (fail-closed)", async () => {
    state.token = {
      userId: "u1",
      // simulate a token row with no scopes array
      scopes: undefined as unknown as string[],
      tokenId: "t1",
    };
    const res = await withUserAuth(handlerSpy())(bearerReq("POST"));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("WRITE_SCOPE_REQUIRED");
  });
});

describe("write-scope gate — dopl.write OAuth token", () => {
  it.each(WRITE_METHODS)("%s → handler runs (write allowed)", async (method) => {
    state.token = {
      userId: "u1",
      scopes: ["dopl.read", "dopl.write"],
      tokenId: "t1",
    };
    const handler = handlerSpy();
    const res = await withUserAuth(handler)(bearerReq(method));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("write-scope gate — session (cookie) caller is never restricted", () => {
  it.each(["GET", ...WRITE_METHODS])(
    "%s with no Authorization header → handler runs",
    async (method) => {
      state.sessionUser = { id: "web-user" };
      const handler = handlerSpy();
      const res = await withUserAuth(handler)(sessionReq(method));
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
      // the session user id is injected, and the agent marker is absent
      const ctx = handler.mock.calls[0][1];
      expect(ctx.userId).toBe("web-user");
      expect(ctx.agentTokenId).toBeUndefined();
    }
  );
});

describe("writeScopeExempt — the MCP liveness ping", () => {
  it("read-only token + POST on an exempt route → handler runs", async () => {
    state.token = { userId: "u1", scopes: ["dopl.read"], tokenId: "t1" };
    const handler = handlerSpy();
    const res = await withUserAuth(handler, { writeScopeExempt: true })(
      bearerReq("POST")
    );
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("sessionOnly gate — destructive admin surface", () => {
  it.each([["dopl.read"], ["dopl.read", "dopl.write"]])(
    "OAuth token (scopes=%j) → 403 SESSION_REQUIRED regardless of scope",
    async (...scopes) => {
      state.token = { userId: "u1", scopes: scopes as string[], tokenId: "t1" };
      const handler = handlerSpy();
      const res = await withUserAuth(handler, { sessionOnly: true })(
        bearerReq("DELETE")
      );
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("SESSION_REQUIRED");
      expect(handler).not.toHaveBeenCalled();
    }
  );

  it("session (cookie) caller → handler runs", async () => {
    state.sessionUser = { id: "web-user" };
    const handler = handlerSpy();
    const res = await withUserAuth(handler, { sessionOnly: true })(
      sessionReq("DELETE")
    );
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("sessionOnly takes precedence over the write-scope gate (write token still refused)", async () => {
    state.token = {
      userId: "u1",
      scopes: ["dopl.read", "dopl.write"],
      tokenId: "t1",
    };
    const res = await withUserAuth(handlerSpy(), { sessionOnly: true })(
      bearerReq("POST")
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SESSION_REQUIRED");
  });
});

describe("MCP read op is not falsely blocked", () => {
  // The `/api/mcp` JSON-RPC envelope is authenticated by a SEPARATE transport
  // wrapper (authenticateMcpRequest) and never reaches `withUserAuth`, so its
  // POST envelope is never method-gated. The per-op loopback call a READ op
  // makes is a GET (e.g. dopl_search → GET /api/knowledge/search), which a
  // read-only token is allowed to make — verified here at the wrapper level.
  it("read-only token + GET loopback (shape of an MCP read op) → handler runs", async () => {
    state.token = { userId: "u1", scopes: ["dopl.read"], tokenId: "t1" };
    const handler = handlerSpy();
    const res = await withUserAuth(handler)(bearerReq("GET"));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});
