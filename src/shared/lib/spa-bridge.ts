"use client";

import type { SpaBridgeSessions } from "./spa-bridge-sessions";

/**
 * ⚠ THIS FILE IS THE IMPORT PATH OF RECORD for the bridge's types: the wire shapes and the
 * `sessions` namespace live in `./spa-bridge-shapes` / `./spa-bridge-sessions` and are
 * re-exported here, so the web tree and `apps/desktop-ui` take them from ONE path.
 */
export type {
  DesktopSessionSummary,
  DesktopNarrationEntry,
} from "./spa-bridge-shapes";
export type { SpaBridgeSessions } from "./spa-bridge-sessions";


/** One runtime's Dopl sign-in as main reports it: a state and a flag, never a credential. */
export interface RuntimeCredentialStatus {
  runtimeId: string;
  /** The runtime's own name for itself. */
  label: string;
  state: "connected" | "not-connected" | "expired" | "signing-in";
  /** Main raised this runtime's sign-in prompt, and no sign-in or dismissal has closed it. */
  prompt: boolean;
  /** "Enable Chrome & connectors": the optional full login; absent where the runtime offers none. */
  full?: "on" | "off" | "signing-in";
  /** What the updater's live safety check of a new build spent on this account, in main's own words; absent
   *  when nothing was spent (`runtime-copy.js › probeNotice`). Shown, never decided on here. */
  notice?: string;
}

