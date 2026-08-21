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
import type {
  DesktopNarrationEntry,
  DesktopSessionSummary,
} from "@/shared/lib/spa-bridge";

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
  /** `reopen`: open the AGENT WINDOW for this thread's session — the agent
   *  view's way in. Opens a window only, starts no query. Web tree
   *  feature-detects it, so an absent one silently hides the control.
   *
   *  ⚠ `summaries` / `onSummaries` / `pause` / `end` are SPA-ONLY —
   *  deliberately absent from the remote preload, whose window hosts the
   *  retired website. They carry the AGENTS TAB: the feed (read once on mount,
   *  then listen) and the two controls. All optional: an older main has none
   *  and the tab says the surface is desktop-only rather than showing an empty
   *  list. Same declaration in `@/shared/lib/spa-bridge` for shared modules.
   *
   *  ⚠ `pause` / `end` are OWN-AGENTS-ONLY. Main resolves the pair against its
   *  own session registry, which holds only this operator's sessions on this
   *  machine — there is no op here that reaches another member's runtime, and
   *  a peer's paused agent is read from PRESENCE on their side instead. */
  sessions?: {
    reopen(
      channelId: string,
      taskId: string,
      /** ⚠ Optional, 2026-08-20: a live WINDOWLESS session reopens as the AGENT
       *  WINDOW, whose landing is a router path and needs the slug. */
      segment?: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /** THE AGENT WINDOW (F-212). Asks main for a second window on this bundle
     *  showing one of MY agents; no handle comes back. */
    openAgentWindow?(
      segment: string,
      channelId: string,
      taskId: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /** ⚠ THE ONE OP HERE THAT STARTS A TURN — the operator's own words to their
     *  own agent, out of band. Never a channel post. See `@/shared/lib/spa-bridge`
     *  for the full security shape; main owns it. */
    message?(
      channelId: string,
      taskId: string,
      text: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /** Move a LIVE session's permission posture — supervision, not containment.
     *  See `@/shared/lib/spa-bridge` for the full shape; main owns it. */
    setMode?(
      channelId: string,
      taskId: string,
      axis: "tools" | "messages",
      mode: string
    ): Promise<{ ok: boolean; reason?: string; tools?: string; messages?: string }>;
    /** The agent's work ring: read once on mount, then listen. */
    narration?(
      channelId: string,
      taskId: string
    ): Promise<{ entries: DesktopNarrationEntry[] }>;
    onNarration?(
      callback: (event: {
        sessionKey: string;
        entries: DesktopNarrationEntry[];
      }) => void
    ): () => void;
    summaries?(): Promise<{ sessions: DesktopSessionSummary[] }>;
    onSummaries?(
      callback: (event: { sessions: DesktopSessionSummary[] }) => void
    ): () => void;
    /** ⚠ JOINED THIS MIRROR 2026-08-20. `launch` shipped in the preload and in
     *  `@/shared/lib/spa-bridge` but never here, so two of the THREE places this
     *  docblock says must stay in sync carried it and this one did not. Attach MY
     *  OWN agent to a thread, windowless: the click IS the consent (own agent, own
     *  thread, no consent row) and main owns the posture. */
    launch?(payload: {
      channelId: string;
      taskId: string;
      workspaceId: string;
      channelName: string;
      threadTitle: string | null;
      counterpartyId: string | null;
      direct: boolean;
    }): Promise<{ ok: boolean; sessionId?: string; reason?: string }>;
    /** Interrupt the turn in flight. The session stays live and named. */
    pause?(
      channelId: string,
      taskId: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /** End the AGENT. Never a thread — a thread has no finished state. */
    end?(
      channelId: string,
      taskId: string
    ): Promise<{ ok: boolean; reason?: string }>;
  };
  /** THE POP-OUT THREAD WINDOW (wiring plan Phase 10, 2026-08-18). Asks main to open a
   *  second window on this same bundle, landing on `/{segment}/channels/{channelId}` with
   *  `{threadId}` selected. Optional: an older main has none and the thread header simply
   *  renders no button. Same declaration in `@/shared/lib/desktop` for shared modules —
   *  the thread view lives in the shared tree and feature-detects it there.
   *
   *  ⚠ NO WINDOW HANDLE COMES BACK. Main creates the window AND registers it as a bound
   *  IPC sender (`main/app-windows.js`); the renderer can only ask. */
  threads?: {
    openWindow(
      segment: string,
      channelId: string,
      threadId: string
    ): Promise<{ ok: boolean }>;
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
