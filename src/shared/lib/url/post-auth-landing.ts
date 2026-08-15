import { safeRedirect } from "./safe-redirect";

/**
 * Where a completed WEB sign-in lands, and the one place that decides whether a
 * URL asked for somewhere in particular at all. A plain sign-in (no
 * `?redirectTo=`) lands on the post-auth download page.
 *
 * ⚠ Deliberately NOT consulted by the DESKTOP OAUTH HANDOFF
 * (`/auth/desktop-start` → provider → `/auth/callback?desktop=1` →
 * `/auth/desktop-handoff` → `dopl://auth`): the callback branches on `desktop=1`
 * BEFORE the landing is read. Any EXPLICIT target still returns to where it came
 * from.
 *
 * ⚠ Separate from `safeRedirect`'s `/canvas` default rather than changing it —
 * that default answers "where does the app live", also read by `/onboarding` and
 * `POST /api/onboarding/complete`. The two decisions diverge: `/canvas` is on
 * the retirement RETIRE list.
 */

/** The post-auth download page; also the retirement destination for a signed-in
 *  visitor to a retired app route. One page, both audiences. */
export const WEB_POST_AUTH_LANDING = "/get-started";

/**
 * The target the URL ASKED for, or `null` when it asked for nothing usable.
 * ⚠ Rejection is TOTAL: a hostile value ("https://evil.example",
 * "//evil.example") reads as `null`, not as "somewhere", so a crafted
 * `redirectTo` cannot steer any branch hanging off "did this URL name a
 * destination".
 */
export function explicitPostAuthTarget(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // `safeRedirect` never returns "" for accepted input (accepted values start
  // with "/"), so "" is a safe "rejected" sentinel.
  const validated = safeRedirect(raw, "");
  return validated === "" ? null : validated;
}

/** The explicit target if there is one, otherwise the download page. */
export function webPostAuthDestination(raw: string | null | undefined): string {
  return explicitPostAuthTarget(raw) ?? WEB_POST_AUTH_LANDING;
}
