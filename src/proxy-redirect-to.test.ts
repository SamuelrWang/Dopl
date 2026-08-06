/**
 * `?redirectTo=` THROUGH THE MIDDLEWARE — both halves of the round trip.
 *
 * Two bugs, both verified against production behaviour, both invisible until
 * the billing page made them cost money:
 *
 *   1. THE BOUNCE DROPPED THE QUERY. `url.searchParams.set("redirectTo", pathname)`
 *      — pathname only. A signed-out visit to
 *      `/billing/{segment}?billing=upgrade` came back from `/login` as a bare
 *      `/billing/{segment}`, so the checkout the URL asked for never opened.
 *      The population this hits is FIRST-TIME PAYERS: their browser has by
 *      definition never signed in.
 *
 *   2. AN ALREADY-SIGNED-IN VISITOR'S `redirectTo` WAS IGNORED.
 *      `/login?redirectTo=%2Finvite%2Ftok_x` with a live session 307'd to
 *      `/canvas` with the param left on the URL as decoration — the invite was
 *      never reached, and post-repoint neither was the billing page.
 *
 * The suite drives the REAL `proxy()`. Where a hop depends on what the login
 * form does with the value it was handed, it calls the REAL validator
 * (`explicitPostAuthTarget`) rather than restating it — the seam is the thing
 * under test, and a copy of the rule here would agree with itself forever.
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
        return { data: { user: null }, error: null };
      },
    },
  }),
}));

import { proxy } from "./proxy";
import { explicitPostAuthTarget } from "./shared/lib/url/post-auth-landing";

const ORIGIN = "https://app.usedopl.com";
const SEGMENT = "acme-ab12cd34ef56";
const BILLING = `/billing/${SEGMENT}`;

function req(path: string, cookie?: string) {
  return new NextRequest(
    new URL(path, ORIGIN),
    cookie ? { headers: { cookie } } : undefined
  );
}

function signedIn() {
  state.claims = { sub: "user-1" };
}

/** The `Location` of a proxy response, origin stripped. */
async function location(path: string, cookie?: string): Promise<string | null> {
  const res = await proxy(req(path, cookie));
  const raw = res.headers.get("location");
  return raw ? raw.slice(ORIGIN.length) : null;
}

/** The `redirectTo` value the bounce handed to `/login`. */
async function bouncedTarget(path: string): Promise<string | null> {
  const loc = await location(path);
  if (!loc) return null;
  return new URL(loc, ORIGIN).searchParams.get("redirectTo");
}

beforeEach(() => {
  state.claims = null;
  state.rotated = [];
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});

// ── 1. The signed-out bounce keeps the query ─────────────────────────────────

describe("the signed-out bounce", () => {
  it("still names a plain page exactly as before", async () => {
    expect(await location("/knowledge/abc")).toBe(
      "/login?redirectTo=%2Fknowledge%2Fabc"
    );
  });

  it("CARRIES THE QUERY — the billing page's whole reason for existing", async () => {
    expect(await bouncedTarget(`${BILLING}?billing=upgrade`)).toBe(
      `${BILLING}?billing=upgrade`
    );
    expect(await bouncedTarget(`${BILLING}?billing=upgrade&plan=solo`)).toBe(
      `${BILLING}?billing=upgrade&plan=solo`
    );
  });

  it("carries it for every other query-bearing deep link too", async () => {
    expect(await bouncedTarget("/myws/channels?thread=t_1")).toBe(
      "/myws/channels?thread=t_1"
    );
  });

  it("carries the Stripe return query even on the default landing", async () => {
    // A checkout return landing in a signed-out tab: `/canvas?billing=success`
    // has a query, so it is a real destination, not "the default landing".
    expect(await bouncedTarget("/canvas?billing=success&session_id=cs_1")).toBe(
      "/canvas?billing=success&session_id=cs_1"
    );
  });

  it("still adds NO redirectTo for the bare default landing", async () => {
    expect(await location("/canvas")).toBe("/login");
  });

  it("puts exactly one thing on the login URL", async () => {
    // The requested page's query lives inside `redirectTo`; a second copy on
    // /login would be a second, ignored source of truth.
    const loc = await location(`${BILLING}?billing=upgrade`);
    const params = new URL(loc!, ORIGIN).searchParams;
    expect([...params.keys()]).toEqual(["redirectTo"]);
  });

  it("API routes still 401 rather than bounce", async () => {
    const res = await proxy(req("/api/workspaces/me?x=1"));
    expect(res.status).toBe(401);
  });

  it("keeps the session-clearing cookies on the bounce", async () => {
    // A REFUSED refresh clears the session through the storage adapter, and
    // that clearing must reach the browser or every later request retries the
    // same doomed refresh.
    state.rotated = [
      { name: "sb-proj-auth-token.0", value: "", options: { path: "/", maxAge: 0 } },
    ];
    const res = await proxy(req(`${BILLING}?billing=upgrade`));
    expect(res.cookies.get("sb-proj-auth-token.0")?.value).toBe("");
  });
});

