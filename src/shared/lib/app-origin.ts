"use client";

import { getSpaBridge } from "./spa-bridge";

/**
 * The app's PUBLIC origin, for building user-facing URLs (MCP endpoints, join
 * links, OAuth starts).
 *
 * Web: `window.location.origin`. ⚠ Bundled SPA: the document origin is
 * `file://`, which turns every such URL into a broken `file:///...` string — the
 * preload exposes the real origin as `window.dopl.appOrigin`, a constant
 * injected by main, never derived from the document.
 */
export function getAppOrigin(): string {
  if (typeof window === "undefined") return "";
  // ⚠ The legacy wrapper's partial window.dopl has no appOrigin, and its
  // document origin IS the right answer there (it loads the real site).
  const bridged = getSpaBridge()?.appOrigin;
  return bridged || window.location.origin;
}
