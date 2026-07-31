/**
 * Q4 — THE REDIRECT-LOOP PROOF for the `/login → /canvas` bounce.
 *
 * The middleware decides who is signed in from LOCALLY verified claims; every
 * server component still asks GoTrue over the network. supabase-js does NOT
 * throw when that call fails — a GoTrue outage, a 503, or an account disabled
 * server-side all come back as `{ data: { user: null }, error }` — so the page's
 * `if (!user) redirect("/login")` fires while the middleware still reads the
 * request as authenticated, and the two layers hand the browser back and forth:
 *
 *     /login → 307 /canvas → (page) redirect /login → 307 /canvas → …
 *
 * ERR_TOO_MANY_REDIRECTS, no error page, during exactly the degradation the
 * local-claims swap exists to survive. Before that swap the operator simply
 * landed on the login screen.
 *
 * This suite drives the REAL `proxy()` inside a browser simulator — a cookie jar
 * plus the server component's `redirect("/login")` — and pins:
 *
 *   1. valid claims + `getUser()` returning null TERMINATES at the login screen,
 *      in a bounded number of hops;
 *   2. the healthy single bounce is unchanged (a signed-in visitor to /login
 *      still lands on /canvas);
 *   3. one normal authenticated page view disarms the breaker, so the next
 *      /login visit bounces again;
 *   4. `/canvas` — the cycle's own midpoint — must NOT disarm it, or the loop
 *      would never end.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Cookie = { name: string; value: string; options?: Record<string, unknown> };

const state = vi.hoisted(() => ({
  claims: null as { sub: string } | null,
  rotated: [] as Cookie[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { getAll: () => Cookie[]; setAll: (c: Cookie[]) => void } }
  ) => ({
    auth: {
      async getClaims() {
        if (state.rotated.length > 0) opts.cookies.setAll(state.rotated);
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
      async getUser() {
        // The server-component authority during the incident: NOT a throw.
        return { data: { user: null }, error: new Error("Auth session missing!") };
      },
    },
  }),
}));

import { proxy } from "./proxy";

const ORIGIN = "https://app.usedopl.com";

/** Minimal browser: holds cookies, applies Set-Cookie, sends them back. */
class Jar {
  private jar = new Map<string, string>();

  request(path: string): NextRequest {
    const cookie = [...this.jar]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    return new NextRequest(
      new URL(path, ORIGIN),
      cookie ? { headers: { cookie } } : undefined
    );
  }

  apply(response: { cookies: { getAll(): { name: string; value: string; maxAge?: number }[] } }) {
    for (const c of response.cookies.getAll()) {
      if (c.value === "" || c.maxAge === 0) this.jar.delete(c.name);
      else this.jar.set(c.name, c.value);
    }
  }

  has(name: string) {
    return this.jar.has(name);
  }
}

/** The signed-in-by-claims state: the middleware says yes, GoTrue says no. */
beforeEach(() => {
  state.claims = { sub: "user-1" };
  state.rotated = [];
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});

/**
 * Walks the real cycle. Every hop is a real `proxy()` call; when the middleware
 * lets an app page through, we do what the server component does during the
 * incident — `redirect("/login")` — and follow it. Returns the hop trace.
 */
async function walk(start: string, maxHops = 12) {
  const jar = new Jar();
  const trace: string[] = [];
  let path = start;

  for (let hop = 0; hop < maxHops; hop++) {
    const res = await proxy(jar.request(path));
    jar.apply(res);
    const location = res.headers.get("location");

    if (location) {
      trace.push(`307 ${path} → ${new URL(location).pathname}`);
      path = new URL(location).pathname;
      continue;
    }

    if (path === "/login") {
      // The login screen rendered: the cycle is broken.
      trace.push(`200 ${path}`);
      return { trace, terminatedAt: path, jar };
    }

    // An authed page rendered — and its `getUser()` says signed out, so it
    // redirects to /login. This is the half the middleware cannot see.
    trace.push(`200 ${path} → (server component) redirect /login`);
    path = "/login";
  }

  return { trace, terminatedAt: null, jar };
}

