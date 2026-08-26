/**
 * `withUserAuth` — the OAuth-bearer RATE LIMIT. A `dopl_at_*` bearer is accepted
 * directly on every REST route, so without a limiter here the transport's
 * per-token ceiling (`with-mcp-transport-auth.ts`, subject `mcp:<tokenId>`) is
 * bypassed by pointing the same token at `/api/knowledge/…`.
 *
 * Pins: SAME subject as the transport, same 600/min default, enforced BEFORE the
 * scope/session gates — and ⚠ cookie / Supabase-JWT SESSION callers are never
 * limited. Drives the REAL `withUserAuth` with the same stubs as its sibling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({
  token: null as { userId: string; scopes: string[]; tokenId: string } | null,
  sessionUser: null as { id: string } | null,
  jwtUser: null as { id: string } | null,
  /** Within-ceiling flag + every (subject, rpm, endpoint) checked. */
  rateLimitWithin: true as boolean,
  rateLimitCalls: [] as { subject: string; rpm: number; endpoint: string }[],
}));

vi.mock("./mcp-session", () => ({
  touchMcpStatus: vi.fn(),
  checkAndRecordRateLimitSubject: vi.fn(
    async (subject: string, rpm: number, endpoint: string) => {
      state.rateLimitCalls.push({ subject, rpm, endpoint });
      return state.rateLimitWithin;
    }
  ),
}));
vi.mock("./mcp-oauth", () => ({
  validateAccessToken: vi.fn(async () => state.token),
  isOAuthAccessToken: (token: string) => token.startsWith("dopl_at_"),
}));
vi.mock("@/features/analytics/server/mcp-events", () => ({ logMcpEvent: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
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
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getClaims: async () => {
        if (!state.jwtUser) throw new Error("JWT has expired");
        return { data: { claims: { sub: state.jwtUser.id } }, error: null };
      },
    },
  }),
}));

import { withUserAuth } from "./with-auth";

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

function handlerSpy() {
  return vi.fn(async () => NextResponse.json({ ok: true }));
}

function bearerReq(method: string): NextRequest {
  return new NextRequest("http://localhost/api/x", {
    method,
    headers: { authorization: "Bearer dopl_at_test" },
  });
}
function sessionReq(method: string): NextRequest {
  return new NextRequest("http://localhost/api/x", { method });
}
const ES256_JWT =
  Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "kid-1" })).toString(
    "base64url"
  ) + ".payload.sig";
function jwtReq(method: string): NextRequest {
  return new NextRequest("http://localhost/api/x", {
    method,
    headers: { authorization: `Bearer ${ES256_JWT}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.token = null;
  state.sessionUser = null;
  state.jwtUser = null;
  state.rateLimitWithin = true;
  state.rateLimitCalls = [];
});

describe("OAuth-bearer rate limit", () => {
  it("within the limit → handler runs, keyed on mcp:<tokenId> at the shared 600 ceiling", async () => {
    state.token = { userId: "u1", scopes: ["dopl.read"], tokenId: "tok-1" };
    const handler = handlerSpy();
    const res = await withUserAuth(handler)(bearerReq("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(state.rateLimitCalls).toEqual([
      { subject: "mcp:tok-1", rpm: 600, endpoint: "GET /api/x" },
    ]);
  });

  it("over the limit → 429 RATE_LIMITED with Retry-After, handler never runs", async () => {
    state.token = { userId: "u1", scopes: ["dopl.read"], tokenId: "tok-1" };
    state.rateLimitWithin = false;
    const handler = handlerSpy();
    const res = await withUserAuth(handler)(bearerReq("GET"), { params: Promise.resolve({}) });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(handler).not.toHaveBeenCalled();
  });

  it("is enforced BEFORE the write-scope gate (read-only write over-limit → 429, not 403)", async () => {
    state.token = { userId: "u1", scopes: ["dopl.read"], tokenId: "tok-1" };
    state.rateLimitWithin = false;
    const res = await withUserAuth(handlerSpy())(bearerReq("POST"), { params: Promise.resolve({}) });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });

  it("is enforced BEFORE the sessionOnly gate (full-write token over-limit → 429, not 403)", async () => {
    state.token = { userId: "u1", scopes: ["dopl.read", "dopl.write"], tokenId: "tok-1" };
    state.rateLimitWithin = false;
    const res = await withUserAuth(handlerSpy(), { sessionOnly: true })(
      bearerReq("DELETE"), { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(429);
  });

  it("a cookie SESSION caller is NEVER rate-limited (limiter not consulted)", async () => {
    state.sessionUser = { id: "web-user" };
    state.rateLimitWithin = false; // would 429 a bearer
    for (const method of ["GET", ...WRITE_METHODS]) {
      const res = await withUserAuth(handlerSpy())(sessionReq(method), { params: Promise.resolve({}) });
      expect(res.status).toBe(200);
    }
    expect(state.rateLimitCalls).toEqual([]);
  });

  it("a Supabase-JWT SESSION caller is NEVER rate-limited", async () => {
    state.jwtUser = { id: "user-jwt" };
    state.rateLimitWithin = false;
    const res = await withUserAuth(handlerSpy())(jwtReq("POST"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(state.rateLimitCalls).toEqual([]);
  });
});
