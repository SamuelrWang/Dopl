/**
 * H-3 — OAuth write-scope + session-only gates inside `withUserAuth`.
 *
 * Drives the REAL `withUserAuth` with a stubbed `validateAccessToken` (the
 * bearer branch) and a stubbed Supabase auth client (the cookie/session branch),
 * so this exercises the actual discriminator: presence of an `Authorization`
 * header selects the token branch; its absence selects the session branch.
 *
 * The session branch also carries Q11: it resolves the caller from LOCALLY
 * verified claims (`getClaims()`), never a network `getUser()`. The last block
 * pins that, and the failure modes that swap could have turned into an outage.
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
  /** Phase 2 bearer-JWT branch: user resolved from a Supabase JWT presented
   *  as `Authorization: Bearer <jwt>` (no dopl_at_ prefix). */
  jwtUser: null as { id: string } | null,
  calls_jwtGetClaims: [] as string[],
  /** Q11: `getClaims()` re-throws plain (non-Auth) Errors at the caller. */
  claimsThrows: null as Error | null,
  /** Q11: a bad signature comes back as `{ data: null, error }`. */
  claimsError: null as Error | null,
  calls: { getUser: 0, getClaims: 0 },
}));

vi.mock("./mcp-session", () => ({ touchMcpStatus: vi.fn() }));
vi.mock("./mcp-oauth", () => ({
  validateAccessToken: vi.fn(async () => state.token),
  // Real predicate, not a stub — the bearer-kind router depends on it.
  isOAuthAccessToken: (token: string) => token.startsWith("dopl_at_"),
}));
vi.mock("@/features/analytics/server/mcp-events", () => ({ logMcpEvent: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      /**
       * Mirrors the real `getClaims()`: local ES256 verification, and the trap —
       * auth-js `validateExp` throws a PLAIN Error which `getClaims()` re-throws
       * (only `AuthError`s become `{ data: null, error }`). See
       * `proxy-claims.test.ts` for the proof against the real client.
       */
      getClaims: async () => {
        state.calls.getClaims++;
        if (state.claimsThrows) throw state.claimsThrows;
        if (state.claimsError) return { data: null, error: state.claimsError };
        return {
          data: state.sessionUser
            ? {
                claims: { sub: state.sessionUser.id },
                header: { alg: "ES256", typ: "JWT", kid: "kid-1" },
                signature: new Uint8Array(64),
              }
            : null,
          error: null,
        };
      },
      /** The network path (≈5 Postgres queries). Reaching it is the Q11 regression. */
      getUser: async () => {
        state.calls.getUser++;
        return { data: { user: state.sessionUser } };
      },
    },
  }),
}));

