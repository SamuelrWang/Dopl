/**
 * THE PROXY MATCHER — the auth boundary that is written as a regex.
 *
 * `config.matcher` in `src/proxy.ts` decides which requests the session gate RUNS FOR
 * at all. Every alternative in its negative lookahead is a set of URLs the middleware
 * stops seeing, so widening it by one careless token is how an authenticated surface
 * becomes public — and nothing about the syntax makes that visible in review. This
 * suite is the visibility: it compiles the REAL exported value and asserts BOTH
 * directions, because a matcher test that only checks exclusions can be passed by a
 * matcher that excludes everything.
 *
 * Split out of `proxy.test.ts` under P0-4 (2026-08-07), when the enumeration of what
 * still reaches the gate pushed that file past the 500-line cap. The split is along a
 * real seam anyway: everything here is a pure predicate over a string, needs no
 * Supabase mock, and never calls `proxy()`. The route-matrix BEHAVIOUR — what the
 * function does once it runs — stays in `proxy.test.ts`.
 *
 * Rules for editing, from ENGINEERING.md §9.4: a path may leave the matcher only if
 * NOTHING BELOW THE AUTH CALL CAN CHANGE WHAT IT DOES. Two ways to fail that test are
 * easy to miss — a public path that is session-AWARE (the answer differs for a
 * signed-in visitor), and a path whose only interaction with the middleware is the
 * Supabase cookie refresh, which sessions depend on to outlive their access token.
 */

import { describe, it, expect } from "vitest";
import { config } from "./proxy";

// The matcher body is a raw regex inside a capture group, so it compiles directly —
// this asserts the real exported value, not a copy of it.
const re = new RegExp(`^${config.matcher[0]}$`);

describe("static assets never reach the proxy", () => {
  it.each([
    "/_next/static/chunks/main.js",
    "/_next/image",
    "/favicon.ico",
    "/logo.svg",
    "/hero.png",
    "/shot.jpeg",
    "/anim.gif",
    "/pic.webp",
  ])("%s", (path) => {
    expect(re.test(path)).toBe(false);
  });

  // ── P0-4 (2026-08-07): THE STATIC-FILE HOLE ──────────────────────────────────
  //
  // THE FIRST ENTRY IS A SHIPPED BUG, not a hypothetical. The old exclusion named
  // `favicon.ico` at the path ROOT only, and its extension list contained no `.ico`
  // at all — while `src/app/layout.tsx` points every browser at
  // `/favicons/favicon.ico`. To the proxy an icon request is indistinguishable from
  // a page request, and the signed-out branch bounces page requests, so EVERY
  // SIGNED-OUT LANDING-PAGE VISIT ran a serverless function that 307'd the page's
  // own favicon to `/login`. `site.webmanifest` shared the fate, and `robots.txt` /
  // `sitemap.xml` could not have been served at all if anyone had written them.
  it.each([
    "/favicons/favicon.ico",
    "/favicons/site.webmanifest",
    "/favicons/apple-touch-icon.png",
    "/favicons/android-chrome-512x512.png",
    "/robots.txt",
    "/sitemap.xml",
    "/img/site_thumbnail.jpg",
    "/fonts/inter.woff2",
    "/fonts/inter.woff",
  ])("%s", (path) => {
    expect(re.test(path)).toBe(false);
  });
});

