import { useRouteError } from "react-router";
import { ApiError } from "#/lib/api";

/**
 * The two states every page renders besides its content, and the router-level
 * boundary behind them. Ported pages use THESE — no per-feature spinner, no
 * per-feature error copy (ENGINEERING §12: fail loudly, once, in one voice).
 *
 *   isPending → <PageLoading />
 *   error     → <PageError error={error} onRetry={refetch} />
 *
 * `PageLoading` is deliberately quiet rather than a skeleton: once the main
 * process serves reads from its local cache (Phase 2/3), a first paint that
 * flashes a skeleton is the bug, not the feature.
 */

export function PageLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="flex flex-1 items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <span className="text-caption text-text-muted">{label}…</span>
    </div>
  );
}

/**
 * A 401 from any surface means ONE thing in the desktop app: the session is
 * gone. Screens route it to the signed-out view, never to a generic error.
 *
 * THE definition, for boot and for the shell alike. Boot carried a private
 * copy that also treated 403 as signed-out; the two answered differently under
 * one name, and the last person to "share" this helper edited boot without
 * noticing its twin (2026-08-03 fleet audit, duplication-quality). 403 is
 * deliberately NOT signed-out: the desktop SPA authenticates with a session
 * JWT, so the only 403s this API mints (SESSION_REQUIRED / WRITE_SCOPE_REQUIRED,
 * both OAuth-agent-only) cannot reach it, and a genuine authorization failure
 * is an error to show, not a reason to throw the user at the login screen —
 * access denial on the workspace routes is already collapsed to 404.
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