vi.mock("@supabase/supabase-js", () => ({
  // The bare cookie-less client the bearer-JWT branch verifies against.
  createClient: () => ({
    auth: {
      getClaims: async (jwt?: string) => {
        state.calls_jwtGetClaims.push(jwt ?? "");
        if (!state.jwtUser) throw new Error("JWT has expired");
        return {
          data: { claims: { sub: state.jwtUser.id } },
          error: null,
        };
      },
    },
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

/** Request carrying a Supabase JWT bearer (routes to the JWT-session branch). */
/** A structurally valid ES256+kid JWT header (the pre-check in
 *  bearer-jwt.ts requires alg === "ES256" and a kid BEFORE getClaims is
 *  consulted — anything else must never reach the network). */
const ES256_JWT =
  Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "kid-1" }))
    .toString("base64url") + ".payload.sig";

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
  state.claimsThrows = null;
  state.claimsError = null;
  state.calls = { getUser: 0, getClaims: 0 };
  state.jwtUser = null;
  state.calls_jwtGetClaims = [];
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

// ── Q11 — the session branch is LOCAL, and fails closed ─────────────────────
//
// `getSessionUser` is composed by every `/api/channels/**` route (through
// `withWorkspaceAuth`). It used to make an uncached network `getUser()` per
// request — one idle focused tab was ~900 consent-inbox polls/hour, ~4,500
// GoTrue-side Postgres queries/hour at zero user activity. A mistake in the swap
// is an outage on every API route, so each failure mode is pinned separately.
describe("session branch resolves the caller locally (Q11)", () => {
  it("a session request makes ZERO network getUser() calls", async () => {
    state.sessionUser = { id: "web-user" };
    const res = await withUserAuth(handlerSpy())(sessionReq("GET"));
    expect(res.status).toBe(200);
    expect(state.calls.getClaims).toBe(1);
    expect(state.calls.getUser).toBe(0);
  });

  it("100 consecutive authenticated API calls cost 0 GoTrue round-trips", async () => {
    state.sessionUser = { id: "web-user" };
    const wrapped = withUserAuth(handlerSpy());
    for (let i = 0; i < 100; i++) await wrapped(sessionReq("GET"));
    expect(state.calls.getUser).toBe(0);
  });

  it("the handler gets claims.sub as the user id", async () => {
    state.sessionUser = { id: "11111111-1111-1111-1111-111111111111" };
    const handler = handlerSpy();
    await withUserAuth(handler)(sessionReq("POST"));
    expect(handler.mock.calls[0][1].userId).toBe(
      "11111111-1111-1111-1111-111111111111"
    );
  });

  it("no session → 401, handler never runs", async () => {
    state.sessionUser = null;
    const handler = handlerSpy();
    const res = await withUserAuth(handler)(sessionReq("GET"));
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("an EXPIRED token (getClaims throws a plain Error) → 401, not a 500", async () => {
    // THE TRAP: `validateExp` throws a plain Error that `getClaims()` re-throws.
    // Unwrapped, this is a 500 on every API route the wrapper composes.
    state.sessionUser = { id: "web-user" };
    state.claimsThrows = new Error("JWT has expired");
    const handler = handlerSpy();
    const res = await withUserAuth(handler)(sessionReq("GET"));
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("a token with no exp claim (also a throw) → 401", async () => {
    state.sessionUser = { id: "web-user" };
    state.claimsThrows = new Error("Missing exp claim");
    const res = await withUserAuth(handlerSpy())(sessionReq("POST"));
    expect(res.status).toBe(401);
  });

  it("a BAD SIGNATURE fails closed → 401, and is never re-checked on the network", async () => {
    state.sessionUser = { id: "web-user" }; // a sub is present but unverifiable
    state.claimsError = new Error("Invalid JWT signature");
    const handler = handlerSpy();
    const res = await withUserAuth(handler)(sessionReq("GET"));
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(state.calls.getUser).toBe(0);
  });

  it("an OAuth bearer still short-circuits before the session branch", async () => {
    state.token = { userId: "u1", scopes: ["dopl.read"], tokenId: "t1" };
    const res = await withUserAuth(handlerSpy())(bearerReq("GET"));
    expect(res.status).toBe(200);
    expect(state.calls.getClaims).toBe(0);
    expect(state.calls.getUser).toBe(0);
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

/**
 * Phase 2 (desktop migration) — a Supabase access JWT presented as a
 * Bearer credential is a SESSION caller: the bundled SPA's main process
 * holds the Supabase session and attaches the JWT to API calls. Pins:
 * session semantics (no agentTokenId, no scope gate, sessionOnly admits),
 * exact-prefix routing (dopl_at_ still goes to the OAuth branch), and
 * fail-closed 401 with no cookie fallthrough.
 */
describe("bearer Supabase JWT (desktop SPA)", () => {
  it("valid JWT reaches the handler with session semantics", async () => {
    state.jwtUser = { id: "user-jwt" };
    const handler = handlerSpy();
    const res = await withUserAuth(handler)(jwtReq("GET"));
    expect(res.status).toBe(200);
    const ctx = handler.mock.calls[0][1];
    expect(ctx.userId).toBe("user-jwt");
    expect(ctx.agentTokenId).toBeUndefined(); // NOT an agent
    // The JWT itself was what got verified.
    expect(state.calls_jwtGetClaims).toEqual([ES256_JWT]);
  });

  it("passes writes without any dopl.write scope (sessions are not scope-gated)", async () => {
    state.jwtUser = { id: "user-jwt" };
    for (const method of WRITE_METHODS) {
      const handler = handlerSpy();
      const res = await withUserAuth(handler)(jwtReq(method));
      expect(res.status).toBe(200);
    }
  });

  it("is admitted by sessionOnly routes (unlike every OAuth token)", async () => {
    state.jwtUser = { id: "user-jwt" };
    const handler = handlerSpy();
    const res = await withUserAuth(handler, { sessionOnly: true })(jwtReq("POST"));
    expect(res.status).toBe(200);
  });

  it("invalid/expired JWT is 401 and never falls through to cookies", async () => {
    state.jwtUser = null; // getClaims throws (expired)
    state.sessionUser = { id: "cookie-user" }; // a valid cookie session exists…
    const handler = handlerSpy();
    const res = await withUserAuth(handler)(jwtReq("GET"));
    expect(res.status).toBe(401); // …but a presented bearer must stand alone
    expect(handler).not.toHaveBeenCalled();
    expect(state.calls.getClaims).toBe(0); // cookie path untouched
  });

  it("non-ES256 / kid-less bearers are 401 WITHOUT consulting the verifier (no GoTrue amplifier)", async () => {
    state.jwtUser = { id: "user-jwt" }; // verifier would accept if reached
    const bad = [
      // HS256 (legacy alg — auth-js would fall back to network getUser)
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url") + ".p.s",
      // ES256 but no kid (same network fallback)
      Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url") + ".p.s",
      "not-a-jwt",
      "", // empty bearer
    ];
    for (const token of bad) {
      const handler = handlerSpy();
      const res = await withUserAuth(handler)(
        new NextRequest("http://localhost/api/x", {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
        })
      );
      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    }
    expect(state.calls_jwtGetClaims).toEqual([]); // verifier NEVER consulted
  });

  it("dopl_at_-prefixed bearers still route to the OAuth branch", async () => {
    state.jwtUser = { id: "user-jwt" }; // would succeed if misrouted
    state.token = null; // OAuth validation fails
    const handler = handlerSpy();
    const res = await withUserAuth(handler)(bearerReq("GET"));
    expect(res.status).toBe(401);
    expect(state.calls_jwtGetClaims).toEqual([]); // JWT verifier never consulted
  });
});
