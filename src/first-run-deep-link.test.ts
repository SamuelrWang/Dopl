/**
 * A FIRST-TIME USER'S DEEP LINK MUST SURVIVE THE SIGN-IN — F-136, pinned at
 * both layers and then end to end, because the regression lived in neither
 * layer alone. It lived in the SEAM.
 *
 * THE DEFECT, AS IT SHIPPED. `/auth/callback` detoured a never-onboarded web
 * arrival through `/onboarding?redirectTo=<target>` so the survey could finish
 * the journey it interrupted (F-130). Stage B of the website retirement (F-135)
 * then retired `/onboarding` — and the retirement hop REPLACES the query
 * (`applyTarget`), so the detour deleted the destination it existed to carry:
 *
 *   /auth/callback?code=…&redirectTo=%2Fjoin%2Ftok_x
 *     → 302 /onboarding?redirectTo=%2Fjoin%2Ftok_x     (the callback)
 *     → 302 /get-started                                (the middleware)
 *
 * Neither commit was wrong on its own; each was read against the other's
 * behaviour rather than against the walk. So the assertions that matter here
 * are the ones that FOLLOW the browser, not the ones that check one handler.
 *
 * WHAT IT COST. The three shapes below are the ones a first-time user actually
 * arrives on, and each fails silently and unrecoverably:
 *   • `/oauth/authorize?…` — an MCP client that never receives its code. The
 *     retry fails identically, because `onboarded_at` is only stamped inside
 *     the desktop app now: there was NO state reachable from the web that would
 *     have made a second attempt behave differently.
 *   • `/invite/<token>` — a person who joined nothing.
 *   • `/join/<token>` — the same, from a link pasted out of the app.
 *
 * Both mocked module sets live in one file on purpose: the proof is the chain,
 * and splitting it would leave each half asserting its own half of a bug.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── The callback's world ─────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  claims: null as { sub: string } | null,
  onboarded: false,
}));

vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/shared/supabase/admin", () => ({
  createServerSupabaseClient: () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
  }),
}));
vi.mock("@/features/analytics/server/conversion-events", () => ({
  logConversionEvent: vi.fn(async () => {}),
  hasFiredEvent: vi.fn(async () => false),
}));
vi.mock("@/features/workspaces/server/service", () => ({
  ensurePersonalContainer: vi.fn(async () => ({ id: "ws-1", slug: "personal" })),
}));
vi.mock("@/features/onboarding/server/service", () => ({
  isOnboarded: vi.fn(async () => state.onboarded),
}));

// ── The middleware's world ───────────────────────────────────────────────────

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

import { GET } from "./app/auth/callback/route";
import { proxy } from "./proxy";
import { retirementRedirect } from "./shared/lib/url/website-retirement";

const ORIGIN = "https://app.usedopl.com";
const LANDING = "/get-started";

/**
 * THE THREE LIVE-REPRO SHAPES, plus the fourth arrival that shares the defect.
 * Every one of them is on the retirement KEEP list, and not one of them reads
 * onboarding state — which is the whole argument for deleting the detour rather
 * than repointing it.
 */
const DEEP_LINKS = [
  ["an MCP OAuth consent screen", "/oauth/authorize?client_id=mcp_x&state=st&code_challenge=cc"],
  ["a workspace invite", "/invite/tok_x"],
  ["a join link", "/join/tok_x"],
  ["a password reset", "/auth/reset-password"],
] as const;

beforeEach(() => {
  state.claims = null;
  // A NEVER-ONBOARDED user — the only population the defect could reach, and
  // by definition every first-time arrival on all four links above.
  state.onboarded = false;
  vi.unstubAllEnvs();
  // Retired is the default; an ambient shell value must not decide that here.
  vi.stubEnv("WEBSITE_RETIRED", undefined);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});

/** Where `/auth/callback` sends the browser, as a path. */
async function callbackDestination(query: string): Promise<string> {
  const res = await GET(new NextRequest(`${ORIGIN}/auth/callback${query}`));
  const location = res.headers.get("location");
  if (!location) throw new Error("callback did not redirect");
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
}

/** One middleware pass: the `Location` it emits, origin stripped, or null. */
async function proxyLocation(path: string): Promise<string | null> {
  const res = await proxy(new NextRequest(new URL(path, ORIGIN)));
  const raw = res.headers.get("location");
  if (raw && !raw.startsWith(`${ORIGIN}/`)) {
    throw new Error(`middleware emitted an off-origin Location: ${raw}`);
  }
  return raw ? raw.slice(ORIGIN.length) : null;
}

/**
 * The browser: sign in, then follow every redirect the middleware hands out
 * until a request is served. This — not either handler's answer — is where the
 * user ends up, and it is the only thing that was ever broken.
 */
async function signInAndFollow(query: string, maxHops = 8): Promise<string> {
  let path = await callbackDestination(query);
  state.claims = { sub: "user-1" }; // the exchange above created the session
  for (let hop = 0; hop < maxHops; hop++) {
    const next = await proxyLocation(path);
    if (!next) return path;
    path = next;
  }
  throw new Error(`did not settle within ${maxHops} hops (stuck at ${path})`);
}