describe("valid claims + getUser() null terminates instead of looping", () => {
  it("entering at /canvas ends on the login screen, not ERR_TOO_MANY_REDIRECTS", async () => {
    const { trace, terminatedAt } = await walk("/canvas");
    // Without the breaker this walk never terminates; the real trace is
    //   200 /canvas → redirect /login | 307 /login → /canvas | …×2 | 200 /login
    expect(terminatedAt, `did not terminate:\n${trace.join("\n")}`).toBe("/login");
    // Bounded: 2 bounces max, so the whole cycle is a handful of hops.
    expect(trace.length).toBeLessThanOrEqual(7);
  });

  it("entering at a workspace page terminates too", async () => {
    const { terminatedAt, trace } = await walk("/myws/channels");
    expect(terminatedAt, `did not terminate:\n${trace.join("\n")}`).toBe("/login");
  });

  it("entering at /login terminates too", async () => {
    const { terminatedAt, trace } = await walk("/login");
    expect(terminatedAt, `did not terminate:\n${trace.join("\n")}`).toBe("/login");
  });

  it("the breaker clears its own counter once it fires", async () => {
    const { jar } = await walk("/canvas");
    expect(jar.has("dopl-login-bounce")).toBe(false);
  });
});

describe("the healthy bounce is unchanged", () => {
  it("first /login visit still lands on /canvas", async () => {
    const jar = new Jar();
    const res = await proxy(jar.request("/login"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/canvas`);
  });

  it("a normal authed page view disarms the counter — the next /login bounces", async () => {
    const jar = new Jar();
    // one bounce, counter armed
    jar.apply(await proxy(jar.request("/login")));
    expect(jar.has("dopl-login-bounce")).toBe(true);

    // a real page renders fine (no server-component redirect): disarm
    jar.apply(await proxy(jar.request("/myws/knowledge")));
    expect(jar.has("dopl-login-bounce")).toBe(false);

    // …so /login still bounces rather than serving the login screen
    const res = await proxy(jar.request("/login"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/canvas`);
  });

  it("/canvas does NOT disarm the counter (it is the cycle's midpoint)", async () => {
    const jar = new Jar();
    jar.apply(await proxy(jar.request("/login")));
    jar.apply(await proxy(jar.request("/canvas")));
    expect(jar.has("dopl-login-bounce")).toBe(true);
  });

  it("an /api/* poll in another tab does NOT disarm the counter", async () => {
    const jar = new Jar();
    jar.apply(await proxy(jar.request("/login")));
    jar.apply(await proxy(jar.request("/api/channels/consent")));
    expect(jar.has("dopl-login-bounce")).toBe(true);
  });

  it("a signed-out visitor to /login is untouched (no counter, no bounce)", async () => {
    state.claims = null;
    const jar = new Jar();
    const res = await proxy(jar.request("/login"));
    expect(res.status).toBe(200);
    jar.apply(res);
    expect(jar.has("dopl-login-bounce")).toBe(false);
  });
});

describe("rotated session cookies survive every redirect", () => {
  beforeEach(() => {
    state.rotated = [
      { name: "sb-proj-auth-token.0", value: "rotated-0", options: { path: "/" } },
    ];
  });

  it.each([
    ["/login", "the /canvas bounce"],
    ["/Default/Knowledge", "the lowercase 308"],
  ])("%s keeps the refreshed cookie (%s)", async (path) => {
    const res = await proxy(new NextRequest(new URL(path, ORIGIN)));
    expect(res.headers.get("location")).toBeTruthy();
    expect(res.cookies.get("sb-proj-auth-token.0")?.value).toBe("rotated-0");
  });

  it("the signed-out /login redirect carries the session CLEARING through", async () => {
    // A refused refresh clears the session through the storage adapter; that
    // clearing has to reach the browser or the dead cookie survives forever.
    state.claims = null;
    state.rotated = [
      { name: "sb-proj-auth-token.0", value: "", options: { path: "/", maxAge: 0 } },
    ];
    const res = await proxy(new NextRequest(new URL("/myws/channels", ORIGIN)));
    expect(res.headers.get("location")).toBe(
      `${ORIGIN}/login?redirectTo=%2Fmyws%2Fchannels`
    );
    expect(res.cookies.get("sb-proj-auth-token.0")?.value).toBe("");
  });
});
