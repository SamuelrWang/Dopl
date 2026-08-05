/**
 * WEBSITE RETIREMENT, STAGE B — THE LEGACY BILLING INBOUND.
 * `docs/migration-research/website-retirement-plan.md` §2.1, §2.3, risk R1.
 *
 * This is the one part of the retirement that costs money when it is wrong.
 *
 * `/{segment}/canvas?billing=…` and `/canvas?billing=…` are STILL BEING
 * PRODUCED, by three things no deploy can reach:
 *
 *   • shipped desktop builds ≤ 1.8.5, whose `open-in-browser.ts` built
 *     `/{segment}/canvas?billing=upgrade` until the D1 repoint, and which
 *     auto-update on electron-updater's own 4h-and-on-quit schedule;
 *   • Stripe `return_url`s baked into every checkout and portal session created
 *     before that repoint deployed — a payment already in flight at the flip;
 *   • bookmarks, and the 402/403 `upgrade_url` envelopes API-first clients
 *     (MCP agents included) follow literally.
 *
 * Landing those on `/get-started` would drop a payer on a download page with no
 * plan in sight. So the middleware rewrites them to the surviving billing
 * surface with the FULL query preserved, BEFORE the generic retired redirect
 * gets a look — and a `/canvas` URL with no `billing` param is just a retired
 * page, because nothing about it is a purchase.
 *
 * The suite drives the REAL `proxy()` and the REAL map.
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
const LANDING = "/get-started";

function req(path: string) {
  return new NextRequest(new URL(path, ORIGIN));
}

function signedIn() {
  state.claims = { sub: "user-1" };
}

/** The `Location` of a proxy response, origin stripped. */
async function location(path: string): Promise<string | null> {
  const raw = (await proxy(req(path))).headers.get("location");
  return raw ? raw.slice(ORIGIN.length) : null;
}

beforeEach(() => {
  state.claims = null;
  vi.unstubAllEnvs();
  vi.stubEnv(WEBSITE_RETIRED_ENV, undefined); // retired: the default
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});

// ── The rewrite table ────────────────────────────────────────────────────────

