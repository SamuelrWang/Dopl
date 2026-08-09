import { useRouteError } from "react-router";
import { PageShellSkeleton, TwoPaneListSkeleton } from "@/shared/ui/skeleton";
import { ApiError } from "#/lib/api";

/**
 * The two states every page renders besides its content, and the router-level
 * boundary behind them. Ported pages use THESE — no per-feature spinner, no
 * per-feature error copy (ENGINEERING §12: fail loudly, once, in one voice).
 *
 *   isPending → <PageLoading />
 *   error     → <PageError error={error} onRetry={refetch} />
 *
 * `PageLoading` renders a SHAPE, not a line of text.
 *
 * It used to be one grey `<span>`, and the comment here justified that with a
 * main-process read cache that would make a skeleton flash "the bug, not the
 * feature". That cache was never built — the SQLite half of Phase 2/3 is still
 * unwritten — so every launch was a genuine cold fetch over IPC and the
 * justification described infrastructure that did not exist. A cold launch of
 * Channels crosses FIVE of these states back to back (boot ×3, the shell, then
 * the page's own access gate); as bare text that was five flickers of grey
 * copy in five different positions.
 *
 * The IndexedDB persister that DID land (`#/lib/query-client`
 * `createQueryPersister`) does not bring the old argument back, for two
 * reasons. A restored snapshot means the pending state is never ENTERED — a
 * skeleton that doesn't render costs nothing — and restore is itself async and
 * bounded (`maxAge`, `buster`, success-only dehydration), so a first launch, a
 * bumped buster, a day-old cache and a runtime with no IndexedDB all still
 * land here. The right lever for a warm start is to skip the pending state,
 * never to make it emptier.
 *
 * Rendering ONE `.page-float` skeleton across the whole chain is the point:
 * five sequential pending states read as a single steady surface whose
 * contents resolve, instead of five separate flashes.
 *
 * `variant` picks the shape:
 *   "page"     — the generic single-surface page (default; also the boot chain)
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
