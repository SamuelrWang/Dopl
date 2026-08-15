import { useRouteError } from "react-router";
import { PageShellSkeleton, TwoPaneListSkeleton } from "@/shared/ui/skeleton";
import { ApiError } from "#/lib/api";

/**
 * The two states every page renders besides its content, plus the router-level
 * boundary behind them. Ported pages use THESE — no per-feature spinner, no
 * per-feature error copy (ENGINEERING §12: fail loudly, once, in one voice).
 *
 *   isPending → <PageLoading />
 *   error     → <PageError error={error} onRetry={refetch} />
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

/** Human copy for anything thrown by `apiRequest` (ApiError) or the transport. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function PageError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3" role="alert">
      <p className="text-body text-text-primary">{errorMessage(error)}</p>
      {onRetry ? (
        <button type="button" className="btn-light text-small px-3 py-1" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Router `errorElement` — catches render/loader throws under the app layout. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  return (
    <div className="page-float flex flex-1 flex-col">
      <PageError error={error} onRetry={() => window.location.reload()} />
    </div>
  );
}