describe("legacy billing URLs are rewritten, never landed on /get-started", () => {
  beforeEach(signedIn);

  it.each([
    // [what still produces it, incoming, destination]
    [
      "desktop ≤1.8.5 Upgrade",
      `/${SEGMENT}/canvas?billing=upgrade`,
      `/billing/${SEGMENT}?billing=upgrade`,
    ],
    [
      "desktop Upgrade with a plan already chosen",
      `/${SEGMENT}/canvas?billing=upgrade&plan=team`,
      `/billing/${SEGMENT}?billing=upgrade&plan=team`,
    ],
    [
      "the canvas2 alias (plan §2.1)",
      `/${SEGMENT}/canvas2?billing=upgrade`,
      `/billing/${SEGMENT}?billing=upgrade`,
    ],
    [
      "a pre-repoint Stripe checkout return_url",
      "/canvas?billing=success&session_id=cs_test_a1b2",
      "/billing?billing=success&session_id=cs_test_a1b2",
    ],
    [
      "a pre-repoint Stripe portal return_url",
      "/canvas?billing=return",
      "/billing?billing=return",
    ],
    [
      "a pre-repoint 402 upgrade_url envelope",
      "/canvas?billing=upgrade",
      "/billing?billing=upgrade",
    ],
    [
      "an unsubstituted Stripe session template",
      "/canvas?billing=success&session_id=%7BCHECKOUT_SESSION_ID%7D",
      "/billing?billing=success&session_id=%7BCHECKOUT_SESSION_ID%7D",
    ],
    [
      "a bookmark carrying params nobody here knows about",
      `/${SEGMENT}/canvas?billing=success&session_id=cs_1&utm_source=mail`,
      `/billing/${SEGMENT}?billing=success&session_id=cs_1&utm_source=mail`,
    ],
    [
      "an empty intent — still someone trying to pay",
      `/${SEGMENT}/canvas?billing=`,
      `/billing/${SEGMENT}?billing=`,
    ],
    [
      "junk in the intent — `parseBillingIntent` on the page is the authority",
      `/${SEGMENT}/canvas?billing=%3Cscript%3E`,
      `/billing/${SEGMENT}?billing=%3Cscript%3E`,
    ],
  ])("%s: %s → %s", async (_label, from, to) => {
    expect(await location(from)).toBe(to);
  });

  it("preserves the query BYTE FOR BYTE, because Stripe's substitution does", () => {
    // `{CHECKOUT_SESSION_ID}` is substituted by Stripe only when it arrives
    // unencoded, which is why the billing URL builder concatenates rather than
    // running the query through URLSearchParams — and why this forwards the raw
    // search string instead of re-serialising it.
    const search = "?billing=success&session_id={CHECKOUT_SESSION_ID}&x=a+b%20c";
    expect(retirementRedirect("/canvas", search)).toBe(`/billing${search}`);
  });

  it.each([
    ["/canvas", LANDING],
    [`/${SEGMENT}/canvas`, LANDING],
    [`/${SEGMENT}/canvas2`, LANDING],
    // Desktop ≤1.8.5's "Delete account in browser" opened this bare URL
    // (plan §2.3). It is a plain retired page by the Stage B map, so those
    // builds lose the browser account pane until they update — a known,
    // accepted cost. Money was the flow that had to be protected.
    [`/${SEGMENT}/canvas?tab=account`, LANDING],
    [`/${SEGMENT}/settings?billing=upgrade`, LANDING],
  ])("%s carries no billing intent, so it is a plain retired page → %s", async (from, to) => {
    expect(await location(from)).toBe(to);
  });

  it("rewrites BEFORE the generic redirect — the query is the only difference", () => {
    expect(retirementRedirect(`/${SEGMENT}/canvas`, "?billing=upgrade")).toBe(
      `/billing/${SEGMENT}?billing=upgrade`
    );
    expect(retirementRedirect(`/${SEGMENT}/canvas`, "")).toBe(LANDING);
  });

  it("does not fire at all with the flag OFF", async () => {
    signedIn();
    vi.stubEnv(WEBSITE_RETIRED_ENV, "0");
    const res = await proxy(req(`/${SEGMENT}/canvas?billing=upgrade`));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("survives the signed-out round trip a first-time payer makes", async () => {
    const entry = `/${SEGMENT}/canvas?billing=upgrade&plan=solo`;

    // 1. No session — the population this flow exists for, whose browser has by
    //    definition never signed in: bounced to /login carrying the ORIGINAL
    //    url, query included, exactly as before the retirement.
    state.claims = null;
    expect(await location(entry)).toBe(
      `/login?redirectTo=${encodeURIComponent(entry)}`
    );

    // 2. The login form returns the browser to it — and THAT request is the one
    //    the rewrite catches, with the checkout intent still on it.
    signedIn();
    expect(await location(entry)).toBe(
      `/billing/${SEGMENT}?billing=upgrade&plan=solo`
    );
  });
});

// ── Hostile junk in the segment ──────────────────────────────────────────────

describe("a hostile segment cannot forge the billing destination", () => {
  beforeEach(signedIn);

  it.each([
    ["a percent-escaped traversal", "/%2e%2e%2fevil/canvas?billing=upgrade"],
    ["a host-shaped segment", "/evil.example/canvas?billing=upgrade"],
    ["an at-sign credential trick", "/user@evil.example/canvas?billing=upgrade"],
    ["a colon scheme fragment", "/https:/canvas?billing=upgrade"],
    ["an underscore-and-dot mash", "/a_b.c/canvas?billing=upgrade"],
  ])("%s falls back to the segment-less /billing", async (_l, from) => {
    // Anything that is not a workspace segment is never pasted into the URL,
    // and the fallback is a page rather than a refusal: `/billing` resolves the
    // caller's default workspace, so a mangled bookmark still reaches a payment
    // surface. Nothing about the junk reaches the Location.
    const res = await proxy(req(from));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/billing?billing=upgrade`);
  });

  it("an encoded slash is canonicalized away before the map ever sees it", async () => {
    // `%2F` carries an uppercase letter, so the S-8 lowercase 308 fires first.
    // The map's own answer for it is the segment-less fallback either way.
    const res = await proxy(req("/a%2Fb/canvas?billing=upgrade"));
    expect(res.status).toBe(308);
    expect(retirementRedirect("/a%2fb/canvas", "?billing=upgrade")).toBe(
      "/billing?billing=upgrade"
    );
  });

  it("a traversal URL parsing FLATTENS is just an ordinary segment", () => {
    // `/../evil/canvas` is `/evil/canvas` by the time anything reads it, so the
    // question is not whether the traversal escapes — it cannot — but whether
    // the result stays on this origin under /billing. It does; `evil` resolves
    // to no workspace and the page handles that.
    expect(retirementRedirect("/evil/canvas", "?billing=upgrade")).toBe(
      "/billing/evil?billing=upgrade"
    );
  });

  it("never emits a protocol-relative or off-origin destination", () => {
    for (const junk of [
      "//evil.example",
      "/\\evil.example",
      "%2F%2Fevil",
      "evil.example:443",
      "..",
      "",
    ]) {
      const to = retirementRedirect(`/${junk}/canvas`, "?billing=upgrade");
      if (to === null) continue;
      expect(to.startsWith("/billing"), to).toBe(true);
      expect(to.startsWith("//"), to).toBe(false);
      expect(new URL(to, ORIGIN).origin, to).toBe(ORIGIN);
    }
  });
});
