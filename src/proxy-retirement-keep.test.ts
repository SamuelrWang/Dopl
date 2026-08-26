/**
 * WEBSITE RETIREMENT, STAGE B — THE KEEP LIST, ASSERTED WITH THE FLAG ON.
 * `docs/migration-research/website-retirement-plan.md` §1.
 *
 * "Retire the website" means retire the logged-in web APPLICATION pages. The
 * Next.js deployment stays, and what stays with it is not a short list: the
 * whole API, the OAuth authorization server and MCP surface, the desktop
 * sign-in bridge, the billing page, the public marketing and legal pages, the
 * invite and join links, the admin views, the landing page.
 *
 * The retirement map is a MATCHER, and a matcher that is one segment too greedy
 * takes down the product's data plane rather than one page — `[workspaceSlug]`
 * is a ROOT-level dynamic segment, so `/pricing` is `/{segment}` as far as a
 * pattern can tell. Every kept surface is therefore enumerated here from the
 * route tree, and asserted twice: through the real middleware, and against the
 * pure map, which must answer `null` for each.
 *
 * THE DESKTOP FLOWS GET THEIR OWN SECTION because they are the ones nobody
 * would notice breaking until a user could not sign in: `/auth/desktop-start` →
 * provider → `/auth/callback?desktop=1` → `/auth/desktop-handoff` → `dopl://`,
 * the SPA's `/api/**` data plane, and `/api/version`, whose non-200 answer the
 * min-version gate reads as "no answer" and fails open on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  claims: null as { sub: string } | null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      async getClaims() {
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
  WEBSITE_RETIRED_ENV,
  retirementRedirect,
} from "./shared/lib/url/website-retirement";

const ORIGIN = "https://app.usedopl.com";
const SEGMENT = "acme-ab12cd34ef56";
/** A link-container id, the shape `/c/{workspaceId}` actually carries. */
const CONTAINER = "6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

function req(path: string, headers?: Record<string, string>) {
  return new NextRequest(new URL(path, ORIGIN), headers ? { headers } : undefined);
}

function signedIn() {
  state.claims = { sub: "user-1" };
}

/** The map's verdict for a full `path?query` string. `null` = not retired. */
function mapVerdict(path: string): string | null {
  const [pathname, search] = path.split("?");
  return retirementRedirect(pathname, search ? `?${search}` : "");
}

beforeEach(() => {
  state.claims = null;
  vi.unstubAllEnvs();
  vi.stubEnv(WEBSITE_RETIRED_ENV, undefined); // retired: the default
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});

/**
 * Everything the retirement must not touch, enumerated from `src/app/` rather
 * than from the plan's prose. `/` and `/login` are absent only because a
 * signed-IN visitor to either is bounced by design; both are asserted below.
 */
const KEEP = [
  "/get-started",
  "/billing",
  `/billing/${SEGMENT}`,
  `/billing/${SEGMENT}?billing=upgrade`,
  "/pricing",
  "/terms",
  "/privacy",
  "/download",
  "/admin/analytics",
  "/admin/health",
  "/invite/tok_x",
  "/join/tok_x",
  // The home-channel claim page. `link` has been in `RESERVED_TOP_LEVEL` since
  // 2026-08-23 and its immunity went UNASSERTED here — backfilled with the
  // guest-channel row below, which is the same class of entry route.
  "/link/tok_x",
  // The guest web channel surface (2026-08-25) — the destination a claimer
  // without the desktop app lands on. Retiring it would send every guest to the
  // download page, which is the one thing this lane exists to avoid.
  `/c/${CONTAINER}`,
  "/auth/callback?code=abc",
  "/auth/desktop-start?provider=github&state=n1",
  "/auth/desktop-handoff?state=n1",
  "/auth/reset-password",
  "/oauth/authorize?client_id=x&state=y",
  "/api/version",
  "/api/workspaces/me",
  "/api/billing/checkout",
  "/api/billing/portal",
  "/api/billing/webhook",
  "/api/mcp",
  "/api/oauth/token",
  "/api/cron/oauth-cleanup",
  "/api/channels/c_1/messages",
  "/api/workspaces/invitations/tok_x",
  "/.well-known/oauth-authorization-server",
];

