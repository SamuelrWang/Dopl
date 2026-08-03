/**
 * The typed shape of `window.dopl` — the ENTIRE privileged surface the Electron
 * preload exposes to this renderer.
 *
 * The runtime contract lives in `dopl-desktop-app/renderer/app-preload.js` and
 * its handlers in `dopl-desktop-app/main/ui-bridge.js`. This file is the
 * renderer-side mirror; if you change one, change all three, and keep the
 * surface MINIMAL — every addition is a new hole in a bridge that a compromised
 * renderer speaks through. Tokens never cross it (see `getAuthState`).
 *
 * `window.dopl` is optional on purpose: the same bundle runs in a plain browser
 * during development (`npm run dev`), where the bridge is absent and the
 * transport falls back to `fetch`. Feature-detect, never assume.
 */

/** Wire response for `dopl:api-request`. Main parses the body; the renderer
 *  owns the `{ error: { code, message } }` envelope decoding (`./api.ts`), so
 *  BOTH transports feed the identical decoder. */
export interface BridgeResponse {
  status: number;
  statusText: string;
  /** False for 204 and for a body main could not parse as JSON. */
  hasBody: boolean;
  body?: unknown;
}

export interface BridgeRequestOpts {
  method?: string;
  workspaceId?: string;
  expectedUpdatedAt?: string;
  body?: unknown;
}

/** What the renderer is allowed to know about the session. Never a token. */
export interface AuthState {
  signedIn: boolean;
  userId: string | null;
}

export interface DoplBridge {
  apiRequest(path: string, opts?: BridgeRequestOpts): Promise<BridgeResponse>;
  getAuthState(): Promise<AuthState>;
  /** Subscribe to auth changes; returns an unsubscribe function. */
  onAuthState(callback: (state: AuthState) => void): () => void;
  openExternal(url: string): Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    dopl?: DoplBridge;
  }
}

/** The bridge when running inside Electron, else null (browser dev mode). */
export function getBridge(): DoplBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.dopl;
  return bridge && typeof bridge.apiRequest === "function" ? bridge : null;
}

export const isDesktop = (): boolean => getBridge() !== null;
