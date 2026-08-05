import { BILLING_SURFACE_ROOT } from "@/features/billing/url";
import { parseSegment } from "./parse-segment";
import { WEB_POST_AUTH_LANDING } from "./post-auth-landing";

/**
 * STAGE B OF THE WEBSITE RETIREMENT — the redirect map, and nothing else.
 * `docs/migration-research/website-retirement-plan.md` §2.1.
 *
 * Dopl's product UI ships inside the desktop app. The web `[workspaceSlug]`
 * tree is the same product rendered a second time, and the plan retires it in
 * four stages, of which this is the second: A built the replacements (the
 * billing page, `/get-started`), B stops serving the pages, C raises the
 * desktop version floor, D deletes code. **B DELETES NOTHING.** Every retired
 * page is still in the tree, still builds, still renders the moment the flag
 * is off — which is what makes the rollback an env var rather than a revert.
 *
 * WHY A MAP AND NOT `notFound()` OR A 410. These URLs were session-gated their
 * whole lives: a signed-out visitor was always bounced to `/login`, so no search
 * engine ever indexed one and there is no SEO debt a 410 would pay down. The two
 * real inbound populations are BOOKMARKS and SHIPPED DESKTOP BUILDS, and both are
 * better served by landing somewhere that explains itself.
 *
 * THE MAP IS PURE AND THE FLAG IS READ SEPARATELY, so the middleware can prove
 * both states in tests without touching the environment, and so the one function
 * that decides where a URL goes has no way to also decide whether it goes.
 */

/**
 * Where every retired page lands. `/get-started` was built for the post-signup
 * download and doubles as the retirement page on purpose (see its header
 * comment and `post-auth-landing.ts`): same audience state — signed in — and
 * the same sentence to say, which is that Dopl lives on your desktop now. A
 * second `/retired` page would have drifted from it within a release.
 */
export const RETIREMENT_LANDING = WEB_POST_AUTH_LANDING;

/**
 * THE OFF SWITCH IS AN EXPLICIT VALUE, NEVER AN ABSENT ONE — retired is the
 * default and unset means retired.
 *
 * The flag can only be changed in the Vercel dashboard, so the state that must
 * be free to reach is the one an operator reaches by DELETING the variable, and
 * that has to be the safe direction: a lost env var, a fresh preview deployment
 * or a restored project must not quietly un-retire the website. Turning the web
 * app back on is the deliberate act, and it costs one keystroke.
 *
 * Three spellings of "off" are honoured because this is an incident lever typed
 * under pressure, and a rollback that silently does nothing because someone
 * wrote `false` instead of `0` is worse than a rollback that is slightly loose.
 */
const OFF_VALUES = new Set(["0", "false", "off"]);

export const WEBSITE_RETIRED_ENV = "WEBSITE_RETIRED";

/** Read PER REQUEST (`env` is injectable for tests, exactly as
 *  `resolveDesktopFloor` does it) — never captured at module load, so the flip
 *  needs no code change and no cached state can outlive it. */
export function isWebsiteRetired(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[WEBSITE_RETIRED_ENV];
  if (typeof raw !== "string") return true;
  return !OFF_VALUES.has(raw.trim().toLowerCase());
}

/**
 * The `(app)` route table, verbatim from `src/app/[workspaceSlug]/(app)/`.
 * Naming the pages — rather than retiring "any second segment" — is what keeps
 * this from swallowing a route nobody has written yet. Detail routes
 * (`knowledge/[kbSlug]`, `ontology/[clusterSlug]`, `skills/[skillSlug]`,
 * `workflows/[workflowSlug]`) ride the same names one level deeper.
 */
const APP_PAGES = new Set([
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
]);

/**
 * Top-level route names that are NOT workspace segments. `[workspaceSlug]` is a
 * root-level dynamic segment, so every one of these would otherwise read as a
 * workspace — `/pricing` is `/{segment}` as far as a pattern is concerned. This
 * is the KEEP list expressed as a guard: landing, auth, OAuth, invites, joins,
 * billing, admin, download, the legal pages, and the whole API.
 *
 * `canvas` and `onboarding` are deliberately absent: they ARE retired, by the
 * exact-match rule below.
 */
const RESERVED_TOP_LEVEL = new Set([
  "_next",
  ".well-known",
  "admin",
  "api",
  "auth",
  "billing",
  "download",
  "favicon.ico",
  "get-started",
  "invite",
  "join",
  "login",
  "oauth",
  "pricing",
  "privacy",
  "terms",
]);

