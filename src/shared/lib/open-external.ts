"use client";

import { getSpaBridge } from "./spa-bridge";
import { getAppOrigin } from "./app-origin";

/**
 * THE one "open this somewhere outside the app" helper, for the web tree and
 * the bundled SPA alike.
 *
 * Inside the packaged renderer `window.open` is denied by the shell, so an
 * external link is dead unless it goes through `window.dopl.openExternal` →
 * main → the user's real browser. Off the bridge (web, browser dev mode) the
 * "external" browser is this one and a normal `window.open` is correct.
 *
 * It existed three times — the settings modal's helper, the signed-out
 * screen's private re-implementation, and an inline bridge cast in the
 * channels onboarding card — so a future hardening (e.g. validating the scheme
 * before handing a URL to the OS opener) would have landed in one of three
 * places (2026-08-03 fleet audit, duplication-quality).
 */

/** Hand an ABSOLUTE url to the user's real browser. */
export function openExternalUrl(url: string): Promise<void> {
  const bridge = getSpaBridge();
  if (bridge) return bridge.openExternal(url).then(() => undefined);
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}

/**
 * Hand an APP PATH to the user's real browser.
 *
 * The origin comes from `getAppOrigin()` (the preload constant), never from
 * `window.location` — the packaged renderer is a `file://` document, where a
 * relative URL builds `file:///…`.
 */
export function openExternalPath(path: string): Promise<void> {
  return openExternalUrl(`${getAppOrigin()}${path}`);
}
