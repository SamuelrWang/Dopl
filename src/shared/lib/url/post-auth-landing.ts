import { safeRedirect } from "./safe-redirect";

/**
 * WHERE A COMPLETED WEB SIGN-IN LANDS — and, more usefully, the one place that
 * decides whether the URL asked for somewhere in particular at all.
 *
 * Dopl is a desktop app. The landing page's single CTA is "Get Started", which
 * is `/login`, and the point of routing a download through an account is that
 * the account exists BEFORE the install: a signup that never finishes installing
 * is then a recoverable one, and signup → download → first-open is a funnel with
 * three measurable hops instead of a click into a dmg.
 *
 * So a PLAIN web sign-in — one whose URL carries no `?redirectTo=` — lands on
 * `/get-started`, the post-auth download page, instead of `/canvas`.
 *
 * WHAT THIS DELIBERATELY DOES NOT TOUCH:
 *   • THE DESKTOP OAUTH HANDOFF. `/auth/desktop-start` → provider →
 *     `/auth/callback?desktop=1` → `/auth/desktop-handoff` → `dopl://auth` never
 *     consults this module: the callback branches on `desktop=1` BEFORE the
 *     landing is read. The app's own sign-in must end in the app, not on a page
 *     telling it to download itself.
 *   • ANY EXPLICIT TARGET. `/oauth/authorize`, `/invite/<token>`, `/join/<token>`
 *     and the middleware's own bounce all push `/login?redirectTo=…`; every one
 *     of them still returns to exactly where it came from.
 *
 * WHY A SEPARATE FUNCTION FROM `safeRedirect` AND NOT A CHANGED DEFAULT.
 * `safeRedirect`'s `/canvas` default is also read by `/onboarding` and by
 * `POST /api/onboarding/complete` (which passes its own fallback), and those are
 * "where does the app live" questions, not "where does a sign-in end" questions.
 * Moving the default would have answered both with one value and coupled two
 * decisions that are about to diverge — `/canvas` is on the retirement plan's
 * RETIRE list, `/get-started` is its replacement destination.
 */

/**
 * The post-auth download page. Also the retirement plan's Stage B destination
 * for a signed-in visitor to a retired app route (docs/migration-research/
 * website-retirement-plan.md §2.2) — one page, both audiences, because both are
 * being told the same thing: Dopl lives on your desktop now.
 */
export const WEB_POST_AUTH_LANDING = "/get-started";

/**
 * The target the URL actually ASKED for, or `null` when it asked for nothing
 * usable. A hostile value ("https://evil.example", "//evil.example") is not a
 * request — it is an attack — so it reads as `null` rather than as "somewhere":
 * rejection is TOTAL, and a crafted `redirectTo` therefore cannot steer any
 * branch that hangs off "did this URL name a destination", only fail to steer
 * the URL. Its callers are the middleware's signed-in `/login` bounce, the
 * `/onboarding` retirement carry-through, and `webPostAuthDestination` below.
 */
export function explicitPostAuthTarget(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // `safeRedirect` never returns "" for input it accepts (an accepted value
  // starts with "/", so its pathname is at least "/"), which makes the empty
  // string a safe sentinel for "rejected".
  const validated = safeRedirect(raw, "");
  return validated === "" ? null : validated;
}

/** The explicit target if there is one, otherwise the download page. */
export function webPostAuthDestination(raw: string | null | undefined): string {
  return explicitPostAuthTarget(raw) ?? WEB_POST_AUTH_LANDING;
}