/** The two top-level pages that retire outright. */
const RETIRED_TOP_LEVEL = new Set(["canvas", "onboarding"]);

/**
 * The pages the money used to arrive on. `billingPath()` built
 * `/{segment}/canvas?billing=…` until the D1 repoint, and `canvas2` shared the
 * settings modal that read the param (plan §2.1 names both).
 */
const BILLING_INBOUND_PAGES = new Set(["canvas", "canvas2"]);

/**
 * What may be pasted into `/billing/{segment}` unescaped. Workspace segments are
 * `{slug}-{publicId}` with a lowercase-alphanumeric slug, and the middleware has
 * already 308'd any mixed-case page path to lowercase before this runs. Anything
 * else — percent-escapes, dots, slashes-as-escapes, a leading slash that would
 * make the Location protocol-relative — is not a segment, and the answer is the
 * SEGMENT-LESS billing page rather than a rejection: it resolves the caller's
 * default workspace, so a mangled bookmark still reaches a payment surface.
 */
const SEGMENT_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

function billingDestination(segment: string | null, search: string): string {
  const base =
    segment && SEGMENT_SHAPE.test(segment)
      ? `${BILLING_SURFACE_ROOT}/${segment}`
      : BILLING_SURFACE_ROOT;
  return `${base}${search}`;
}

/**
 * Where a retired URL goes, or `null` if the URL is not retired at all — which
 * is the answer for every KEEP route, every `/api/**`, and anything unrecognised.
 *
 * `search` is forwarded VERBATIM on the billing rewrites and DROPPED on the
 * generic ones. Both are deliberate: a Stripe return carries `session_id` and
 * `billing`, which the billing page needs in full (and which no builder here
 * could reconstruct); a retired canvas URL's `?tab=` means nothing to a download
 * page and would only survive as noise.
 */
export function retirementRedirect(pathname: string, search: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null; // `/` — the landing page. KEEP.

  const [first, second] = segments;
  if (RESERVED_TOP_LEVEL.has(first)) return null;

  // ── THE LEGACY BILLING INBOUND, BEFORE ANYTHING ELSE ──────────────────────
  //
  // `/{segment}/canvas?billing=…` is still being produced by three things this
  // deploy cannot reach: desktop builds ≤ 1.8.5, whose `open-in-browser.ts`
  // pointed there until the D1 repoint and which auto-update on their own
  // schedule; Stripe `return_url`s baked into every checkout session created
  // before the repoint deployed; and bookmarks. Sending those to a download page
  // loses a payment mid-flight, which is the one failure mode of this whole
  // retirement that costs money rather than a click. So the money is rewritten
  // to the surface that still handles it, query intact, and only then does the
  // generic redirect get a look.
  //
  // The PRESENCE of `billing` is the test, not its value: `parseBillingIntent`
  // on the page is the authority on which values mean something, and a bookmark
  // carrying `?billing=` with junk after it is still someone trying to pay.
  if (new URLSearchParams(search).has("billing")) {
    if (segments.length === 1 && first === "canvas") {
      // The segment-less legacy landing — Stripe returns and 402 envelopes
      // predating the segment-aware builder. `/billing` resolves the default
      // workspace, which is the same job `/canvas` was doing for them.
      return billingDestination(null, search);
    }
    if (segments.length === 2 && BILLING_INBOUND_PAGES.has(second)) {
      return billingDestination(first, search);
    }
  }

  // ── THE GENERIC RETIRED SET ───────────────────────────────────────────────

  // `/canvas` and `/onboarding` with no billing intent: plain retired pages.
  if (segments.length === 1 && RETIRED_TOP_LEVEL.has(first)) {
    return RETIREMENT_LANDING;
  }

  // `/{segment}/{page}` and the detail routes below it.
  if (segments.length >= 2 && APP_PAGES.has(second)) {
    return RETIREMENT_LANDING;
  }

  // The bare workspace page, `/{segment}` — which in the tree is a redirect into
  // canvas. Only a CANONICAL `{slug}-{publicId}` segment qualifies: a bare
  // single segment is otherwise indistinguishable from a top-level route that
  // does not exist yet, and retiring those would make this the 404 handler for
  // the whole site a stage early. A legacy slug-only workspace URL therefore
  // renders as today and retires one hop later, when its own redirect lands on
  // `/{canonical-segment}/canvas`.
  if (segments.length === 1 && parseSegment(first)) {
    return RETIREMENT_LANDING;
  }

  return null;
}
