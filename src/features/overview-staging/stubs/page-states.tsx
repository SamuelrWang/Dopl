"use client";

/**
 * STAGING COPY of `apps/desktop-ui/src/components/page-states.tsx › PageError`. "Reload" re-runs
 * the stubbed read instead of reloading the window.
 */
export function PageError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3" role="alert">
      <p className="text-body text-text-primary">{message}</p>
      <div className="flex items-center gap-2">
        {onRetry ? (
          <button type="button" className="btn-light text-small px-3 py-1" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        <button type="button" className="btn-light text-small px-3 py-1" onClick={onRetry}>
          Reload
        </button>
      </div>
    </div>
  );
}
