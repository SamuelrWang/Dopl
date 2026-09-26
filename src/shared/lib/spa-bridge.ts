"use client";

import type { SpaBridgeSessions } from "./spa-bridge-sessions";

/**
 * THE one detector for the bundled-SPA bridge, shared by every web-tree SPA-mode
 * guard (api-client transport, realtime no-ops, identity hooks, app origin).
 *
 * ⚠ CAPABILITY-KEYED, NEVER TRUTHINESS. `window.dopl` is NOT unique to the
 * bundled SPA: the LEGACY desktop wrapper (every pre-1.8 install, reachable via
 * DOPL_UI=remote) loads this live web app and exposes `window.dopl` with NO
 * apiRequest. A truthiness check bricked the wrapper with `bridge.apiRequest is
 * not a function`. Identify the SPA by the capability about to be used.
 */
/**
 * ⚠ THE TWO WIRE SHAPES MOVED TO `./spa-bridge-shapes` ON 2026-08-22 (the 500-line cap;
 * `DesktopSessionSummary` and `DesktopNarrationEntry` were 230 lines of FIELD prose in a file
 * about the bridge's OPS). They are RE-EXPORTED here because this is the IMPORT PATH OF RECORD —
 * the web tree and the `apps/desktop-ui` mirror both take them from `@/shared/lib/spa-bridge`, and
 * a second canonical path for one type is how two trees come to disagree.
 */
export type {
  DesktopSessionSummary,
  DesktopNarrationEntry,
} from "./spa-bridge-shapes";
/** ⚠ SAME RULE, THIRD TYPE (2026-09-17): the `sessions` namespace moved to
 *  `./spa-bridge-sessions` at the 500-line cap and is re-exported here because THIS is the
 *  import path of record. */
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
   * DOPL'S OWN RUNTIME CREDENTIALS (`main/runtime-credentials.js`). `signIn` runs one runtime's in-app
   * sign-in (`''` = the default) and, on `ok`, main has already released that runtime's held agents;
   * `status` / `onStatus` read and follow every in-app-sign-in runtime's row; `dismissPrompt` closes
   * one runtime's sign-in prompt. No credential crosses in either direction. Feature-detect each member.
   */
  runtimeAuth?: {
    signIn(runtimeId?: string): Promise<{ ok: boolean; resumed?: number }>;
    signInFull(runtimeId?: string): Promise<{ ok: boolean }>;
    status(): Promise<{ runtimes: RuntimeCredentialStatus[] }>;
    onStatus(callback: (payload: { runtimes: RuntimeCredentialStatus[] }) => void): () => void;
    dismissPrompt(runtimeId: string): Promise<{ ok: boolean }>;
  };
  /** THE OPERATOR'S OWN AGENTS — the whole namespace, declared in `./spa-bridge-sessions`.
   *  ⚠ A §1 SPLIT (2026-09-17): this file stood at EXACTLY the 500-line cap, which is the
   *  state its own tree calls "stops being correctable" — and the `sessions` namespace is
   *  the half that GROWS, because it gains a member every time the agent surface does. The
   *  seam is reason-to-change, not the line count that forced the question: what stays here
   *  is the bridge ITSELF (the detector, the transport, the app-wide toggles), which moves
   *  when the bridge does. ⚠ THE TYPE IS RE-EXPORTED BELOW so `@/shared/lib/spa-bridge`
   *  remains the ONE import path of record, the rule the two wire shapes already follow. */
  sessions?: SpaBridgeSessions;
}

/** The bundled-SPA bridge, or null — including on the legacy wrapper,
 *  whose partial `window.dopl` must never be mistaken for it. */
export function getSpaBridge(): SpaBridgeSurface | null {
  if (typeof window === "undefined") return null;
  const b = (window as { dopl?: Partial<SpaBridgeSurface> }).dopl;
  // ⚠ `apiRequest` alone is the SPA marker — the legacy wrapper's partial
  // window.dopl never has it. Optional members stay feature-detected at their
  // call sites.
  if (b && typeof b.apiRequest === "function") {
    return b as SpaBridgeSurface;
  }
  return null;
}

/** True only in the bundled SPA renderer. */
export function isSpaRenderer(): boolean {
  return getSpaBridge() !== null;
}