// ── 2. The signed-in visitor's redirectTo is honoured ────────────────────────

describe("a signed-in visitor to /login", () => {
  beforeEach(signedIn);

  // The default destination is `/get-started` while WEBSITE_RETIRED is on —
  // `/canvas` is retired, so the default landing names the surviving page
  // directly instead of hopping through a 302. Both states, and why the hop
  // could not be left in place, are in proxy-retirement.test.ts.
  it("still lands on the default destination when the URL asked for nothing", async () => {
    expect(await location("/login")).toBe("/get-started");
  });

  it("reaches the invite it was sent to, instead of /canvas", async () => {
    expect(await location("/login?redirectTo=%2Finvite%2Ftok_x")).toBe(
      "/invite/tok_x"
    );
  });

  it.each([
    ["a join link", "/join/tok_x"],
    ["the OAuth consent screen", "/oauth/authorize?client_id=a&state=b"],
    ["a workspace page", "/myws/channels"],
    ["the password reset", "/auth/reset-password"],
  ])("reaches %s", async (_label, target) => {
    expect(
      await location(`/login?redirectTo=${encodeURIComponent(target)}`)
    ).toBe(target);
  });

  it("reaches the billing page WITH its query", async () => {
    const target = `${BILLING}?billing=upgrade&plan=team`;
    expect(
      await location(`/login?redirectTo=${encodeURIComponent(target)}`)
    ).toBe(target);
  });

  it("does not carry the consumed redirectTo on to the destination", async () => {
    const loc = await location("/login?redirectTo=%2Finvite%2Ftok_x");
    expect(loc).not.toContain("redirectTo");
  });

  it("leaves the landing page's bounce alone", async () => {
    // `?redirectTo=` on `/` has no producer and no meaning, so only /login opts
    // in — and `/`'s query (utm and friends) rides along exactly as it did
    // before, untouched by this change.
    const loc = await location("/?redirectTo=%2Finvite%2Ftok_x");
    expect(new URL(loc!, ORIGIN).pathname).toBe("/get-started");
    expect(loc).toBe("/get-started?redirectTo=%2Finvite%2Ftok_x");
  });
});