describe("the marketing and legal pages no longer pay for the claims read", () => {
  // All three were already in `PUBLIC_ROUTES`, so the middleware read claims and then
  // returned the passthrough it would have returned anyway: one serverless invocation
  // and a WebCrypto verify per view, buying nothing. Excluding them is also what makes
  // `next.config.ts`'s `Cache-Control` mean something — `getClaims()` can rotate
  // cookies onto the response, and a `Set-Cookie` overrides any shared-cache directive.
  //
  // THE PROXY BODY STILL ANSWERS THEM CORRECTLY, and `proxy.test.ts` still proves it.
  // Same defence-in-depth shape as SELF_AUTH_ROUTES: if this matcher is ever widened
  // back, the verdict must not change with it.
  it.each(["/pricing", "/privacy", "/terms"])("%s never reaches the proxy", (path) => {
    expect(re.test(path)).toBe(false);
  });

  // The alternatives are UNANCHORED prefixes, and that is safe by construction rather
  // than by luck: `PUBLIC_ROUTES` matches with `pathname.startsWith`, so every path
  // these newly exclude was ALREADY getting the identical unconditional passthrough
  // out of the proxy body. The companion behaviour proof — that `proxy()` really does
  // return a bare 200 for these, in both session states — lives in `proxy.test.ts`.
  it.each(["/pricing/enterprise", "/termsfoo", "/privacy-policy"])(
    "%s is excluded, and was already an unconditional passthrough",
    (path) => {
      expect(re.test(path)).toBe(false);
    }
  );

  // Case-sensitivity is load-bearing, not incidental: the exclusions are byte matches,
  // so a mixed-case marketing URL still reaches the proxy and still gets the S-8
  // canonical 308. Losing that would turn `/Pricing` into a hard 404.
  it.each(["/Pricing", "/Terms", "/Privacy"])(
    "mixed-case %s still reaches the proxy for the S-8 308",
    (path) => {
      expect(re.test(path)).toBe(true);
    }
  );
});

describe("the API split", () => {
  // STAGE E (2026-08-06): the SELF-AUTHENTICATING routes no longer reach the middleware
  // at all. They already short-circuited at the top of the proxy, so this changes no
  // verdict — it stops the work from being scheduled. `/api/mcp` is the one that
  // matters: it STREAMS, and its correctness rests on headers reaching the client
  // inside a 60s budget.
  it.each([
    "/api/mcp",
    "/api/oauth/authorize",
    "/api/version",
    "/api/cron/thread-sweep",
    "/api/billing/webhook",
    "/.well-known/oauth-authorization-server",
  ])("self-authenticating route %s never reaches the proxy", (path) => {
    expect(re.test(path)).toBe(false);
  });

  // …and the rest of /api/** still does. Dropping ALL of it is the plan's end state and
  // is deliberately NOT done: the middleware is what refreshes the Supabase session
  // cookie, and cookie-authed API calls would silently lose that. See `config` in
  // proxy.ts.
  it.each([
    "/api/workspaces/me",
    "/api/channels",
    "/api/channels/sessions",
    "/api/auth/mcp-device-token",
  ])("cookie-authed API route %s still reaches the proxy", (path) => {
    expect(re.test(path)).toBe(true);
  });
});

// THE COMPLETE SET OF PATHS THAT STILL PAY FOR THE CLAIMS READ, one entry per reason
// it has to. Getting an exclusion wrong here is an auth hole, so the justification is
// enumerated rather than assumed:
//
//   /                       session-AWARE — bounces a signed-in visitor into the app.
//                           Considered for exclusion and KEPT; see §9.4 and `config`.
//   /login                  session-aware AND owner of the Q4 loop breaker's cookie.
//   /get-started            auth-gated page; also the retirement landing.
//   /billing{,/segment}     auth-gated, and the URLs a payment arrives on.
//   /admin/*                auth-gated.
//   /download               PUBLIC_ROUTE, but a real route handler, not a static file.
//   /invite/*, /join/*      PUBLIC_ROUTES whose pages branch on session state.
//   /oauth/authorize        PUBLIC_ROUTE running its own getUser + login bounce.
//   /auth/*                 the callback and the desktop sign-in bridge.
//   /canvas, /{segment}/*   historical URLs the retirement map answers for.
//   /api/** non-self-auth   401s here, AND refreshes the cookie-authed session.
describe("everything that must still reach the gate", () => {
  it.each([
    "/",
    "/login",
    "/get-started",
    "/billing",
    "/billing/acme-ab12",
    "/admin/health",
    "/admin/analytics",
    "/download",
    "/invite/tok_x",
    "/join/tok_x",
    "/oauth/authorize",
    "/auth/callback",
    "/auth/desktop-start",
    "/auth/desktop-handoff",
    "/auth/reset-password",
    "/canvas",
    "/onboarding",
    "/acme-ab12/canvas",
    "/acme-ab12/knowledge",
    "/api/workspaces/me",
    "/api/auth/mcp-device-token",
  ])("%s", (path) => {
    expect(re.test(path)).toBe(true);
  });
});
