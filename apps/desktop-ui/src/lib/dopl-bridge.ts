/**
 * `window.dopl` as this renderer types it: the shared bridge surface
 * (`@/shared/lib/spa-bridge › SpaBridgeSurface`) plus the auth / navigation ops only the SPA calls.
 * Ground truth is `dopl-desktop-app/renderer/app-preload.js`. Tokens never cross the bridge.
 * `window.dopl` is absent in a plain browser (`npm run dev`): feature-detect, never assume.
 */

import type { SpaBridgeSurface } from "@/shared/lib/spa-bridge";

type ApiRequest = SpaBridgeSurface["apiRequest"];

export type BridgeRequestOpts = Parameters<ApiRequest>[1];

/** Main parses the body; `./api.ts` decodes the error envelope for both transports.
 *  `hasBody` is false for a 204 and for a body main could not parse as JSON. */
export type BridgeResponse = Awaited<ReturnType<ApiRequest>>;

/** What the renderer may know about the session. Never a token. */
export type AuthState = Awaited<ReturnType<SpaBridgeSurface["getAuthState"]>>;

/** Sign-in op answer; main owns the failure wording. */
export interface BridgeOpResult {
  ok: boolean;
  error?: string;
}

export type SignInProvider = "google" | "github";

export interface DoplBridge extends SpaBridgeSurface {
  apiRequest(path: string, opts?: BridgeRequestOpts): Promise<BridgeResponse>;
  onAuthState(callback: (state: AuthState) => void): () => void;
  /** External OAuth: main arms the login-CSRF nonce and opens the browser; the session returns
   *  over `dopl://auth`. */
  beginSignIn?(provider?: SignInProvider): Promise<BridgeOpResult>;
  /** Runs in main (no supabase client here). Success arrives as an `onAuthState` push. */
  passwordSignIn?(input: {
    mode: "sign-in" | "sign-up";
    email: string;
    password: string;
  }): Promise<BridgeOpResult>;
  /** Main-initiated navigation. The payload is a ROUTER path, never a URL: main must never load
   *  an origin into the SPA window. */
  onNavigate?(callback: (payload: { path: string }) => void): () => void;
  /** Main clears stored tokens and pushes a signed-out `onAuthState`. */
  signOut?(): Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    dopl?: DoplBridge;
  }
}

/**
 * The bridge inside Electron, else null.
 * Keyed on `apiRequest`, never on `window.dopl` being truthy: the legacy desktop wrapper exposes a
 * partial `window.dopl`. No `isDesktop()` alias: `@/shared/lib/desktop › isDesktopApp` reads the
 * legacy wrapper's marker, which answers the opposite way in this renderer.
 */
export function getBridge(): DoplBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.dopl;
  return bridge && typeof bridge.apiRequest === "function" ? bridge : null;
}
