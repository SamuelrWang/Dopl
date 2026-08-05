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

// The session-pill wire shape is declared ONCE, in the web tree's own view of this
// bridge (`@/shared/lib/spa-bridge`), because the component that renders it lives
// there and the SPA bundles that component. A third copy here would be a third thing
// to keep in step.
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";

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

/** Answer shape of the sign-in ops: `ok` plus, when it failed, a message fit
 *  to show the user (the login form drops it straight into its error banner).
 *  Main owns the wording — the renderer has no supabase error to translate. */
export interface BridgeOpResult {
  ok: boolean;
  error?: string;
}

/** The social providers the login form offers. */
export type SignInProvider = "google" | "github";

export interface DoplBridge {
  apiRequest(path: string, opts?: BridgeRequestOpts): Promise<BridgeResponse>;
  getAuthState(): Promise<AuthState>;
  /** Start the external OAuth sign-in for `provider` (default "google") —
   *  main arms the login-CSRF nonce and opens the browser, and the session
   *  comes back over the `dopl://auth` deep link. Absent on older mains,
   *  where the signed-out screen disables the social buttons rather than
   *  opening a URL whose callback the nonce gate would (correctly) refuse. */
  beginSignIn?(provider?: SignInProvider): Promise<BridgeOpResult>;
  /** Email + password sign-in / sign-up, run in MAIN (the renderer has no
   *  supabase client and never sees a token). Success needs no navigation:
   *  main stores the session and pushes the `onAuthState` transition that
   *  swaps the signed-out screen out. Absent on older mains. */
  passwordSignIn?(input: {
    mode: "sign-in" | "sign-up";
    email: string;
    password: string;
  }): Promise<BridgeOpResult>;
  /** Email the user a sign-in link (the magic-link fallback). Absent on
   *  older mains. */
  sendMagicLink?(input: { email: string }): Promise<BridgeOpResult>;
  /** Subscribe to auth changes; returns an unsubscribe function. */
  onAuthState(callback: (state: AuthState) => void): () => void;
  /** Main-initiated navigation — a clicked channel notification or the tray's
   *  "Pending" item (journey-audit GAP-16). The payload is a ROUTER path
   *  (`/{segment}/channels`), never a URL: main does not know this router is
   *  a hash router and must never load an origin into the SPA window.
   *  Absent on older mains, where the click only fronts the window. */
  onNavigate?(callback: (payload: { path: string }) => void): () => void;
  /** End the session — main clears the stored tokens and broadcasts the
   *  signed-out `onAuthState`. Optional because main owns the session and
   *  older builds have no such handler; the settings modal's sign-out
   *  button HIDES itself when this is absent rather than faking it (the
   *  renderer holds no token it could drop). */
  signOut?(): Promise<{ ok: boolean }>;
  openExternal(url: string): Promise<{ ok: boolean }>;
  /** Proxy a remote image through main and get it back as a `data:` URI (or
   *  null when the host is not on main's avatar allowlist, or the fetch
   *  failed). The packaged page's `img-src` cannot enumerate the OAuth
   *  avatar CDNs, so `profiles.avatar_url` is unrenderable here without this.
   *  Optional: absent on older mains, where `useBridgedImageSrc` leaves the
   *  initials fallback in place rather than emitting a blocked request. */
  avatarDataUri?(url: string): Promise<string | null>;
  /** Phase 3 live updates: tell main which workspace the UI is viewing
   *  (null = none); main pushes coalesced change events back. */
  syncWatch?(workspaceId: string | null): Promise<unknown>;
  onSyncEvent?(
    callback: (event: { workspaceId: string; table: string }) => void
  ): () => void;
  /** The app's public https origin for user-facing URLs (document origin
   *  is file:// here). Injected by main as a preload constant. */
  appOrigin?: string;
  /** Per-channel controls (consent card + channel header) — label-only
   *  folder ops + the two permission-preset axes. Mirrors the remote-page
   *  preload's surface; channels UI feature-detects this namespace. */
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
  /** Reveal (or recreate parked) this thread's session window — the
   *  session-card's "Open thread" button, and the session pill's "Open". Mirrors
   *  the remote-page preload's one session op; opens a window only, starts no
   *  query. The web tree feature-detects this namespace (`@/shared/lib/desktop`
   *  getDesktopSessions), so an absent one silently hides the button.
   *
   *  `summaries` / `onSummaries` (rollback plan §3.3) are SPA-ONLY: the remote
   *  preload has neither, because that window hosts the RETIRED website. They
   *  carry the SESSION PILLS' feed — the sessions running on this machine, each
   *  with a friendly name and a coarse state. Read once on mount, then listen.
   *  Both optional: an older main has no such handler and the pills bar renders
   *  NOTHING rather than an empty row. See `@/shared/lib/spa-bridge`, which is
   *  the same declaration for modules shared with the web app. */
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
 * Capability-keyed on `apiRequest`, never on `window.dopl` being truthy: the
 * LEGACY desktop wrapper exposes a partial `window.dopl` with no `apiRequest`.
 * The web tree's `@/shared/lib/spa-bridge` is the same detector for modules
 * shared with the web app; this one is the renderer-local typed view.
 *
 * There is deliberately NO `isDesktop()` alias here. It had zero consumers and
 * was a naming trap: `@/shared/lib/desktop`'s `isDesktopApp()` reads the legacy
 * wrapper's `isDesktop` MARKER flag, which the SPA preload does not set — the
 * two would have answered oppositely inside this very renderer (2026-08-03
 * fleet audit). Ask for the capability you need instead.
 */
export function getBridge(): DoplBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.dopl;
  return bridge && typeof bridge.apiRequest === "function" ? bridge : null;
}
