/**
 * Typed shape of `window.dopl` — the ENTIRE privileged surface the Electron
 * preload exposes to this renderer.
 *
 * ⚠ Three files move together: `dopl-desktop-app/renderer/app-preload.js`,
 * `dopl-desktop-app/main/ui-bridge.js`, and this mirror. Keep the surface
 * MINIMAL — every addition is a new hole a compromised renderer speaks
 * through. Tokens never cross it.
 *
 * ⚠ `window.dopl` is optional: the same bundle runs in a plain browser during
 * `npm run dev`. Feature-detect, never assume.
 */

// Wire shape declared ONCE in `@/shared/lib/spa-bridge` — the component that
// renders it lives there and the SPA bundles it. A copy here = a third thing
// to keep in step.
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";

/** Wire response for `dopl:api-request`. Main parses the body; `./api.ts` owns
 *  `{ error: { code, message } }` envelope decoding, so BOTH transports feed
 *  the identical decoder. */
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

/** Sign-in op answer. Main owns the failure wording — the renderer has no
 *  supabase error to translate. */
export interface BridgeOpResult {
  ok: boolean;
  error?: string;
}

export type SignInProvider = "google" | "github";

export interface DoplBridge {
  apiRequest(path: string, opts?: BridgeRequestOpts): Promise<BridgeResponse>;
  getAuthState(): Promise<AuthState>;
  /** External OAuth (default "google"): main arms the login-CSRF nonce and
   *  opens the browser; session returns over `dopl://auth`. Absent on older
   *  mains — the signed-out screen then DISABLES the social buttons. */
  beginSignIn?(provider?: SignInProvider): Promise<BridgeOpResult>;
  /** Email + password, run in MAIN (renderer has no supabase client, never
   *  sees a token). No navigation on success: main stores the session and
   *  pushes the `onAuthState` transition. Absent on older mains. */
  passwordSignIn?(input: {
    mode: "sign-in" | "sign-up";
    email: string;
    password: string;
  }): Promise<BridgeOpResult>;
  /** Magic-link fallback. Absent on older mains. */
  sendMagicLink?(input: { email: string }): Promise<BridgeOpResult>;
  /** Subscribe to auth changes; returns an unsubscribe function. */
  onAuthState(callback: (state: AuthState) => void): () => void;
  /** Main-initiated navigation (clicked channel notification, tray "Pending").
   *  ⚠ Payload is a ROUTER path (`/{segment}/channels`), NEVER a URL: main does
   *  not know this is a hash router and must never load an origin into the SPA
   *  window. Absent on older mains — the click then only fronts the window. */
  onNavigate?(callback: (payload: { path: string }) => void): () => void;
  /** End the session: main clears stored tokens and broadcasts signed-out
   *  `onAuthState`. Absent on older mains — the settings modal's sign-out
   *  button HIDES itself rather than faking it (the renderer holds no token
   *  it could drop). */
  signOut?(): Promise<{ ok: boolean }>;
  openExternal(url: string): Promise<{ ok: boolean }>;
  /** Remote image → `data:` URI (null off main's avatar allowlist, or on a
   *  failed fetch). The packaged `img-src` cannot enumerate the OAuth avatar
   *  CDNs, so `profiles.avatar_url` is unrenderable without this. Absent on
   *  older mains — `useBridgedImageSrc` keeps the initials fallback. */
  avatarDataUri?(url: string): Promise<string | null>;
  /** Live updates: tell main which workspace the UI is viewing (null = none);
   *  main pushes coalesced change events back. */
  syncWatch?(workspaceId: string | null): Promise<unknown>;
  onSyncEvent?(
    callback: (event: { workspaceId: string; table: string }) => void
  ): () => void;
  /** Public https origin for user-facing URLs (document origin is file://
   *  here). Injected by main as a preload constant. */
  appOrigin?: string;
  /** Per-channel controls (consent card + channel header): label-only folder
   *  ops + the two permission-preset axes. Channels UI feature-detects this. */
  channels?: {
    getFolderLabel(channelId: string): Promise<string | null>;
    chooseFolder(channelId: string): Promise<string | null>;
    clearFolder(channelId: string): Promise<string | null>;
    getPermissionPreset(
      channelId: string
    ): Promise<{ tools: string; messages: string } | null>;
    setPermissionPreset(
      channelId: string,
      preset: { tools: string; messages: string }
    ): Promise<{ ok: boolean }>;
  };
  /** `reopen`: reveal (or recreate parked) this thread's session window —
   *  session-card "Open thread", session pill "Open". Opens a window only,
   *  starts no query. Web tree feature-detects via `@/shared/lib/desktop ›
   *  getDesktopSessions`, so an absent one silently hides the button.
   *
   *  ⚠ `summaries` / `onSummaries` are SPA-ONLY — deliberately absent from the
   *  remote preload, whose window hosts the retired website. They carry the
   *  session-pills feed; read once on mount, then listen. Both optional: an
   *  older main has none and the pills bar renders NOTHING, not an empty row.
   *  Same declaration in `@/shared/lib/spa-bridge` for shared modules. */
  sessions?: {
    reopen(
      channelId: string,
      taskId: string
    ): Promise<{ ok: boolean; reason?: string }>;
    summaries?(): Promise<{ sessions: DesktopSessionSummary[] }>;
    onSummaries?(
      callback: (event: { sessions: DesktopSessionSummary[] }) => void
    ): () => void;
  };
}

declare global {
  interface Window {
    dopl?: DoplBridge;
  }
}

/**
 * The bridge when running inside Electron, else null (browser dev mode).
 *
 * ⚠ Capability-keyed on `apiRequest`, NEVER on `window.dopl` being truthy: the
 * legacy desktop wrapper exposes a partial `window.dopl` with no `apiRequest`.
 *
 * ⚠ No `isDesktop()` alias here on purpose — `@/shared/lib/desktop ›
 * isDesktopApp()` reads the legacy wrapper's `isDesktop` MARKER flag, which the
 * SPA preload does not set, so the two answer OPPOSITELY inside this renderer.
 * Ask for the capability you need instead.
 */
export function getBridge(): DoplBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.dopl;
  return bridge && typeof bridge.apiRequest === "function" ? bridge : null;
}
