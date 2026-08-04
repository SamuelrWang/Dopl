/**
 * WHO LANDS WHERE AFTER A SIGN-IN, as a table.
 *
 * `/login` is not one flow, it is four that share a screen: a plain web visitor
 * arriving from the landing page's "Get Started", a deep link bouncing through
 * (`/oauth/authorize`, `/invite/<token>`, `/join/<token>`, the middleware's own
 * `?redirectTo=`), the desktop app's system-browser OAuth, and a password reset.
 * Only the FIRST one's destination moved. The rest are pinned here because the
 * cost of getting them wrong is not a bad landing page — it is an OAuth consent
 * that never returns to the client, or a desktop app that can never sign in.
 */

import { describe, it, expect } from "vitest";
import {
  WEB_POST_AUTH_LANDING,
  explicitPostAuthTarget,
  webPostAuthDestination,
} from "./post-auth-landing";

describe("a PLAIN web sign-in", () => {
  it("lands on the download page, not on the app", () => {
    // The whole point of the auth-first funnel: the account is captured, and the
    // next thing the user needs is the dmg — not a web app that is being retired.
    expect(webPostAuthDestination(null)).toBe("/get-started");
    expect(webPostAuthDestination(undefined)).toBe("/get-started");
    expect(webPostAuthDestination("")).toBe("/get-started");
    expect(WEB_POST_AUTH_LANDING).toBe("/get-started");
  });

  it("reads as 'asked for nothing', which is what suppresses the onboarding detour", () => {
    // `/auth/callback` sends a first-run user through `/onboarding` only when the
    // URL named a place to come back to. A plain signup finishes onboarding INSIDE
    // the app, so this null is load-bearing, not cosmetic.
    expect(explicitPostAuthTarget(null)).toBeNull();
    expect(explicitPostAuthTarget("")).toBeNull();
  });
});

describe("an EXPLICIT ?redirectTo= is honoured, unchanged", () => {
  it.each([
    ["the OAuth consent screen", "/oauth/authorize?client_id=abc&state=xyz"],
    ["a workspace invite", "/invite/tok_123"],
    ["a join link", "/join/tok_123"],
    ["the middleware's own bounce", "/myws/channels"],
    ["a password reset", "/auth/reset-password"],
    ["the app itself", "/canvas"],
  ])("%s comes back to itself", (_label, target) => {
    expect(webPostAuthDestination(target)).toBe(target);
    expect(explicitPostAuthTarget(target)).toBe(target);
  });

  it("keeps the query and the fragment the deep link depends on", () => {
    // The OAuth dance dies without its query: `client_id`, `state`, `code_challenge`
    // all ride the redirect back.
    expect(webPostAuthDestination("/oauth/authorize?client_id=a&state=b#c")).toBe(
      "/oauth/authorize?client_id=a&state=b#c"
    );
  });
});

describe("a HOSTILE target is not a target", () => {
  it.each([
    ["an absolute URL", "https://evil.example/x"],
    ["a protocol-relative URL", "//evil.example/x"],
    ["the backslash variant browsers mis-parse", "/\\evil.example"],
    ["a bare word", "canvas"],
    ["a scheme", "javascript:alert(1)"],
  ])("%s degrades to the landing, and reads as 'asked for nothing'", (_label, target) => {
    expect(webPostAuthDestination(target)).toBe(WEB_POST_AUTH_LANDING);
    // The second assertion is the one with teeth: if a rejected value read as an
    // explicit target, a crafted `?redirectTo=https://evil.example` would silently
    // change which BRANCH `/auth/callback` takes, even though it can't change the
    // URL. Rejection has to be total.
    expect(explicitPostAuthTarget(target)).toBeNull();
  });

  it("never returns anything that could leave the origin", () => {
    for (const raw of ["https://evil.example", "//evil.example", "/\\evil.example", "ftp://x"]) {
      const dest = webPostAuthDestination(raw);
      expect(dest.startsWith("/")).toBe(true);
      expect(dest.startsWith("//")).toBe(false);
    }
  });
});

describe("the landing itself", () => {
  it("is a same-origin path the middleware will gate", () => {
    // `/get-started` is deliberately NOT in `proxy.ts` PUBLIC_ROUTES: a signed-out
    // visitor must be bounced to `/login?redirectTo=/get-started` and come back.
    // A value that started with "/download" would inherit that route's PUBLIC
    // prefix match and silently open the page to anybody.
    expect(WEB_POST_AUTH_LANDING.startsWith("/")).toBe(true);
    expect(WEB_POST_AUTH_LANDING.startsWith("/download")).toBe(false);
    expect(webPostAuthDestination(WEB_POST_AUTH_LANDING)).toBe(WEB_POST_AUTH_LANDING);
  });
});
