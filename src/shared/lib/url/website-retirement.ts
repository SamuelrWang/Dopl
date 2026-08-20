import { BILLING_SURFACE_ROOT } from "@/features/billing/url";
import { parseSegment } from "./parse-segment";
import { WEB_POST_AUTH_LANDING, explicitPostAuthTarget } from "./post-auth-landing";

/**
 * Website-retirement redirect map, and nothing else.
 * `docs/migration-research/website-retirement-plan.md` §2.1.
 *
 * ⚠ `WEBSITE_RETIRED=0` DOES NOT RESTORE THE WEBSITE — it 404s it. The pages
 * (`src/app/[workspaceSlug]/**`, `/canvas`, `/onboarding`) were deleted; the
 * redirect is the only thing making those URLs resolve. The off switch stops
 * REDIRECTING. Restoring pages = a revert, not a flag flip.
 *
 * Map over `notFound()`/410: these URLs were always session-gated, so nothing
 * indexed them and there is no SEO debt. Real inbound is bookmarks + shipped
 * desktop builds.
 *
 * ⚠ Map stays PURE, flag read separately — so middleware can prove both states
 * in tests without touching the environment.
 */

/** Where every retired page lands — shared with the post-signup download page
 *  on purpose (same audience state, same message). */
export const RETIREMENT_LANDING = WEB_POST_AUTH_LANDING;

/**
 * ⚠ Off switch is an EXPLICIT value, never an absent one: unset means retired.
 * A lost env var / fresh preview / restored project must not un-retire the site.
 * Three spellings honoured — incident lever typed under pressure.
 */
const OFF_VALUES = new Set(["0", "false", "off"]);

export const WEBSITE_RETIRED_ENV = "WEBSITE_RETIRED";

/** ⚠ Read PER REQUEST, never captured at module load — the flip must need no
 *  redeploy and no cached state may outlive it. `env` injectable for tests. */
export function isWebsiteRetired(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[WEBSITE_RETIRED_ENV];
  if (typeof raw !== "string") return true;
  return !OFF_VALUES.has(raw.trim().toLowerCase());
}

/**
 * The retired `(app)` route table — a HISTORICAL list of URLs in the wild;
 * `src/app/[workspaceSlug]/(app)/` is deleted, so nothing on disk can confirm or
 * extend it. ⚠ Names pages explicitly rather than retiring "any second segment",
 * so it can't swallow a route nobody has written yet. Detail routes
 * (`knowledge/[kbSlug]` etc.) ride the same names one level deeper.
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
 * KEEP list: top-level route names that are NOT workspace segments.
 * `[workspaceSlug]` is a root-level dynamic segment, so each would otherwise
 * read as a workspace. ⚠ `canvas`/`onboarding` deliberately absent — they ARE
 * retired, by the exact-match rule below.
 */
const RESERVED_TOP_LEVEL = new Set([
  "_next",
  ".well-known",
  "admin",
  "api",
  "auth",
  // The one auth page; `/login` + `/signup` 307 to it (kept below).
  "authenticate",
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
  // KEEP by accident otherwise (`parseSegment` rejects a dashless single
  // segment); named explicitly so it's a rule, not an accident.
  "signup",
  "terms",
]);

/** Top-level pages that retire outright. `onboarding` reads one param on the
 *  way out (`onboardingDestination`); `canvas` reads none. */
const RETIRED_TOP_LEVEL = new Set(["canvas", "onboarding"]);

/** Pages legacy `?billing=` inbound landed on before the D1 repoint. */
const BILLING_INBOUND_PAGES = new Set(["canvas", "canvas2"]);

/**
 * ⚠ What may be pasted into `/billing/{segment}` unescaped. Anything else —
 * percent-escapes, dots, slashes-as-escapes, a leading slash that would make the
 * Location protocol-relative — falls to the SEGMENT-LESS billing page (resolves
 * the caller's default workspace) rather than being rejected.
 */
const SEGMENT_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Insurance, not a route (F-136): the generic redirect drops the query, which
 * silently deleted the deep link `/onboarding?redirectTo=…` carried (invite,
 * join, MCP OAuth consent). No producer emits this shape any more; in-flight
 * 302s and bookmarks still arrive.
 *
 * Validated by the SAME function the login bounce and callback use, so a hostile
 * `redirectTo` reads as "asked for nothing". Cannot loop: the carried value was
 * ENCODED inside the URL it came from, so it strictly shortens per hop.
 *
 * ⚠ `/canvas` deliberately does NOT get this — no producer ever put a
 * `redirectTo` on it.
 */
function onboardingDestination(search: string): string {
  const carried = new URLSearchParams(search).get("redirectTo");
  return explicitPostAuthTarget(carried) ?? RETIREMENT_LANDING;
}

function billingDestination(segment: string | null, search: string): string {
  const base =
    segment && SEGMENT_SHAPE.test(segment)
      ? `${BILLING_SURFACE_ROOT}/${segment}`
      : BILLING_SURFACE_ROOT;
  return `${base}${search}`;
}

/**
 * Where a retired URL goes, or `null` if not retired — the answer for every KEEP
 * route, every `/api/**`, and anything unrecognised.
 *
 * ⚠ `search` handling is deliberately three-way: forwarded VERBATIM on billing
 * rewrites (a Stripe return's `session_id`/`billing` can't be reconstructed),
 * READ on `/onboarding`, DROPPED on every other generic redirect.
 */
export function retirementRedirect(pathname: string, search: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null; // `/` — the landing page. KEEP.

  const [first, second] = segments;
  if (RESERVED_TOP_LEVEL.has(first)) return null;

  // ⚠ LEGACY BILLING INBOUND MUST RUN BEFORE THE GENERIC REDIRECT. Desktop
  // builds ≤ 1.8.5, Stripe `return_url`s baked into pre-repoint checkout
  // sessions, and bookmarks still produce `/{segment}/canvas?billing=…`; sending
  // those to a download page loses a payment mid-flight.
  // PRESENCE of `billing` is the test, not its value — `parseBillingIntent` on
  // the page is the authority on which values mean something.
  if (new URLSearchParams(search).has("billing")) {
    if (segments.length === 1 && first === "canvas") {
      // Segment-less legacy landing; `/billing` resolves the default workspace.
      return billingDestination(null, search);
    }
    if (segments.length === 2 && BILLING_INBOUND_PAGES.has(second)) {
      return billingDestination(first, search);
    }
  }

  // Generic retired set: `/canvas`, `/onboarding` with no billing intent.
  if (segments.length === 1 && RETIRED_TOP_LEVEL.has(first)) {
    if (first === "onboarding") return onboardingDestination(search);
    return RETIREMENT_LANDING;
  }

  // `/{segment}/{page}` and the detail routes below it.
  if (segments.length >= 2 && APP_PAGES.has(second)) {
    return RETIREMENT_LANDING;
  }

  // ⚠ Bare workspace page `/{segment}`: only a CANONICAL `{slug}-{publicId}`
  // segment qualifies. A bare single segment is otherwise indistinguishable from
  // a top-level route not yet written, and retiring those makes this the 404
  // handler for the whole site. Legacy slug-only URLs retire one hop later.
  if (segments.length === 1 && parseSegment(first)) {
    return RETIREMENT_LANDING;
  }

  return null;
}
