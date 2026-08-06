/**
 * WEBSITE RETIREMENT, STAGE B — the whole middleware matrix.
 * `docs/migration-research/website-retirement-plan.md` §2.
 *
 * Dopl's product UI ships in the desktop app; the web `[workspaceSlug]` tree is
 * the same product rendered twice. Stage B stops serving it behind one env flag,
 * DELETING NOTHING — every page is still in the tree and comes back the moment
 * the flag is off, which is why every assertion here is written for BOTH states.
 *
 * Three things this suite exists to prevent, in descending order of cost:
 *
 *   1. A LOST PAYMENT. `/{segment}/canvas?billing=…` is still produced by
 *      shipped desktop builds (≤ 1.8.5), by Stripe `return_url`s baked into
 *      sessions created before the repoint, and by bookmarks. Those must reach
 *      the billing page with their query intact, not a download page.
 *   2. A RETIRED REDIRECT CATCHING A KEEP ROUTE — the desktop OAuth chain, the
 *      SPA's data plane, `/api/version`'s min-version gate, the OAuth AS, the
 *      public pages. Each is enumerated and asserted with the flag ON.
 *   3. A REDIRECT LOOP. The Q4 breaker (`shared/auth/login-bounce.ts`) is only
 *      bounded while the cookie knows the bounce's midpoint; a retirement hop
 *      inserted between `/login` and its destination moves that midpoint, and
 *      the walks at the bottom are what proves it still terminates.
 *
 * This file covers the flag, the retired set, and the loop proofs. The other
 * two thirds of the matrix are next to it, split only because the 500-line cap
 * says so: `proxy-retirement-billing.test.ts` (the money URLs) and
 * `proxy-retirement-keep.test.ts` (everything that must NOT move, including the
 * desktop flows). All three drive the REAL `proxy()` and the REAL map, and
 * follow `proxy-redirect-to.test.ts`'s conventions throughout.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";

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
import {
  RETIREMENT_LANDING,
  WEBSITE_RETIRED_ENV,
  isWebsiteRetired,
  retirementRedirect,
} from "./shared/lib/url/website-retirement";

const ORIGIN = "https://app.usedopl.com";
const SEGMENT = "acme-ab12cd34ef56";
const LANDING = "/get-started";

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

/** The flag OFF — the rollback state, one env var away at any moment. */
function flagOff() {
  vi.stubEnv(WEBSITE_RETIRED_ENV, "0");
}

beforeEach(() => {
  state.claims = null;
  state.rotated = [];
  vi.unstubAllEnvs();
  // The default is RETIRED, and an ambient value in the shell must not decide
  // what "default" means here.
  vi.stubEnv(WEBSITE_RETIRED_ENV, undefined);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});

// ── 1. The flag itself ───────────────────────────────────────────────────────

describe("the WEBSITE_RETIRED flag", () => {
  it("is ON when the variable is absent — the on-state needs no env write", () => {
    // Samuel can only change this in the Vercel dashboard, so the state reached
    // by DELETING the variable has to be the safe one. A lost env var, a fresh
    // preview deployment or a restored project must not un-retire the website.
    expect(isWebsiteRetired({})).toBe(true);
  });

  it.each(["0", "false", "off", "OFF", " 0 "])(
    "is OFF for %o — the rollback lever, typed under pressure",
    (raw) => {
      expect(isWebsiteRetired({ [WEBSITE_RETIRED_ENV]: raw })).toBe(false);
    }
  );

  it.each(["1", "true", "on", "yes", "", "banana"])(
    "stays ON for %o — anything that is not a spelling of off",
    (raw) => {
      expect(isWebsiteRetired({ [WEBSITE_RETIRED_ENV]: raw })).toBe(true);
    }
  );

  it("is read per request, not captured at module load", async () => {
    signedIn();
    expect(await location("/canvas")).toBe(LANDING);
    flagOff();
    expect(await location("/canvas")).toBeNull();
    vi.unstubAllEnvs();
    expect(await location("/canvas")).toBe(LANDING);
  });

  it("lands everything on /get-started, which is also the post-auth landing", () => {
    // One page, two audiences, on purpose: both are being told the same thing.
    expect(RETIREMENT_LANDING).toBe(LANDING);
  });
});

// ── 2. The retired set ───────────────────────────────────────────────────────

/** Every page the flag retires. Route → `/get-started`, with no exceptions in
 *  this list; the money URLs are a separate shape and live in §3. */
const RETIRED = [
  "/canvas",
  "/onboarding",
  `/${SEGMENT}`,
  `/${SEGMENT}/canvas`,
  `/${SEGMENT}/canvas2`,
  `/${SEGMENT}/channels`,
  `/${SEGMENT}/chats`,
  `/${SEGMENT}/configuration`,
  `/${SEGMENT}/knowledge`,
  `/${SEGMENT}/knowledge/product-notes`,
  `/${SEGMENT}/members`,
  `/${SEGMENT}/ontology`,
  `/${SEGMENT}/ontology/customers`,
  `/${SEGMENT}/overview`,
  `/${SEGMENT}/settings`,
  `/${SEGMENT}/skills`,
  `/${SEGMENT}/skills/triage`,
  `/${SEGMENT}/workflows`,
  `/${SEGMENT}/workflows/onboard`,
];

