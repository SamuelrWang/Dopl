/**
 * Q12 — proxy (middleware) route matrix + the request-volume pin.
 *
 * `src/proxy.ts` runs on EVERY matched request (~200k/day). Until 2026-07-31 it
 * called `supabase.auth.getUser()` there — a network round-trip to GoTrue costing
 * ~5 Postgres queries per page view — which is what let a normal traffic bump
 * amplify into the 1,500 auth-requests/min self-DDoS that starved GoTrue.
 *
 * It now calls `getClaims()`, which verifies the ES256 access token locally (see
 * `proxy-claims.test.ts` for the signature-verification proof against the REAL
 * auth-js client). This suite pins the two things that swap could have broken:
 *
 *   1. THE ROUTE MATRIX IS UNCHANGED — which paths redirect, which 401, which
 *      pass through, for every session state. proxy.ts is load-bearing (OAuth +
 *      MCP + the desktop sign-in bridge all route through it).
 *   2. THE HOT PATH MAKES ZERO NETWORK CALLS — `getUser` is never reached and
 *      `fetch` is never called when the token is valid. This is the regression
 *      that would silently re-create the incident.
 *   3. THE REFRESH PATH STILL REFRESHES — a near-expiry session still rotates its
 *      cookies onto the response, or every session would die after ~1h.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Cookie = { name: string; value: string; options?: Record<string, unknown> };

const state = vi.hoisted(() => ({
  /** Claims the fake GoTrue client resolves (null = no session). */
  claims: null as { sub: string } | null,
  /** When set, `getClaims()` resolves `{ data: null, error }` (verification failed). */
  claimsError: null as Error | null,
  /** When set, `getClaims()` throws instead of resolving. */
  claimsThrows: false,
  /**
   * Cookies the near-expiry refresh writes back through the storage adapter.
   * Empty = hot path (no refresh, no network).
   */
  rotated: [] as Cookie[],
  calls: { getClaims: 0, getUser: 0, network: 0 },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { getAll: () => Cookie[]; setAll: (c: Cookie[]) => void } }
  ) => ({
    auth: {
      /**
       * Mirrors the real `getClaims()` shape: it internally runs `getSession()`,
       * which rotates cookies through the storage adapter (`setAll`) — and ONLY
       * then does a network call — when the access token is near/at expiry.
       */
      async getClaims() {
        state.calls.getClaims++;
        if (state.rotated.length > 0) {
          state.calls.network++; // POST token?grant_type=refresh_token
          opts.cookies.setAll(state.rotated);
        }
        // Real path, not hypothetical: auth-js `validateExp` throws a PLAIN
        // Error, which `getClaims()` re-throws (it only converts AuthErrors).
        // See proxy-claims.test.ts — unwrapped this is a 500 on every page.
        if (state.claimsThrows) throw new Error("JWT has expired");
        if (state.claimsError) return { data: null, error: state.claimsError };
        return {
          data: state.claims
            ? {
                claims: state.claims,
                header: { alg: "ES256", typ: "JWT", kid: "kid-1" },
                signature: new Uint8Array(64),
              }
            : null,
          error: null,
        };
      },
      /** The network path. Reaching this at all is the regression. */
      async getUser() {
        state.calls.getUser++;
        state.calls.network++;
        return { data: { user: null }, error: null };
      },
    },
  }),
}));

// THE MATCHER ITSELF IS `proxy-matcher.test.ts` (split out under P0-4, 2026-08-07).
// This file proves what the function DOES once it runs; that one proves which requests
// make it run at all. Both matter and neither implies the other — a route can be
// answered correctly here and never reach this code in production.
import { proxy } from "./proxy";

const ORIGIN = "https://app.usedopl.com";

function req(path: string, init?: { headers?: Record<string, string> }) {
  return new NextRequest(new URL(path, ORIGIN), { headers: init?.headers });
}

