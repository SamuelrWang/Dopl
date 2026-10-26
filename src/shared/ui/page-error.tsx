"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";

function reloadApp(): void {
  window.location.reload();
}

/** A page's error state: the `userFacingMessage` copy (never raw error text), an optional retry,
 *  and Reload, which reloads the whole app. */
export function PageError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3" role="alert">
      <p className="text-body text-text-primary">{userFacingMessage(error)}</p>
      <div className="flex items-center gap-2">
        {onRetry ? (
          <button type="button" className="btn-light text-small px-3 py-1" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        <button type="button" className="btn-light text-small px-3 py-1" onClick={reloadApp}>
          Reload
        </button>
      </div>
    </div>
  );
}