describe("the KEEP list is untouched with the flag ON", () => {
  it.each(KEEP)("%s passes through signed IN", async (path) => {
    signedIn();
    const res = await proxy(req(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(KEEP)("%s is never claimed by the retirement map", (path) => {
    expect(mapVerdict(path)).toBeNull();
  });

  it.each([
    "/",
    "/login",
    "/pricing",
    "/terms",
    "/privacy",
    "/download",
    "/join/tok_x",
    "/invite/tok_x",
    // A claimer has no account by definition — serving this one signed OUT is
    // the entire point of the link (`PUBLIC_ROUTES › "/link/"`).
    "/link/tok_x",
    "/auth/callback?code=abc",
    "/auth/desktop-start?provider=google&state=n1",
    "/auth/desktop-handoff?state=n1",
    "/oauth/authorize?client_id=x&state=y",
    "/api/version",
    "/api/mcp",
    "/.well-known/oauth-authorization-server",
  ])("%s still serves a SIGNED-OUT visitor", async (path) => {
    const res = await proxy(req(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("the landing page is still the public marketing surface", async () => {
    expect((await proxy(req("/"))).status).toBe(200);
    expect(retirementRedirect("/", "")).toBeNull();
    expect(retirementRedirect("/", "?utm_source=x")).toBeNull();
  });

  it("a signed-out /api/** call still 401s rather than being retired", async () => {
    const res = await proxy(req("/api/workspaces/me"));
    expect(res.status).toBe(401);
  });

  it("a signed-out KEEP PAGE still bounces to /login naming itself", async () => {
    // `/get-started` and `/billing/*` are auth-gated, not public — the flag
    // must not change which of the two things happens to them.
    const raw = (await proxy(req("/get-started"))).headers.get("location");
    expect(raw).toBe(`${ORIGIN}/login?redirectTo=%2Fget-started`);
  });

  it("the top-level KEEPs are a RULE, not an accident", () => {
    // ⚠ THE KEEP ROWS ABOVE PASS WITH OR WITHOUT THE RESERVATION, which is the
    // gap this closes. `/link/{token}` and `/c/{workspaceId}` are two-segment
    // paths whose SECOND part is not an `APP_PAGES` name, so the map answers
    // `null` for them by falling off the end of every rule: delete either name
    // from `RESERVED_TOP_LEVEL` and every assertion above still passes.
    //
    // `RESERVED_TOP_LEVEL` is what makes those KEEPs structural, and a COLLIDING
    // child segment is the only shape that can prove it. Real traffic never
    // produces these (claim tokens and container UUIDs are not called
    // "knowledge"), so these are not URLs — they are the rule stated in the one
    // form that fails when the rule is gone. Same argument the `signup` entry
    // carries in its own comment.
    for (const path of [
      "/link/knowledge",
      "/link/settings",
      "/c/knowledge",
      "/c/settings",
    ]) {
      expect(mapVerdict(path), path).toBeNull();
    }
  });

  it("mixed-case canonicalization still runs BEFORE the retirement", async () => {
    signedIn();
    const res = await proxy(req(`/${SEGMENT.toUpperCase()}/Canvas`));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/${SEGMENT}/canvas`);
  });

  it("social crawlers still reach the OG card, structurally now", async () => {
    // THIS USED TO ASSERT A BRANCH THAT NO LONGER EXISTS. The proxy carried a
    // passthrough for paths ending `/opengraph-image` — written for convention-based
    // route FILES under `/community/[slug]/`, none of which survived Stage D — and
    // P0-4 removed it. The guarantee it was protecting is unchanged and now stronger:
    // the card a crawler actually fetches is the STATIC file the root layout names,
    // and the matcher excludes it by extension, so the middleware does not run and no
    // code path exists that could redirect a session-less crawler.
    const { config } = await import("./proxy");
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/img/site_thumbnail.jpg")).toBe(false);
  });

  it("static assets never reach the middleware at all", async () => {
    const { config } = await import("./proxy");
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const asset of [
      "/_next/static/chunks/main.js",
      "/favicon.ico",
      // P0-4: the one `layout.tsx` actually emits. `.ico` in a SUBDIRECTORY was
      // not excluded, so this was 307'd to /login on every signed-out landing view.
      "/favicons/favicon.ico",
      "/favicons/site.webmanifest",
      "/logo.svg",
      "/img/site_thumbnail.jpg",
    ]) {
      expect(re.test(asset), asset).toBe(false);
    }
  });
});

// ── The desktop flows ────────────────────────────────────────────────────────

describe("the desktop is provably unaffected", () => {
  it.each([
    // The browser-OAuth chain, end to end.
    "/auth/desktop-start?provider=google&state=n1",
    "/auth/desktop-start?provider=github&state=n1",
    "/auth/callback?code=abc&desktop=1&state=n1",
    "/auth/desktop-handoff?state=n1",
    // The min-version gate's server half. A 302 here reads to the client as
    // "no answer", it fails open, and the whole forced-upgrade gate silently
    // stops blocking anybody — the exact failure the gate already shipped once.
    "/api/version",
    // The device-token mint the desktop listener bootstraps with.
    "/api/auth/mcp-device-token",
  ])("%s is untouched in BOTH session states", async (path) => {
    expect(mapVerdict(path)).toBeNull();
    expect((await proxy(req(path))).headers.get("location")).toBeNull();
    signedIn();
    expect((await proxy(req(path))).headers.get("location")).toBeNull();
  });

  it("the SPA's boot calls ride /api/** untouched", async () => {
    signedIn();
    for (const path of [
      "/api/workspaces/me",
      "/api/user/profile",
      "/api/channels/consent",
      "/api/onboarding/status",
    ]) {
      const res = await proxy(req(path));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("an SPA bearer call is still un-gated (the desktop data plane)", async () => {
    // The SPA sends a Supabase access JWT and NO cookies; `withUserAuth` is the
    // single fail-closed authority and the middleware must not pre-judge it.
    const res = await proxy(
      req("/api/workspaces/me", {
        authorization: "Bearer eyJhbGciOiJFUzI1NiJ9.claims.sig",
      })
    );
    expect(res.status).toBe(200);
  });

  it("the dopl:// deep link's only web half is a KEEP route", () => {
    // `dopl://auth#tokens` is built by `/auth/desktop-handoff` and consumed by
    // the desktop protocol handler; no other verb exists, so there is no deep
    // link the middleware could break.
    expect(retirementRedirect("/auth/desktop-handoff", "?state=n1")).toBeNull();
  });
});