export interface SpaBridgeSurface {
  apiRequest(
    path: string,
    opts: {
      method?: string;
      body?: unknown;
      workspaceId?: string;
      expectedUpdatedAt?: string;
    }
  ): Promise<{ status: number; statusText: string; hasBody: boolean; body?: unknown }>;
  getAuthState(): Promise<{ signedIn: boolean; userId: string | null }>;
  onAuthState?(cb: (s: { signedIn: boolean; userId: string | null }) => void): () => void;
  openExternal(url: string): Promise<{ ok: boolean }>;
  /** Remote image → `data:` URI, proxied by main (null = refused/failed).
   *  ⚠ Mirrored in `apps/desktop-ui/src/lib/dopl-bridge.ts`. Optional — an older
   *  main has no handler and the caller falls back to initials. */
  avatarDataUri?(url: string): Promise<string | null>;
  appOrigin?: string;
  syncWatch?(workspaceId: string | null): Promise<unknown>;
  onSyncEvent?(cb: (e: { workspaceId: string; table: string }) => void): () => void;
  /** The machine woke or unlocked (`main/wake.js`); the SPA refetches errored queries.
   *  Optional — an older main never pushes it. */
  onWake?(cb: () => void): () => void;
  /**
   * THE ORCHESTRATOR LAUNCH TOGGLE (2026-08-22, Samuel's launch-over-MCP ruling) — may another
   * agent cause THIS MACHINE to spawn a session, with no click?
   *
   * ⚠ IT IS THE STANDING CONSENT FOR THE WHOLE `channel_launch_directives` LANE, and Samuel
   * ruled it as the replacement for "the click IS that human" there: a directive arrives with
   * no human attending, so the operator's prior decision on this machine has to BE the human.
   * Default **FALSE**. With it off, `main/launch-directives.js` reads a directive addressed to
   * this operator and ignores it SILENTLY — the row then expires server-side, visibly to the
   * orchestrator, which is a better answer than a refusal this machine has to be trusted to
   * send.
   *
   * ⚠ IT LIVES OUTSIDE THE SERVER ENTIRELY AND THAT IS THE SECURITY CONTENT, not a storage
   * detail. It is an `electron-store` boolean written by ONE `appWindowOnly` IPC pair
   * (`main/channel-dir-ipc.js › orchestrator:get/setLaunchEnabled`, storage
   * `main/channel-prefs.js › get/setOrchestratorLaunch`). **There is no route, no MCP op and no
   * `workspace_settings` column for it, deliberately.** A spawned session runs with `Bash` and
   * this operator's device token is on disk (§6), so any server-stored version of this flag
   * could be flipped by an agent holding the operator's own credential — arming every machine
   * they own. Never add a remotely-addressable writer.
   *
   * ⚠ IT DECIDES WHO MAY PRESS, NEVER WHAT IS ALLOWED. A directive-driven launch is exactly as
   * contained as a Launch-button one: the channel's durable posture still supplies both
   * permission axes, the channel's tool profile still bounds what is reachable, and
   * `session-profiles.js › SESSION_HARD_DENY` is unconditional either way.
   *
   * ⚠ FEATURE-DETECT BOTH MEMBERS, and read an absent bridge as OFF — an older main has no
   * toggle and a plain browser has no bridge, and in both cases the lane is not running.
   * ⚠ `set` ANSWERS MAIN'S OWN VALUE: `{ ok: false }` means the store did not end up holding
   * what was asked for, so an optimistic switch must REVERT rather than render a state nothing
   * is enforcing. Same rule `sessions.setMode` / `setModel` follow.
   */
  orchestratorLaunch?: {
    get(): Promise<{ enabled: boolean }>;
    set(enabled: boolean): Promise<{ ok: boolean; reason?: string; enabled?: boolean }>;
  };
  /**
   * DIRECTING AGENTS OVER MCP — the PRIVATE DIRECT LANE's standing consent
   * (2026-08-31). ⚠ **EVERY WORD OF `orchestratorLaunch`'s block above applies**, and it is a
   * SEPARATE grant rather than a second spelling: launching buys COMPUTE, directing reaches a
   * RUNNING agent's private lane and starts a turn in it. Default OFF, machine-wide, never
   * server state, both members feature-probed, `set` answers main's own value.
   * ⚠ IT DECIDES WHETHER A DIRECTION IS DELIVERED, NEVER WHAT THE AGENT MAY THEN DO — a
   * directed turn runs inside the session's existing profile, both axes and the hard-deny
   * floor, with the private-turn gate withdrawing AXIS B's outbound widening for its duration.
   */
  orchestratorDirect?: {
    get(): Promise<{ enabled: boolean }>;
    set(enabled: boolean): Promise<{ ok: boolean; reason?: string; enabled?: boolean }>;
  };
  /**
   * NOTIFICATION PREFERENCES — THE ACCOUNT'S RECORD, so NO VALUE CROSSES HERE (2026-10-09). The
   * panel reads and writes `/api/user/notification-preferences` directly
   * (`@/features/notifications/stores/api-store`); the desktop's banner gate
   * (`main/notification-prefs.js`) reads that same record through a short cache, because the gate
   * is synchronous. `refresh` is the panel telling main to re-read it NOW, so a switch flipped
   * here lands on the next banner rather than after the TTL. Best-effort: feature-detect it, and
   * a refusal costs nothing (the gate catches up on its own).
   */
  notifications?: {
    refresh(): Promise<{ ok: boolean }>;
    /**
     * MAIN RAISING A TOAST IN HERE (`main/notification-route.js`, 2026-10-09). Samuel's spec
     * marks 9 events "Mac + popup"; because a banner lives in main and the toast lives here,
     * raising both would say the same thing twice at one desk. So main resolves it at raise
     * time: Dopl in front sends THIS instead of a banner. Returns its own unsubscribe.
     * ⚠ `kind: "incoming"` means the operator did not click for this one. The toast slot holds
     * a single toast, so a receiver that is showing the result of his own action decides
     * whether to yield — main does not get to assume it won.
     */
    onToast?(
      callback: (t: {
        eventId: string;
        title: string;
        /** Second line, when the event has one. */
        body?: string;
        /**
         * Present only for an ACTIONABLE event raised while Dopl is in front (`peer_ask`,
         * `draft_reply`). Pass it to {@link openFromToast} to run that toast's navigation.
         * ⚠ IT OPENS A SURFACE AND NOTHING ELSE. "Launch agent", "Send" and "Allow" exist on the
         * OS banner only and never cross this bridge — a toast auto-dismisses, and dismissing
         * decides nothing, so a decision may not live in one.
         */
        openId?: string;
        /** The button's label when `openId` is set ("Open", or "Resume" for the resume offer). */
        actionLabel?: string;
        /**
         * True for a toast that must WAIT until it is answered or dismissed rather than expire —
         * today only `session_resume`, which is raised once at startup, so a four-second one
         * would lose the offer.
         */
        sticky?: boolean;
        kind: "incoming";
      }) => void
    ): () => void;
    /** Runs the `onOpen` the toast carrying `openId` was raised with. Navigation only, one-shot. */
    openFromToast?(openId: string): Promise<{ ok: boolean }>;
  };
  /**
   * DOPL'S OWN RUNTIME CREDENTIALS (`main/runtime-credentials.js`). `signIn` runs one runtime's in-app
   * sign-in (`''` = the default) and, on `ok`, main has already released that runtime's held agents;
   * `status` / `onStatus` read and follow every in-app-sign-in runtime's row; `dismissPrompt` closes
   * one runtime's sign-in prompt. No credential crosses in either direction. Feature-detect each member.
   */
  runtimeAuth?: {
    signIn(runtimeId?: string): Promise<{ ok: boolean; resumed?: number }>;
    signInFull(runtimeId?: string): Promise<{ ok: boolean }>;
    /** Cancel on "Signing in…": stop that runtime's flow in flight; its row then leaves `signing-in`. */
    cancelSignIn?(runtimeId: string): Promise<{ ok: boolean }>;
    status(): Promise<{ runtimes: RuntimeCredentialStatus[] }>;
    onStatus(callback: (payload: { runtimes: RuntimeCredentialStatus[] }) => void): () => void;
    dismissPrompt(runtimeId: string): Promise<{ ok: boolean }>;
  };
  /** THE OPERATOR'S OWN AGENTS — the whole namespace, declared in `./spa-bridge-sessions`
   *  (the half of the bridge that grows with the agent surface). */
  sessions?: SpaBridgeSessions;
}

/**
 * THE one detector for the bundled-SPA bridge, shared by every web-tree SPA-mode
 * guard (api-client transport, realtime no-ops, identity hooks, app origin), or null.
 *
 * ⚠ CAPABILITY-KEYED, NEVER TRUTHINESS: identify the SPA by the capability about to be
 * used. A truthiness check once bricked the (since deleted) legacy desktop wrapper, whose
 * partial `window.dopl` had no `apiRequest`. Optional members stay feature-detected at
 * their call sites.
 */
export function getSpaBridge(): SpaBridgeSurface | null {
  if (typeof window === "undefined") return null;
  const b = (window as { dopl?: Partial<SpaBridgeSurface> }).dopl;
  if (b && typeof b.apiRequest === "function") {
    return b as SpaBridgeSurface;
  }
  return null;
}

/** True only in the bundled SPA renderer. */
export function isSpaRenderer(): boolean {
  return getSpaBridge() !== null;
}