describe("a HOSTILE redirectTo is not a destination", () => {
  beforeEach(signedIn);

  it.each([
    ["an absolute URL", "https://evil.example/x"],
    ["a protocol-relative URL", "//evil.example/x"],
    ["the backslash variant browsers mis-parse", "/\\evil.example"],
    ["a bare word", "canvas"],
    ["a scheme", "javascript:alert(1)"],
    ["an empty value", ""],
  ])("%s falls through to the default and never leaves the origin", async (_l, raw) => {
    const res = await proxy(req(`/login?redirectTo=${encodeURIComponent(raw)}`));
    const loc = res.headers.get("location")!;
    expect(loc).toBe(`${ORIGIN}/get-started`);
    expect(loc.startsWith(ORIGIN)).toBe(true);
    // …and the rejected value does not ride along to be re-read downstream.
    expect(loc).not.toContain("evil.example");
    expect(loc).not.toContain("redirectTo");
  });

  it("uses the same validator the login form and /auth/callback use", async () => {
    // Not a restatement of the rule — the actual decision module. If those ever
    // diverge, a value could be honoured by one layer and rejected by the next.
    for (const raw of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      expect(explicitPostAuthTarget(raw)).toBeNull();
      expect(await location(`/login?redirectTo=${encodeURIComponent(raw)}`)).toBe(
        "/get-started"
      );
    }
    for (const raw of ["/invite/tok_x", `${BILLING}?billing=upgrade`]) {
      expect(explicitPostAuthTarget(raw)).toBe(raw);
      expect(await location(`/login?redirectTo=${encodeURIComponent(raw)}`)).toBe(
        raw
      );
    }
  });
});

// ── 3. End to end: ?billing=upgrade survives a signed-out first-time payer ───

describe("?billing=upgrade end to end", () => {
  it("survives the whole signed-out round trip", async () => {
    const entry = `${BILLING}?billing=upgrade&plan=solo`;

    // 1. Signed out: the middleware bounces, carrying the query.
    const bounce = await location(entry);
    expect(bounce).toBe(`/login?redirectTo=${encodeURIComponent(entry)}`);

    // 2. The login form reads and validates that value (the real module).
    const handed = new URL(bounce!, ORIGIN).searchParams.get("redirectTo");
    expect(explicitPostAuthTarget(handed)).toBe(entry);

    // 3. And if the session turns out to already exist — the returning-user
    //    case, and the one that used to dead-end on /canvas — the middleware
    //    sends them to the same place rather than swallowing it.
    signedIn();
    expect(await location(bounce!)).toBe(entry);
  });
});

// ── 4. Flows that must NOT have moved ────────────────────────────────────────

