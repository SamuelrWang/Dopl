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
  /**
   * Per-channel durable settings, all of them read by the SETTINGS TAB
   * (`channels-v2/settings-agent.tsx`): the label-only folder ops, the launch
   * posture, and auto-send.
   *
   * ⚠ THIS BLOCK DRIFTED IN BOTH DIRECTIONS AND WAS CORRECTED 2026-08-20. It
   * declared `getPermissionPreset` / `setPermissionPreset` — the single-use ARM's
   * two ops, DELETED from `renderer/app-preload.js` with the arm itself — while
   * OMITTING the four ops the web tree actually calls. A mirror that names ops
   * main does not have and hides ops it does is worse than an absent mirror: the
   * shared tree feature-detects every capability and renders NOTHING when one is
   * missing, so a gap here does not fail, **it deletes a feature silently**
   * (INVARIANTS §11).
   *
   * ⚠ GROUND TRUTH IS `renderer/app-preload.js`, PINNED BY
   * `test/preload-parity.test.mjs › APP_OPS`. Read those, not this, when the two
   * disagree — and adding an op is still a FOUR-file change plus the pin.
   */
  channels?: {
    /** Abbreviated display label ("~/Downloads/repo") or null. ⚠ The raw absolute
     *  path never crosses into the renderer. */
    getFolderLabel(channelId: string): Promise<string | null>;
    chooseFolder(channelId: string): Promise<string | null>;
    clearFolder(channelId: string): Promise<string | null>;
    /**
     * THE DURABLE LAUNCH POSTURE — the two axes the operator's OWN agent starts on
     * when they press Launch. ⚠ NOT THE ARM: no TTL, spent by nothing, read at
     * exactly one call site (`main/session-ipc-ops.js`'s `sessions:launch`). The
     * arm it replaced is deleted; do not reintroduce a second permission record.
     */
    getLaunchPosture?(
      channelId: string
    ): Promise<{ tools: string; messages: string } | null>;
    setLaunchPosture?(
      channelId: string,
      preset: { tools: string; messages: string }
    ): Promise<{ ok: boolean }>;
    /** AUTO-SEND — the durable per-channel out-half. Default OFF (ask first); ON
     *  maps the windowless session's message axis to `auto_both` and the agent's
     *  reply posts itself. */
    getAutoSend?(channelId: string): Promise<boolean>;
    setAutoSend?(
      channelId: string,
      on: boolean
    ): Promise<{ ok: boolean; on?: boolean }>;
  };
  /** `reopen`: open the AGENT WINDOW for this thread's session — the agent
   *  view's way in. Opens a window only, starts no query. Web tree
   *  feature-detects it, so an absent one silently hides the control.
   *
   *  ⚠ THE "SPA-ONLY" CONTRAST IS RETIRED (2026-08-20). `summaries` /
   *  `onSummaries` / `pause` / `end` used to be described as deliberately absent
   *  from the REMOTE preload; that preload is deleted and orphaned with the remote
   *  shell, so there is no second surface to be narrower than. **The inventory is
   *  `test/preload-parity.test.mjs › APP_OPS`** — it is executed against a fake
   *  `electron` rather than grepped, and it fails on ADD as well as REMOVE.
   *  These carry the AGENTS TAB: the feed (read once on mount, then listen) and
   *  the two controls. All optional: an older main has none and the tab says the
   *  surface is desktop-only rather than showing an empty list. Same declaration
   *  in `@/shared/lib/spa-bridge` for shared modules.
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
      segment?: string,
      /** ⚠ WHICH of my agents on that thread (2026-08-21). Omitted = the oldest
       *  live one, which is what a one-agent thread always gave back. */
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /** THE AGENT WINDOW (F-212). Asks main for a second window on this bundle
     *  showing one of MY agents; no handle comes back. */
    openAgentWindow?(
      segment: string,
      channelId: string,
      taskId: string,
      /** One window per AGENT since 2026-08-21 — without it, asking for the
       *  second agent on a thread fronts the first one's window. */
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /** ⚠ THE ONE OP HERE THAT STARTS A TURN — the operator's own words to their
     *  own agent, out of band. Never a channel post. See `@/shared/lib/spa-bridge`
     *  for the full security shape; main owns it. */
    message?(
      channelId: string,
      taskId: string,
      text: string,
      /** The 1:1 lane reaches exactly this agent (2026-08-21). */
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /** Move a LIVE session's permission posture — supervision, not containment.
     *  See `@/shared/lib/spa-bridge` for the full shape; main owns it. */
    setMode?(
      channelId: string,
      taskId: string,
      axis: "tools" | "messages",
      mode: string,
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string; tools?: string; messages?: string }>;
    /** The agent's work ring: read once on mount, then listen. */
    narration?(
      channelId: string,
      taskId: string,
      agentId?: string
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
    /** ⚠ 2026-08-21: returns the AGENT ID it minted, and starts nothing — the
     *  agent is registered idle and its query launches on the first message for
     *  it. Call it twice for two agents on one thread; there is no `busy`. */
    launch?(payload: {
      channelId: string;
      /** ⚠ `null` = a CHANNEL-LEVEL agent (2026-08-21): main-room feed, main-room replies.
       *  Pass `null`, never `""` — that is the legacy "thread never became first-class"
       *  value, which main accepts and scopes identically but which means something else. */
      taskId: string | null;
      workspaceId?: string;
      channelName?: string;
      threadTitle?: string | null;
      counterpartyId?: string | null;
      direct?: boolean;
    }): Promise<{
      ok: boolean;
      agentId?: string;
      sessionId?: string | null;
      reason?: string;
    }>;
    /** Interrupt the turn in flight. The session stays live and named. */
    pause?(
      channelId: string,
      taskId: string,
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /** End the AGENT. Never a thread — a thread has no finished state.
     *  ⚠ ENDED IS DEAD (2026-08-22): every later op naming it refuses, and a thread message
     *  @-mentioning its id is neither fed nor queued. The CARD survives 7 days, read-only. */
    end?(
      channelId: string,
      taskId: string,
      agentId?: string
    ): Promise<{ ok: boolean; reason?: string }>;
    /** ⚠ Call after a thread DELETE succeeds (2026-08-22): drops every local trace of that
     *  thread's ended agents. Local history only — never a `channel_message`. */
    forgetThread?(
      channelId: string,
      taskId: string
    ): Promise<{ ok: boolean; forgotten?: number }>;
  };
  /** THE POP-OUT THREAD WINDOW (wiring plan Phase 10, 2026-08-18). Asks main to open a
   *  second window on this same bundle, landing on
   *  `/{segment}/thread-window/{channelId}?thread={threadId}` — a TOP-LEVEL route of its
   *  own, outside the app shell (`routes.tsx › THREAD_WINDOW_PATH`).
   *  ⚠ IT LANDED ON THE FULL CHANNELS PAGE UNTIL 2026-08-19, and this comment still said
   *  so until 2026-08-20: a window opened to read one exchange arrived carrying the app
   *  sidebar, the channels tree and the info panel. `?thread=` is a SELECTION on the
   *  channels page and was never this window's landing.
   *  Optional: an older main has none and the thread header simply renders no button.
   *  Same declaration in `@/shared/lib/desktop` for shared modules — the thread view lives
   *  in the shared tree and feature-detects it there.
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
