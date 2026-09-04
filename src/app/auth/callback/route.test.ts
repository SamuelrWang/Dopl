/**
 * WHERE `/auth/callback` SENDS PEOPLE, as a matrix. Four journeys end at this one handler:
 *   • DESKTOP (`?desktop=1`) → `/auth/desktop-handoff` carrying the app's `state` nonce, or the
 *     desktop app can never sign in at all.
 *   • A DEEP LINK (`?redirectTo=`) must come back to itself — a consent screen that loses its
 *     query is an authorization that silently fails.
 *   • A FIRST-RUN deep link is the SAME journey (no `/onboarding` detour). End-to-end walk:
 *     `src/first-run-deep-link.test.ts`.
 *   • A plain web sign-in ends on `/get-started`.
 * Only Supabase and the workspace provisioner are mocked; the onboarding mock survives to assert
 * it is never READ.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  exchangeError: null as { message: string } | null,
  user: { id: "user-1" } as { id: string } | null,
  onboarded: true,
  session: {
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_in: 3600,
    expires_at: 1_800_000_000,
  } as Record<string, unknown> | null,
  /** WHICH factory the handler reached for — the 2026-09-04 sign-out turns on this. */
  clientKind: null as "web" | "desktop" | null,
}));

vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
const supabaseStub = (kind: "web" | "desktop") => {
  state.clientKind = kind;
  return {
    auth: {
      exchangeCodeForSession: async () => ({
        data: { session: state.exchangeError ? null : state.session },
        error: state.exchangeError,
      }),
      getUser: async () => ({ data: { user: state.user } }),
    },
  };
};
vi.mock("@/shared/supabase/admin", () => ({
  createServerSupabaseClient: () => supabaseStub("web"),
  // ⚠ THE DESKTOP LEG MUST NOT REACH THE WRITING CLIENT (2026-09-04). A browser copy of the
  // session the app is about to adopt is a SECOND holder of one refresh-token family, and
  // Supabase revokes the whole family the moment the stale copy is refreshed. Field evidence
  // and the desktop-side pin: `dopl-desktop-app/test/desktop-handoff-one-family.test.mjs`.
  createDesktopHandoffSupabaseClient: () => supabaseStub("desktop"),
}));
vi.mock("@/features/analytics/server/conversion-events", () => ({
  logConversionEvent: vi.fn(async () => {}),
  hasFiredEvent: vi.fn(async () => true),
}));
vi.mock("@/features/workspaces/server/service", () => ({
  ensurePersonalContainer: vi.fn(async () => ({ id: "ws-1", slug: "personal" })),
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
  state.session = {
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_in: 3600,
    expires_at: 1_800_000_000,
  };
  state.clientKind = null;
});

/** The whole redirect, fragment included — `destinationOf` deliberately drops the hash. */
async function responseOf(query: string) {
  return GET(new NextRequest(`http://localhost/auth/callback${query}`));
}

describe("a plain web sign-in", () => {
  it("lands on the download page", async () => {
    expect(await destinationOf("?code=abc")).toBe("/get-started");
  });

  it("lands there for a FIRST-RUN user too — onboarding happens in the app", async () => {
    state.onboarded = false;
    expect(await destinationOf("?code=abc")).toBe("/get-started");
  });

  it("is not diverted by a hostile redirectTo", async () => {
    state.onboarded = false;
    // A rejected value must not merely fail to redirect off-origin — it must also not count as
    // "this sign-in came from somewhere".
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
    expect(await destinationOf("?code=abc&desktop=1&state=n&redirectTo=%2Fcanvas")).toBe(
      "/auth/desktop-handoff?state=n"
    );
  });
});

describe("ONE FAMILY, ONE HOLDER — the desktop leg leaves no session in the browser", () => {
  it("exchanges the code with the READ-ONLY client, and the web leg with the writing one", async () => {
    await destinationOf("?code=abc&desktop=1&state=n");
    expect(state.clientKind).toBe("desktop");
    await destinationOf("?code=abc");
    expect(state.clientKind).toBe("web");
  });

  it("hands the session over in the FRAGMENT, which no server ever receives", async () => {
    const res = await responseOf("?code=abc&desktop=1&state=n");
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/desktop-handoff");
    expect(location.searchParams.get("state")).toBe("n");
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
    expect(fragment.get("access_token")).toBe("at-1");
    expect(fragment.get("refresh_token")).toBe("rt-1");
    expect(fragment.get("expires_in")).toBe("3600");
    // …and the query carries NOTHING of the session: a query string reaches every proxy,
    // access log and Referer header on the way.
    expect(location.search).not.toContain("rt-1");
    expect(location.search).not.toContain("at-1");
  });

  it("sets no auth cookie on the way out", async () => {
    const res = await responseOf("?code=abc&desktop=1&state=n");
    const written = res.cookies.getAll().map((c) => c.name);
    expect(written.filter((n) => n.endsWith("-auth-token"))).toEqual([]);
  });

  it("falls back to /login when the exchange returns no session", async () => {
    // A missing session must never be answered by retrying through the WRITING client —
    // that is the fix undone.
    state.session = null;
    expect(await destinationOf("?code=abc&desktop=1&state=n")).toBe("/login");
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

  it.each([
    ["an OAuth consent screen", "/oauth/authorize?client_id=abc&state=xyz"],
    ["a workspace invite", "/invite/tok_123"],
    ["a join link", "/join/tok_123"],
    ["a password reset", "/auth/reset-password"],
  ])("%s does, for a FIRST-RUN user too (F-136)", async (_label, target) => {
    // ⚠ No `/onboarding?redirectTo=` detour: that hop REPLACES the query, deleting the
    // destination it carries. See `src/first-run-deep-link.test.ts`.
    state.onboarded = false;
    expect(await destinationOf(`?code=abc&redirectTo=${encodeURIComponent(target)}`)).toBe(target);
  });

  it("does not read onboarding state at all — the question moved to the app", async () => {
    const { isOnboarded } = await import("@/features/onboarding/server/service");
    vi.mocked(isOnboarded).mockClear();
    state.onboarded = false;
    await destinationOf("?code=abc&redirectTo=%2Finvite%2Ftok_123");
    await destinationOf("?code=abc");
    expect(isOnboarded).not.toHaveBeenCalled();
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