/** Signed in with a valid, not-near-expiry token: the hot path. */
function signedIn() {
  state.claims = { sub: "user-1" };
  state.claimsError = null;
  state.claimsThrows = false;
  state.rotated = [];
}
function signedOut() {
  state.claims = null;
  state.claimsError = null;
  state.claimsThrows = false;
  state.rotated = [];
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  signedOut();
  state.calls = { getClaims: 0, getUser: 0, network: 0 };
  fetchSpy = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchSpy);
});

// ── 1. The zero-network guarantee (the whole point of Q12) ───────────────────

describe("hot path makes zero network calls", () => {
  const paths = [
    "/canvas", // authed page
    "/pricing", // public page — see the matcher note in section 6
    "/api/workspaces/me", // api route
    "/login",
    "/",
    "/get-started", // KEEP page, signed-in only
  ];

  it.each(paths)("valid token on %s: no getUser, no fetch", async (path) => {
    signedIn();
    await proxy(req(path));
    expect(state.calls.getClaims).toBe(1);
    expect(state.calls.getUser).toBe(0);
    expect(state.calls.network).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(paths)("no session on %s: still no getUser, no fetch", async (path) => {
    signedOut();
    await proxy(req(path));
    expect(state.calls.getUser).toBe(0);
    expect(state.calls.network).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("100 consecutive authed page views cost 0 network calls", async () => {
    signedIn();
    for (let i = 0; i < 100; i++) await proxy(req("/canvas"));
    expect(state.calls.getClaims).toBe(100);
    expect(state.calls.network).toBe(0);
  });
});

// ── 2. The refresh path still refreshes ──────────────────────────────────────

describe("expired access token + valid refresh token", () => {
  beforeEach(() => {
    state.claims = { sub: "user-1" }; // refresh succeeded → fresh claims
    state.rotated = [
      { name: "sb-proj-auth-token.0", value: "rotated-0", options: { path: "/" } },
      { name: "sb-proj-auth-token.1", value: "rotated-1", options: { path: "/" } },
    ];
  });

  it("rotates the cookies onto the response (sessions survive past ~1h)", async () => {
    // `/get-started` rather than `/canvas`: the assertion is that a normal
    // authed page view keeps its rotated cookies AND is not redirected, and
    // `/canvas` is retired now (proxy-retirement.test.ts), so it always carries
    // a Location. The rotated-cookie half of that page is covered there too.
    const res = await proxy(req("/get-started"));
    expect(state.calls.network).toBe(1); // the ONE legitimate network call
    const set = res.cookies.getAll().map((c) => `${c.name}=${c.value}`);
    expect(set).toContain("sb-proj-auth-token.0=rotated-0");
    expect(set).toContain("sb-proj-auth-token.1=rotated-1");
    expect(res.headers.get("location")).toBeNull(); // and the user stays authed
  });

  it("still bounces / into the app after a refresh (claims are the fresh ones)", async () => {
    const res = await proxy(req("/"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/get-started`);
  });

  it("a FAILED refresh (bad refresh token) falls back to the login bounce", async () => {
    state.claims = null;
    state.claimsError = new Error("Invalid Refresh Token");
    const res = await proxy(req("/knowledge/abc"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `${ORIGIN}/login?redirectTo=%2Fknowledge%2Fabc`
    );
  });
});

// ── 3. Route matrix × session state ──────────────────────────────────────────

describe("pages", () => {
  it("authed page + no session → 307 to /login with redirectTo", async () => {
    const res = await proxy(req("/knowledge/abc"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `${ORIGIN}/login?redirectTo=%2Fknowledge%2Fabc`
    );
  });

  it("authed page + valid token → passes through", async () => {
    signedIn();
    const res = await proxy(req("/knowledge/abc"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("/canvas gets NO redirectTo param (it is the default landing)", async () => {
    const res = await proxy(req("/canvas"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login`);
  });

  // The signed-in destination is `/get-started`, not `/canvas`, while
  // WEBSITE_RETIRED is on — `/canvas` is retired, and pointing the default
  // landing at a retired page costs a hop AND defeats the Q4 breaker's midpoint
  // memory. Both states are proven in proxy-retirement.test.ts.
  it("landing page is public when signed out, bounces in when signed in", async () => {
    expect((await proxy(req("/"))).status).toBe(200);
    signedIn();
    const res = await proxy(req("/"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/get-started`);
  });

  it("/login is public when signed out, bounces in when signed in", async () => {
    expect((await proxy(req("/login"))).status).toBe(200);
    signedIn();
    expect((await proxy(req("/login"))).headers.get("location")).toBe(
      `${ORIGIN}/get-started`
    );
  });

  it.each([
    "/auth/callback?code=abc",
    "/auth/desktop-start",
    "/auth/desktop-handoff",
    "/terms",
    "/privacy",
    "/pricing",
    "/invite/SomeSignedToken",
    "/oauth/authorize?client_id=x",
    "/.well-known/oauth-authorization-server",
  ])("public route %s passes through with no session", async (path) => {
    const res = await proxy(req(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  // THE BEHAVIOUR HALF OF THE P0-4 MATCHER ARGUMENT (2026-08-07). `pricing|privacy|terms`
  // were added to the matcher's negative lookahead as UNANCHORED prefixes, so they also
  // exclude `/pricing/enterprise`, `/termsfoo` and friends. That is safe by construction
  // rather than by luck — `PUBLIC_ROUTES` matches with `pathname.startsWith`, so those
  // paths were ALREADY getting an unconditional passthrough — and this is the proof of
  // the premise rather than the assertion of it. If a real gated route is ever added
  // under one of those prefixes, this fails before the matcher can silently exempt it.
  it.each(["/pricing/enterprise", "/termsfoo", "/privacy-policy"])(
    "%s is an unconditional passthrough in BOTH session states",
    async (path) => {
      expect((await proxy(req(path))).status).toBe(200);
      expect((await proxy(req(path))).headers.get("location")).toBeNull();
      signedIn();
      expect((await proxy(req(path))).status).toBe(200);
      expect((await proxy(req(path))).headers.get("location")).toBeNull();
    }
  );

  // THE OG PASSTHROUGH IS GONE (P0-4, 2026-08-07) and this asserts the replacement
  // rather than deleting the coverage. The branch existed for convention-based
  // `opengraph-image.tsx` / `twitter-image.tsx` route files under `/community/[slug]/`;
  // `/community` was deleted, then the whole `[workspaceSlug]` tree in Stage D, and no
  // such file has existed in `src/app/` since. What a crawler actually fetches is the
  // STATIC card the root layout names, and the guarantee it needs — reachable with no
  // session — is now structural instead of branch-shaped: the matcher excludes it by
  // extension, so the middleware never runs and there is no code path that could bounce
  // it. Proven in section 6 against the real exported matcher.
  it("a signed-out request to a would-be OG route is no longer special-cased", async () => {
    // Nothing serves this path any more, so the honest answer is the ordinary
    // signed-out one. Kept as a test so the dead branch cannot be reintroduced
    // by someone reading a stale comment.
    const res = await proxy(req("/community/x/opengraph-image"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `${ORIGIN}/login?redirectTo=%2Fcommunity%2Fx%2Fopengraph-image`
    );
  });
});

describe("api routes", () => {
  it("no session → 401 JSON, not a redirect", async () => {
    const res = await proxy(req("/api/workspaces/me"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });

  it("valid session → passes through", async () => {
    signedIn();
    const res = await proxy(req("/api/workspaces/me"));
    expect(res.status).toBe(200);
  });

  it("a dopl_at_ bearer passes through un-gated (route wrapper validates it)", async () => {
    const res = await proxy(
      req("/api/channels/x/messages", {
        headers: { authorization: "Bearer dopl_at_abc123" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("a cookie-less Supabase-JWT bearer passes through un-gated (desktop SPA)", async () => {
    // Desktop migration Phase 2: the SPA's calls carry a Supabase access
    // JWT and NO cookies. The middleware must not pre-judge bearer kinds —
    // withUserAuth (ES256+kid pre-check, local JWKS verify) is the single
    // fail-closed authority. The old includes("dopl_at_") gate 401'd these
    // before the wrapper ever ran.
    const res = await proxy(
      req("/api/workspaces/me", {
        headers: { authorization: "Bearer eyJhbGciOiJFUzI1NiJ9.claims.sig" },
      })
    );
    expect(res.status).toBe(200);
  });

  it.each([
    "/api/mcp",
    "/api/oauth/token",
    "/api/billing/webhook",
    "/api/cron/purge",
    "/api/workspaces/invitations/abc",
  ])("self-authenticating route %s bypasses the session gate", async (path) => {
    const res = await proxy(req(path));
    expect(res.status).toBe(200);
  });

  it("/api/version answers a SIGNED-OUT caller, or the desktop gate is inert", async () => {
    // The minimum-version floor is pulled by builds that may be too old to
    // complete a sign-in at all, and the client reads any non-2xx as "no
    // answer" and fails open. A 401 here is therefore not a small bug: it is
    // the whole forced-upgrade gate silently never blocking anybody. It shipped
    // that way and was caught by a live `version gate: floor fetch 401`.
    const res = await proxy(req("/api/version"));
    expect(res.status).toBe(200);
  });

  it("…and does not spend the claims read to do it", async () => {
    // Every desktop asks at launch. Reading claims for a route whose answer no
    // caller can change is pure cost on the JWKS path (see SELF_AUTH_ROUTES).
    signedIn();
    await proxy(req("/api/version"));
    expect(state.calls.getClaims).toBe(0);
    expect(state.calls.network).toBe(0);
  });
});

// ── 4. The S-8 lowercase redirect (must still precede the auth outcome) ──────

describe("mixed-case canonicalization (audit fix S-8)", () => {
  it("308s a mixed-case page path to lowercase", async () => {
    signedIn();
    const res = await proxy(req("/Default/Knowledge"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/default/knowledge`);
  });

  it("308s even with no session (canonicalization is not auth-dependent)", async () => {
    const res = await proxy(req("/Default/Knowledge"));
    expect(res.status).toBe(308);
  });

  it.each([
    "/api/Channels/ABC",
    "/_next/Static/chunk.js",
    "/invite/SignedTokenABC",
    "/auth/callback?code=AbC",
  ])("does NOT rewrite case-sensitive path %s", async (path) => {
    const res = await proxy(req(path));
    expect(res.status).not.toBe(308);
  });

  // The `/opengraph-image` and `/twitter-image` skips were removed with the branch
  // they guarded (P0-4) — there are no such route files left to protect from
  // canonicalization, so a mixed-case path ending that way is now just a mixed-case
  // path. It 308s like any other and then 404s, which is what it did before too.
  it("a mixed-case would-be OG path canonicalizes like anything else now", async () => {
    const res = await proxy(req("/Community/x/opengraph-image"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      `${ORIGIN}/community/x/opengraph-image`
    );
  });
});

// ── 5. Verification crash is fail-closed, never a 500 ────────────────────────

describe("a thrown verification error is fail-closed, never a 500", () => {
  beforeEach(() => {
    state.claimsThrows = true;
  });

  it("page → login bounce", async () => {
    const res = await proxy(req("/canvas"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login`);
  });

  it("api → 401, not an unhandled middleware exception", async () => {
    const res = await proxy(req("/api/workspaces/me"));
    expect(res.status).toBe(401);
  });

  it("public routes still serve (a bad cookie can't take down /login or /pricing)", async () => {
    expect((await proxy(req("/login"))).status).toBe(200);
    expect((await proxy(req("/pricing"))).status).toBe(200);
    expect((await proxy(req("/"))).status).toBe(200);
    expect((await proxy(req("/auth/callback?code=x"))).status).toBe(200);
  });
});
