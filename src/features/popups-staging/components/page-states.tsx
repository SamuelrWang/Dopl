// STAGING COPY of apps/desktop-ui/src/components/page-states.tsx (tree of 2026-10-26). Only import paths differ from the source
// (react-router and `#/lib/api` → stubs / the shared client). See src/features/popups-staging/PORTING.md.
import { useRouteError } from "@/features/popups-staging/stubs/desktop-shell";
import { PageError } from "@/shared/ui/page-error";
import { PageShellSkeleton, TwoPaneListSkeleton } from "@/shared/ui/skeleton";
import { ApiError } from "@/shared/api/api-client";

export { PageError };

/**
 * The two states every page renders besides its content, plus the router-level
 * boundary behind them. Ported pages use THESE — no per-feature spinner, no
 * per-feature error copy (ENGINEERING §12: fail loudly, once, in one voice).
 *
 *   isPending → <PageLoading />
 *   error     → <PageError error={error} onRetry={refetch} />
 *
 * The error copy is `userFacingMessage` (never raw error text), and every
 * error state offers Reload, which reloads the whole app.
 *
 * ⚠ `PageLoading` must render a SHAPE, never a line of text. A cold Channels
 * launch crosses FIVE of these back to back (boot ×3, shell, page access gate);
 * ONE `.page-float` skeleton across the whole chain reads as a single steady
 * surface resolving, where text reads as five flickers in five positions. The
 * lever for a warm start is skipping the pending state, not emptying it.
 *
 * `variant`:
 *   "page"     — generic single-surface page (default; also the boot chain)
 *   "two-pane" — list + detail, for channels/chats/knowledge/skills/members
 */
export function PageLoading({
  label = "Loading",
  variant = "page",
}: {
  label?: string;
  variant?: "page" | "two-pane";
}) {
  return variant === "two-pane" ? (
    <TwoPaneListSkeleton label={label} />
  ) : (
    <PageShellSkeleton label={label} />
  );
}

/**
 * 401 from any surface = the session is gone; screens route it to the
 * signed-out view, never to a generic error. THE definition — boot and shell
 * alike; do not fork a private copy.
 *
 * ⚠ 403 is deliberately NOT signed-out. The SPA authenticates with a session
 * JWT, so the only 403s this API mints (SESSION_REQUIRED /
 * WRITE_SCOPE_REQUIRED, both OAuth-agent-only) cannot reach it, and a genuine
 * authorization failure is an error to show, not a reason to throw the user at
 * the login screen — workspace-route access denial is already collapsed to 404.
 */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Router `errorElement` — catches render/loader throws under the app layout. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  return (
    <div className="page-float flex flex-1 flex-col">
      <PageError error={error} />
    </div>
  );
}
