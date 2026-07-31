"use client";

import { useEffect } from "react";

/**
 * Error boundary for the authed app shell. Before this existed, any throw
 * during an authenticated server render (a data fetch hiccup, a platform
 * timeout, the 2026-07-31 request-storm incident) surfaced Vercel's raw
 * platform 500 page ("ERROR <digest>@E<n>") with copy we do not control.
 * This keeps failures inside the product's own voice and gives the user a
 * retry that re-renders the segment instead of a full reload.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Digest only: it is the key support needs to find the server-side log
    // line. Never the message, which can carry internal detail.
     
    console.error("app segment error", error.digest ?? "no-digest");
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-h3 font-medium text-text-primary">
        Something went wrong loading this page
      </h2>
      <p className="max-w-md text-body text-text-secondary">
        The server had a problem finishing this page. Your data is safe. Try
        again, and if it keeps happening, note the code below.
      </p>
      <button type="button" onClick={reset} className="btn-light mt-1 h-8 rounded-[8px] px-4 text-small font-medium text-text-primary">
        Try again
      </button>
      {error.digest && (
        <p className="text-micro text-text-muted">Code {error.digest}</p>
      )}
    </div>
  );
}
