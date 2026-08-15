/** Static landing-page copy. */

export const BRAND = "Dopl";

export const NAV_LINKS = ["Product", "Services", "Career", "Pricing", "About"] as const;

/**
 * Page has exactly ONE CTA. Funnel: Get Started → `/signup` → `/get-started`
 * (fires dmg + install steps) → sign in in-app. Account before download, so
 * install drop-off is measurable.
 */
export const GET_STARTED_LABEL = "Get Started";

/**
 * Route: `src/app/signup/page.tsx`. NEW accounts only — middleware,
 * `/auth/callback`, reset-password and OAuth consent bounce existing accounts
 * to `/login`. ⚠ `signup` must stay in RESERVED_WORKSPACE_SLUGS
 * (`config/index.ts`) or a workspace can claim it.
 */
export const GET_STARTED_URL = "/signup";

export const MENU_LABEL = "Menu";

export const HERO = {
  /** One array entry = one rendered line. */
  headlineLines: ["Workspaces to Bridge", "Agents and Teams"] as const,
  subhead:
    "Dopl is the digital office that powers collaborative agents operated by humans.",
  primaryCta: GET_STARTED_LABEL,
} as const;

/**
 * ⚠ Same-origin path, never a github.com dmg URL: electron-builder stamps the
 * version into the asset name, so any hardcoded name 404s.
 * `src/app/download/route.ts` resolves from the release feed + redirects
 * (`src/shared/version/mac-download.ts`). Fired by `/get-started`.
 */
export const DOWNLOAD_URL = "/download";