describe("the desktop and OAuth flows are untouched", () => {
  it.each([
    "/auth/desktop-start?provider=github&state=n1",
    "/auth/desktop-handoff?state=n1",
    "/auth/callback?code=abc&desktop=1&state=n1",
    "/oauth/authorize?client_id=x&state=y",
    "/invite/SomeSignedToken",
    "/terms",
    "/privacy",
    "/pricing",
  ])("%s passes through signed out, untouched", async (path) => {
    const res = await proxy(req(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each([
    "/auth/desktop-start?provider=google&state=n1",
    "/auth/callback?code=abc&desktop=1&state=n1",
  ])("%s passes through signed IN too", async (path) => {
    signedIn();
    const res = await proxy(req(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("the join link now RENDERS for a signed-out visitor (GAP-6)", async () => {
    // `/join/` joined PUBLIC_ROUTES with the retirement work. Those URLs are
    // copied to clipboards by the live app, so the visitor has no account by
    // definition, and the card's own `needsAuth` branch — which names the
    // workspace and the inviter before asking anyone to sign in — was dead in
    // production while the middleware bounced first. The bounce it offers is
    // the same round trip, now made by the page instead of the gate.
    const res = await proxy(req("/join/tok_x"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

// ── 5. The Q4 loop breaker still terminates — now for ANY destination ────────

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

  apply(response: {
    cookies: { getAll(): { name: string; value: string; maxAge?: number }[] };
  }) {
    for (const c of response.cookies.getAll()) {
      if (c.value === "" || c.maxAge === 0) this.jar.delete(c.name);
      else this.jar.set(c.name, c.value);
    }
  }

  has(name: string) {
    return this.jar.has(name);
  }
}

/**
 * Walk the cycle during a GoTrue degradation: the middleware reads the claims
 * as valid, every page's own `getUser()` says signed out. `pageBounce` is what
 * the rendered page does — the billing page and `/get-started` both bounce back
 * to `/login` NAMING THEMSELVES, which is the shape that turns an honoured
 * `redirectTo` into a hard loop unless the breaker knows its own midpoint.
 */
async function walk(
  start: string,
  pageBounce: (path: string) => string,
  maxHops = 14
) {
  const jar = new Jar();
  const trace: string[] = [];
  let path = start;

  for (let hop = 0; hop < maxHops; hop++) {
    const res = await proxy(jar.request(path));
    jar.apply(res);
    const loc = res.headers.get("location");
    if (loc) {
      const next = new URL(loc);
      trace.push(`307 ${path} → ${next.pathname}${next.search}`);
      path = `${next.pathname}${next.search}`;
      continue;
    }
    if (path.startsWith("/login")) {
      trace.push(`200 ${path}`);
      return { trace, terminatedAt: path, jar };
    }
    trace.push(`200 ${path} → (server component) bounce`);
    path = pageBounce(path);
  }
  return { trace, terminatedAt: null, jar };
}

describe("the redirect-loop breaker survives an honoured redirectTo", () => {
  beforeEach(signedIn);

  it("terminates when the destination bounces back naming ITSELF", async () => {
    // The regression this guards: the breaker's counter is disarmed by a
    // healthy authenticated page view, and before the cookie remembered its
    // destination, arriving at the honoured target disarmed it on every lap —
    // so `/login?redirectTo=X → X → /login?redirectTo=X` never ended.
    const entry = `/login?redirectTo=${encodeURIComponent(BILLING)}`;
    const { trace, terminatedAt } = await walk(
      entry,
      () => entry
    );
    expect(terminatedAt, `did not terminate:\n${trace.join("\n")}`).not.toBeNull();
    expect(trace.length).toBeLessThanOrEqual(8);
  });

  it("terminates for the classic /canvas cycle exactly as before", async () => {
    const { trace, terminatedAt } = await walk("/canvas", () => "/login");
    expect(terminatedAt, `did not terminate:\n${trace.join("\n")}`).toBe("/login");
    expect(trace.length).toBeLessThanOrEqual(7);
  });

  it("still disarms on a healthy page that is NOT the bounce destination", async () => {
    const jar = new Jar();
    jar.apply(
      await proxy(jar.request(`/login?redirectTo=${encodeURIComponent(BILLING)}`))
    );
    expect(jar.has("dopl-login-bounce")).toBe(true);

    jar.apply(await proxy(jar.request("/myws/knowledge")));
    expect(jar.has("dopl-login-bounce")).toBe(false);
  });

  it("does NOT disarm on the honoured destination itself", async () => {
    const jar = new Jar();
    jar.apply(
      await proxy(jar.request(`/login?redirectTo=${encodeURIComponent(BILLING)}`))
    );
    jar.apply(await proxy(jar.request(BILLING)));
    expect(jar.has("dopl-login-bounce")).toBe(true);
  });

  it("reads a legacy bare-count cookie as the /canvas midpoint", async () => {
    // Cookies written before this deploy carry no destination. They must keep
    // meaning what they meant, or a browser mid-loop across the deploy loses
    // its breaker.
    const jar = new Jar();
    const armed = "dopl-login-bounce=1";
    const res = await proxy(req("/canvas", armed));
    jar.apply(res);
    expect(res.cookies.get("dopl-login-bounce")).toBeUndefined();
  });
});

describe("rotated session cookies survive the honoured bounce", () => {
  it("keeps the refreshed cookie on a redirectTo redirect", async () => {
    signedIn();
    state.rotated = [
      { name: "sb-proj-auth-token.0", value: "rotated-0", options: { path: "/" } },
    ];
    const res = await proxy(req(`/login?redirectTo=${encodeURIComponent(BILLING)}`));
    expect(res.headers.get("location")).toBe(`${ORIGIN}${BILLING}`);
    expect(res.cookies.get("sb-proj-auth-token.0")?.value).toBe("rotated-0");
  });
});