describe("every retired route, signed IN", () => {
  beforeEach(signedIn);

  it.each(RETIRED)("%s → /get-started (302)", async (path) => {
    const res = await proxy(req(path));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}${LANDING}`);
  });

  it.each(RETIRED)("%s is untouched with the flag OFF", async (path) => {
    flagOff();
    const res = await proxy(req(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("drops the retired page's own query — it means nothing to a download page", async () => {
    expect(await location(`/${SEGMENT}/channels?thread=t_1`)).toBe(LANDING);
  });

  it("keeps the rotated session cookies on the way out", async () => {
    // A near-expiry refresh writes through the storage adapter; a bare
    // NextResponse.redirect would drop it and the next request would retry a
    // refresh token the server already consumed.
    state.rotated = [
      { name: "sb-proj-auth-token.0", value: "rotated-0", options: { path: "/" } },
    ];
    const res = await proxy(req(`/${SEGMENT}/canvas`));
    expect(res.headers.get("location")).toBe(`${ORIGIN}${LANDING}`);
    expect(res.cookies.get("sb-proj-auth-token.0")?.value).toBe("rotated-0");
  });
});

describe("every retired route, signed OUT", () => {
  it.each(RETIRED)("%s still bounces to /login naming ITSELF", async (path) => {
    // Unchanged from today, and load-bearing: the bounce has to name the page
    // that was asked for, not the retirement landing, or the round trip loses
    // the destination — including a first-time payer's `?billing=`.
    const expected =
      path === "/canvas" ? "/login" : `/login?redirectTo=${encodeURIComponent(path)}`;
    expect(await location(path)).toBe(expected);
  });

  it.each(RETIRED)("%s bounces identically with the flag OFF", async (path) => {
    flagOff();
    const expected =
      path === "/canvas" ? "/login" : `/login?redirectTo=${encodeURIComponent(path)}`;
    expect(await location(path)).toBe(expected);
  });
});

describe("the retired set matches the route tree on disk", () => {
  // ── STAGE D CHANGED WHAT THIS GUARDS, RATHER THAN ENDING IT ──────────────
  // Until the hard delete this test read the app tree off disk and asserted
  // the map named every page in it, because a page added without a map line
  // would quietly stay live after the flip. THE TREE IS GONE, so that failure
  // mode is gone with it — there is no longer any page that could stay live.
  //
  // What replaces it is the opposite assertion, and it is the one that matters
  // now: the tree must STAY deleted, and the map must go on answering for the
  // pages that used to be there. Bookmarks and shipped desktop builds still
  // arrive at these URLs; the map is what they land on instead of a 404, and
  // APP_PAGES is now a historical list that nothing on disk can confirm. A
  // resurrected directory would mean somebody reverted Stage D halfway.
  it("keeps the retired page tree deleted", () => {
    for (const dir of ["src/app/[workspaceSlug]", "src/app/canvas", "src/app/onboarding"]) {
      expect(
        existsSync(path.join(process.cwd(), dir)),
        `${dir} is back on disk — Stage D deleted it, and the SPA is the only host for these pages now`
      ).toBe(false);
    }
  });

  it("still retires every page name the app tree used to carry", () => {
    // Verbatim the set that lived under `(app)/` at the moment of deletion
    // (commit of Stage D). It is a HISTORICAL list on purpose: these are the
    // URLs in the wild, so the map must answer for them forever, and nothing
    // on disk can regenerate it.
    const historical = [
      "canvas",
      "canvas2",
      "channels",
      "chats",
      "configuration",
      "knowledge",
      "members",
      "ontology",
      "overview",
      "settings",
      "skills",
      "workflows",
    ];
    expect(historical.length).toBeGreaterThan(10);
    for (const page of historical) {
      expect(
        retirementRedirect(`/${SEGMENT}/${page}`, ""),
        `${page} was a real app URL and the retirement map no longer answers for it`
      ).toBe(LANDING);
    }
  });

  it("retires the bare workspace page and /onboarding too", () => {
    expect(retirementRedirect(`/${SEGMENT}`, "")).toBe(LANDING);
    expect(retirementRedirect("/onboarding", "")).toBe(LANDING);
    // ONE EXCEPTION, and it is the only place in this map where a generic
    // redirect reads the query: `/onboarding?redirectTo=<deep link>` carries
    // the link through instead of dropping it (F-136). Owned by
    // `src/first-run-deep-link.test.ts`, named here so this file's "the query
    // is dropped" rule is not read as absolute.
    expect(retirementRedirect("/onboarding", "?redirectTo=%2Fjoin%2Ftok_x")).toBe("/join/tok_x");
  });

  it("leaves a LEGACY slug-only workspace URL to the app, which retires it one hop later", () => {
    // `/acme` is indistinguishable from a top-level route that does not exist
    // yet, so the bare-segment rule requires the canonical `{slug}-{publicId}`
    // shape. The page itself redirects to `/{canonical}/canvas`, which IS
    // retired — so the destination is the same, one hop further along.
    expect(retirementRedirect("/acme", "")).toBeNull();
    expect(retirementRedirect("/acme/canvas", "")).toBe(LANDING);
  });
});

// ── 3. Nothing the retirement produces can loop ──────────────────────────────

describe("no redirect the retirement emits can loop", () => {
  beforeEach(signedIn);

  it("every retired route's destination is itself a fixed point", () => {
    for (const from of RETIRED) {
      const [pathname, search = ""] = from.split(/(?=\?)/);
      const to = retirementRedirect(pathname, search)!;
      expect(to, from).not.toBeNull();
      const [toPath, toSearch = ""] = to.split(/(?=\?)/);
      expect(retirementRedirect(toPath, toSearch), `${from} → ${to} → …`).toBeNull();
    }
  });

  it("and so is every billing rewrite's", () => {
    for (const from of [
      `/${SEGMENT}/canvas?billing=upgrade`,
      "/canvas?billing=success&session_id=cs_1",
      "/junk%2F/canvas?billing=return",
    ]) {
      const [pathname, search] = from.split(/(?=\?)/);
      const to = retirementRedirect(pathname, search)!;
      const [toPath, toSearch = ""] = to.split(/(?=\?)/);
      expect(retirementRedirect(toPath, toSearch), `${from} → ${to} → …`).toBeNull();
    }
  });

  it.each([LANDING, "/login", "/billing", `/billing/${SEGMENT}`])(
    "%s is stable under the flag — one request, no Location",
    async (path) => {
      // `/login` is the exception that proves it: a signed-IN visitor is bounced
      // by design, and that bounce is the next assertion's subject.
      if (path === "/login") {
        expect(await location(path)).toBe(LANDING);
        return;
      }
      expect(await location(path)).toBeNull();
    }
  );

  it("the /login default destination is the LANDING, not a retired page", async () => {
    // If this ever goes back to `/canvas`, the cycle below gains a hop per lap,
    // the bounce cookie's midpoint stops matching the page the browser actually
    // reaches, and the breaker disarms itself on every lap — unbounded.
    expect(await location("/login")).toBe(LANDING);
  });
});

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
}

/**
 * The GoTrue-degradation walk: the middleware reads the claims as valid, every
 * rendered page's own `getUser()` says signed out. `pageBounce` is what the page
 * does about it — `/get-started` names itself in the bounce, the old app pages
 * bounced bare. Both shapes have to terminate.
 */
async function walk(
  start: string,
  pageBounce: (path: string) => string,
  maxHops = 16
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
      trace.push(`${res.status} ${path} → ${next.pathname}${next.search}`);
      path = `${next.pathname}${next.search}`;
      continue;
    }
    if (path.startsWith("/login")) {
      trace.push(`200 ${path}`);
      return { trace, terminatedAt: path };
    }
    trace.push(`200 ${path} → (server component) bounce`);
    path = pageBounce(path);
  }
  return { trace, terminatedAt: null };
}

describe("the Q4 breaker still terminates with a retirement hop in the cycle", () => {
  beforeEach(signedIn);

  it.each(RETIRED)(
    "entering at %s terminates on the login screen",
    async (start) => {
      const { trace, terminatedAt } = await walk(start, () => "/login");
      expect(terminatedAt, `did not terminate:\n${trace.join("\n")}`).toBe("/login");
    }
  );

  it("terminates when /get-started bounces NAMING ITSELF, as it really does", async () => {
    // `src/app/get-started/page.tsx` redirects to
    // `/login?redirectTo=/get-started` — the loop verbatim, which is exactly
    // the shape the cookie's destination memory exists to bound.
    const { trace, terminatedAt } = await walk(
      `/${SEGMENT}/canvas`,
      () => `/login?redirectTo=${encodeURIComponent(LANDING)}`
    );
    expect(terminatedAt, `did not terminate:\n${trace.join("\n")}`).not.toBeNull();
    expect(trace.length).toBeLessThanOrEqual(9);
  });

  it("terminates for the billing rewrite's destination too", async () => {
    const { trace, terminatedAt } = await walk(
      `/${SEGMENT}/canvas?billing=upgrade`,
      (p) => `/login?redirectTo=${encodeURIComponent(p)}`
    );
    expect(terminatedAt, `did not terminate:\n${trace.join("\n")}`).not.toBeNull();
  });
});
