/** Static copy for the landing page (Lattice reference clone). */

export const BRAND = "Dopl";

export const NAV_LINKS = ["Product", "Services", "Career", "Pricing", "About"] as const;

/**
 * THE LANDING PAGE HAS ONE CALL TO ACTION, AND IT NOW GOES THROUGH THE ACCOUNT.
 *
 * It was "Download", pointing straight at the dmg: the login buttons had already
 * left the page, because Dopl is a desktop app and the web app is being retired
 * (docs/migration-research/website-retirement-plan.md). This is the next move,
 * not a reversal of that one — the button is still ONE button, it just captures
 * the account first (the Wispr Flow pattern):
 *
 *   Get Started → /signup (create the account) → /get-started (the dmg starts
 *   downloading, with install steps) → open the app → sign in there.
 *
 * WHY THE EXTRA HOP IS WORTH IT. A download that begins at an anonymous click is
 * unmeasurable and unrecoverable: nobody knows whether the installer was ever
 * opened, and there is no address to follow up on when it wasn't. An account
 * created BEFORE the download makes install drop-off a thing you can see and
 * write to, and turns the funnel into three countable hops. The user signs in
 * once more inside the app afterwards, which they were always going to do.
 *
 * `/download` IS STILL THE DOWNLOAD, and still public. `/get-started` uses it —
 * it is the stable, README-able, tweetable path and nothing about it changed.
 */
export const GET_STARTED_LABEL = "Get Started";

/**
 * Where "Get Started" goes — `/signup`, which is a REAL ROUTE now
 * (`src/app/signup/page.tsx`) and not `/login` opened on a signup mode.
 *
 * This used to say there was no separate `/signup` and no mode param to pass,
 * because `/login` carried both flows behind an in-place toggle. Two routes
 * over the one form is the shape now: the URL names the flow, "Get Started"
 * lands on the one that creates an account, and the switch under the submit
 * button navigates to the other. Everything that bounces an EXISTING account
 * (the middleware, `/auth/callback`, reset-password, the OAuth consent page)
 * still points at `/login`.
 *
 * `signup` is back in RESERVED_WORKSPACE_SLUGS (`config/index.ts`) — the audit
 * that removed it (S-13) said to re-add it the day a public signup page landed.
 */
export const GET_STARTED_URL = "/signup";

export const MENU_LABEL = "Menu";

export const HERO = {
  /** Rendered as two lines, matching the reference line break. */
  headlineLines: ["Workspaces to Bridge", "Agents and Teams"] as const,
  subhead:
    "We bring ideas to life by combining years of experiences of our very talented team.",
  primaryCta: GET_STARTED_LABEL,
} as const;

/**
 * The download, as a stable same-origin path. No longer a landing-page CTA —
 * `/get-started` is what fires it now, on mount and from its retry link.
 *
 * This was a hardcoded github.com URL naming a `Dopl-arm64.dmg` asset that has
 * never existed — electron-builder stamps the version into the file name, so the
 * button 404'd. `src/app/download/route.ts` resolves the real asset out of the
 * release feed and redirects; `src/shared/version/mac-download.ts` is the why.
 */
export const DOWNLOAD_URL = "/download";

