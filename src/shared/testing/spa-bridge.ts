/**
 * `window.dopl` for web-tree tests. Importing this module registers an `afterEach` that removes the
 * bridge, so no suite leaks one into the next case.
 */

import { afterEach } from "vitest";

type Bridge = Record<string, unknown>;

const idleRequest = () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false });

/** `apiRequest` is always present: it is the SPA marker `spa-bridge.ts › getSpaBridge` keys on. */
export function installSpaBridge<T extends Bridge>(api: T = {} as T): T & { apiRequest: unknown } {
  const bridge = { apiRequest: idleRequest, ...api };
  (window as { dopl?: unknown }).dopl = bridge;
  return bridge;
}

export function removeSpaBridge(): void {
  if (typeof window !== "undefined") delete (window as { dopl?: unknown }).dopl;
}

afterEach(removeSpaBridge);