// ── 1. The callback ──────────────────────────────────────────────────────────

describe("the callback hands a first-run user their deep link, not a detour", () => {
  it.each(DEEP_LINKS)("%s", async (_label, target) => {
    expect(await callbackDestination(`?code=abc&redirectTo=${encodeURIComponent(target)}`)).toBe(
      target
    );
  });

  it("never asks whether the user is onboarded — the question moved to the app", async () => {
    // Not a style assertion. While this read existed the destination could
    // depend on `profiles.onboarded_at`, a column the web can no longer stamp,
    // so the branch it fed was permanently taken for exactly the population it
    // was meant to help. Deleting the read is what makes that unrepeatable
    // (and takes a query off every sign-in).
    const { isOnboarded } = await import("@/features/onboarding/server/service");
    vi.mocked(isOnboarded).mockClear();
    await callbackDestination("?code=abc&redirectTo=%2Fjoin%2Ftok_x");
    expect(isOnboarded).not.toHaveBeenCalled();
  });
});

// ── 2. The middleware, on the URL shape the old callback emitted ─────────────

describe("the retirement carries a validated redirectTo off /onboarding", () => {
  beforeEach(() => {
    state.claims = { sub: "user-1" };
  });

  it.each(DEEP_LINKS)("%s survives the retirement hop", async (_label, target) => {
    // BELT AND SUSPENDERS. Nothing in the tree emits this URL any more — the
    // callback was its only producer — but a 302 already in flight when the
    // deploy landed, or a bookmark, still arrives, and the difference between
    // honouring it and dropping it is one line in the map.
    expect(await proxyLocation(`/onboarding?redirectTo=${encodeURIComponent(target)}`)).toBe(
      target
    );
  });

  it("still lands a bare /onboarding on the download page", async () => {
    expect(await proxyLocation("/onboarding")).toBe(LANDING);
    expect(await proxyLocation("/onboarding?step=survey")).toBe(LANDING);
  });

  it.each([
    ["an absolute URL", "https://evil.example/x"],
    ["a protocol-relative URL", "//evil.example/x"],
    ["the backslash variant browsers mis-parse", "/\\evil.example"],
    ["a bare word", "canvas"],
    ["a scheme", "javascript:alert(1)"],
  ])("refuses %s and falls to the landing", async (_label, hostile) => {
    // The carry-through reuses `explicitPostAuthTarget`, so the middleware's
    // answer to a crafted value is the SAME answer the login bounce gives:
    // it is not a destination, it is an attack, and rejection is total.
    // `proxyLocation` throws on any off-origin `Location`, so this asserts
    // twice.
    expect(await proxyLocation(`/onboarding?redirectTo=${encodeURIComponent(hostile)}`)).toBe(
      LANDING
    );
  });

  it("cannot be made to loop, however the value is nested", () => {
    // Each hop hands back a value that was ENCODED inside the previous URL, so
    // the string strictly shortens and the chain has to bottom out. Walked on
    // the pure map so the assertion is about the map, not about a browser.
    let url = "/onboarding?redirectTo=%2Fonboarding%3FredirectTo%3D%2Fonboarding";
    const seen = new Set<string>();
    for (let hop = 0; hop < 8; hop++) {
      expect(seen.has(url), `revisited ${url}`).toBe(false);
      seen.add(url);
      const [pathname, search = ""] = url.split(/(?=\?)/);
      const next = retirementRedirect(pathname, search);
      if (next === null) return;
      url = next;
    }
    throw new Error("the /onboarding carry-through did not settle");
  });
});

// ── 3. The walk — the assertion the two commits between them lost ────────────

describe("end to end: sign in on a deep link, arrive at the deep link", () => {
  it.each(DEEP_LINKS)("%s", async (_label, target) => {
    expect(await signInAndFollow(`?code=abc&redirectTo=${encodeURIComponent(target)}`)).toBe(
      target
    );
  });

  it("a PLAIN first-run signup still lands on the download page", async () => {
    // Unchanged by F-136 and load-bearing: the account is captured, the next
    // thing the user needs is the dmg, and onboarding happens after the
    // install. No deep link means nothing was interrupted.
    expect(await signInAndFollow("?code=abc")).toBe(LANDING);
  });

  it("a hostile redirectTo lands there too, never off-origin", async () => {
    expect(await signInAndFollow("?code=abc&redirectTo=https%3A%2F%2Fevil.example")).toBe(LANDING);
    expect(await signInAndFollow("?code=abc&redirectTo=%2F%2Fevil.example")).toBe(LANDING);
  });

  it("the DESKTOP arrival is untouched — it never sees any of this", async () => {
    // `?desktop=1` branches before the landing is read, and the app onboards
    // its own users. Pinned here because F-136 is a change to the branch
    // immediately below that one.
    expect(await signInAndFollow("?code=abc&desktop=1&state=n")).toBe(
      "/auth/desktop-handoff?state=n"
    );
  });
});
