/**
 * WHERE `/auth/callback` SENDS PEOPLE, as a matrix.
 *
 * This one handler is the end of four different journeys, and only ONE of them
 * moved when the landing page became auth-first: a plain web sign-in now ends on
 * `/get-started` (the download page) instead of `/canvas` or `/onboarding`. The
 * other three are pinned here because their failure modes are not cosmetic —
 *
 *   • DESKTOP (`?desktop=1`) must end at `/auth/desktop-handoff`, carrying the
 *     app's `state` nonce, or the desktop app can never sign in at all. It must
 *     also never take the onboarding detour (it never did — onboarding happens
 *     in the app) and never see the new landing.
 *   • A DEEP LINK (`?redirectTo=`) must come back to itself: an OAuth consent
 *     screen that loses its query is an authorization that silently fails, and
 *     an invite that loses its token is a person who joined nothing.
 *   • A FIRST-RUN deep link must still detour through `/onboarding`, carrying
 *     the deep link, so the journey it interrupted can be resumed.
 *
 * Only Supabase, the workspace provisioner and the onboarding read are mocked;
 * the routing decision under test is the shipping one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  exchangeError: null as { message: string } | null,
  user: { id: "user-1" } as { id: string } | null,
  onboarded: true,
}));

vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/shared/supabase/admin", () => ({
  createServerSupabaseClient: () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: state.exchangeError }),
      getUser: async () => ({ data: { user: state.user } }),
    },
  }),
}));
vi.mock("@/features/analytics/server/conversion-events", () => ({
  logConversionEvent: vi.fn(async () => {}),
  hasFiredEvent: vi.fn(async () => true),
}));
vi.mock("@/features/workspaces/server/service", () => ({
  ensureDefaultWorkspace: vi.fn(async () => ({ id: "ws-1", slug: "default" })),
}));
vi.mock("@/features/onboarding/server/service", () => ({
  isOnboarded: vi.fn(async () => state.onboarded),
}));

import { GET } from "./route";

/** The handler's answer, as the path a browser would follow. */
async function destinationOf(query: string): Promise<string> {
  const res = await GET(new NextRequest(`http://localhost/auth/callback${query}`));
  const location = res.headers.get("location");
  if (!location) throw new Error("callback did not redirect");
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
}

beforeEach(() => {
  state.exchangeError = null;
  state.user = { id: "user-1" };
  state.onboarded = true;
});

describe("a plain web sign-in", () => {
  it("lands on the download page", async () => {
    expect(await destinationOf("?code=abc")).toBe("/get-started");
  });

  it("lands there for a FIRST-RUN user too — onboarding happens in the app", async () => {
    // The change with the sharpest edge: a brand-new account used to be pushed
    // through the web survey on its way to installing the app that asks the same
    // questions. `/onboarding` is on the retirement plan's RETIRE list and the
    // SPA carries its own.
    state.onboarded = false;
    expect(await destinationOf("?code=abc")).toBe("/get-started");
  });

  it("is not diverted by a hostile redirectTo", async () => {
    state.onboarded = false;
    // Rejected values must not merely fail to redirect off-origin — they must
    // not count as "this sign-in came from somewhere" either, or a crafted URL
    // could flip the onboarding branch.
    expect(await destinationOf("?code=abc&redirectTo=https%3A%2F%2Fevil.example")).toBe(
      "/get-started"
    );
    expect(await destinationOf("?code=abc&redirectTo=%2F%2Fevil.example")).toBe("/get-started");
  });
});

describe("the DESKTOP flow is untouched", () => {
  it("hands off to the app, carrying the login-CSRF nonce", async () => {
    expect(await destinationOf("?code=abc&desktop=1&state=nonce123")).toBe(
      "/auth/desktop-handoff?state=nonce123"
    );
  });

  it("hands off even with no nonce (older builds)", async () => {
    expect(await destinationOf("?code=abc&desktop=1")).toBe("/auth/desktop-handoff");
  });

  it("never detours through onboarding, and never sees the download page", async () => {
    state.onboarded = false;
    const dest = await destinationOf("?code=abc&desktop=1&state=n");
    expect(dest).toBe("/auth/desktop-handoff?state=n");
    expect(dest).not.toContain("onboarding");
    expect(dest).not.toContain("get-started");
  });

  it("ignores a redirectTo riding alongside desktop=1", async () => {
    // The desktop marker wins outright: the session has to reach the app.
    expect(await destinationOf("?code=abc&desktop=1&state=n&redirectTo=%2Fcanvas")).toBe(
      "/auth/desktop-handoff?state=n"
    );
  });
});

describe("an explicit deep link comes back to itself", () => {
  it.each([
    ["an OAuth consent screen", "/oauth/authorize?client_id=abc&state=xyz"],
    ["a workspace invite", "/invite/tok_123"],
    ["a join link", "/join/tok_123"],
    ["a password reset", "/auth/reset-password"],
    ["the app", "/canvas"],
  ])("%s", async (_label, target) => {
    expect(await destinationOf(`?code=abc&redirectTo=${encodeURIComponent(target)}`)).toBe(target);
  });

  it("still detours a FIRST-RUN user through onboarding, carrying the deep link", async () => {
    state.onboarded = false;
    expect(await destinationOf("?code=abc&redirectTo=%2Finvite%2Ftok_123")).toBe(
      "/onboarding?redirectTo=%2Finvite%2Ftok_123"
    );
  });
});

describe("failures still end at the login screen", () => {
  it("no code at all", async () => {
    expect(await destinationOf("")).toBe("/login");
  });

  it("a code the exchange refuses", async () => {
    state.exchangeError = { message: "invalid grant" };
    expect(await destinationOf("?code=stale")).toBe("/login");
  });
});
