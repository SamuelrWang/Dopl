"use client";

import { getSpaBridge } from "./spa-bridge";
import { getAppOrigin } from "./app-origin";

/**
 * ⚠ THE ONE "open this outside the app" helper, web tree and bundled SPA alike —
 * a hardening (e.g. scheme validation before the OS opener) must have one home.
 *
 * In the packaged renderer `window.open` is denied by the shell, so an external
 * link is dead unless it goes through `window.dopl.openExternal` → main → the
 * real browser. Off the bridge, a normal `window.open` is correct.
 */

/** Hand an ABSOLUTE url to the user's real browser. */
export function openExternalUrl(url: string): Promise<void> {
  const bridge = getSpaBridge();
  if (bridge) return bridge.openExternal(url).then(() => undefined);
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}

/**
 * Hand an APP PATH to the user's real browser. ⚠ Origin comes from
 * `getAppOrigin()` (the preload constant), NEVER `window.location` — the
 * packaged renderer is a `file://` document, where a relative URL builds
 * `file:///…`.
 */
export function openExternalPath(path: string): Promise<void> {
  return openExternalUrl(`${getAppOrigin()}${path}`);
}
