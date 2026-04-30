"use client";

/**
 * canvas-state-sync.ts — write-side helper for `/api/canvas/state`.
 *
 * Wraps the PATCH with optimistic-lock semantics: every write carries
 * the caller's last-known `if_version`; on a 409 the server returns
 * the fresh row so we can update our cached version + retry on the
 * next debounce cycle. Lifted out of `useCanvasDbSync` to keep that
 * hook under the 500-line cap.
 */

interface VersionRef {
  current: number | null;
}

function buildHeaders(canvasId: string | null): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (canvasId) headers["X-Canvas-Id"] = canvasId;
  return headers;
}

export async function patchCanvasState(
  canvasId: string | null,
  versionRef: VersionRef,
  body: Record<string, unknown>,
  opts: { keepalive?: boolean } = {},
): Promise<void> {
  const payload =
    versionRef.current !== null
      ? { ...body, if_version: versionRef.current }
      : body;
  try {
    const res = await fetch("/api/canvas/state", {
      method: "PATCH",
      headers: buildHeaders(canvasId),
      keepalive: opts.keepalive ?? false,
      body: JSON.stringify(payload),
    });

    if (res.status === 409) {
      // Stale snapshot — server returns the fresh row. Update our
      // cached version so the NEXT debounced write goes against the
      // current server state. We deliberately don't reconcile local
      // reducer state here — the next change will land cleanly.
      try {
        const stale = (await res.json()) as { current?: { version?: number } };
        if (typeof stale.current?.version === "number") {
          versionRef.current = stale.current.version;
          return;
        }
      } catch {
        // Body parse failed — fall through to the GET refetch below.
      }
      try {
        const fresh = await fetch("/api/canvas/state", {
          headers: canvasId ? { "X-Canvas-Id": canvasId } : undefined,
        });
        if (fresh.ok) {
          const data = (await fresh.json()) as {
            canvas_state?: { version?: number };
          };
          if (typeof data.canvas_state?.version === "number") {
            versionRef.current = data.canvas_state.version;
          }
        }
      } catch {
        // Network error — leave versionRef as-is. The next attempt
        // will probably 409 again and we'll loop here once more.
      }
      return;
    }

    if (res.ok) {
      try {
        const ok = (await res.json()) as { version?: number };
        if (typeof ok.version === "number") {
          versionRef.current = ok.version;
        }
      } catch {
        // Older server response without version — keep what we have.
      }
    }
  } catch (err) {
    console.error("[canvas-sync] canvas_state PATCH failed:", err);
  }
}

/**
 * Fetch the current canvas_state version once on mount so the first
 * debounced PATCH carries a real baseline. Returns null if the canvas
 * has no state row yet (the first PATCH will create it).
 */
export async function fetchCurrentVersion(
  canvasId: string,
): Promise<number | null> {
  try {
    const res = await fetch("/api/canvas/state", {
      headers: { "X-Canvas-Id": canvasId },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      canvas_state?: { version?: number };
    };
    return typeof body.canvas_state?.version === "number"
      ? body.canvas_state.version
      : null;
  } catch {
    return null;
  }
}
