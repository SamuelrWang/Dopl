"use client";

import { getSpaBridge } from "./spa-bridge";

/**
 * The app's PUBLIC origin (https://www.usedopl.com in production) for
 * building user-facing URLs — MCP endpoints, join links, OAuth starts.
 *
 * On the web this is `window.location.origin`. In the bundled desktop SPA
 * the document origin is `file://`, which turned every such URL into a
 * broken `file:///...` string (journey-audit S3s) — there the Electron
 * preload exposes the real origin as `window.dopl.appOrigin` (a constant
 * injected by main from config.js APP_ORIGIN, never derived from the
 * document).
 */
export function getAppOrigin(): string {
  if (typeof window === "undefined") return "";
  // The legacy wrapper's partial window.dopl has no appOrigin — and its
  // document origin IS the right answer there (it loads the real site).
  const bridged = getSpaBridge()?.appOrigin;
  return bridged || window.location.origin;
}
