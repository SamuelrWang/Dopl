"use client";

/**
 * THE one detector for the bundled-SPA bridge, shared by every web-tree
 * SPA-mode guard (api-client transport, realtime no-ops, identity hooks,
 * app origin).
 *
 * WHY CAPABILITY-KEYED, NEVER TRUTHINESS: `window.dopl` is NOT unique to
 * the bundled SPA. The LEGACY desktop wrapper — every pre-1.8 install in
 * the wild, still reachable via DOPL_UI=remote — loads this LIVE web app
 * from usedopl.com and exposes `window.dopl = { isDesktop, platform,
 * versions, channels, sessions }` with NO apiRequest. A truthiness check
 * routed those users' API calls into `bridge.apiRequest is not a
 * function` and bricked the wrapper (2026-08-03 fleet audit, critical).
 * The SPA is identified by the capability we are about to use, nothing
 * less.
 */
/**
 * ONE LIVE SESSION on the operator's machine, as the desktop projects it
 * (`dopl-desktop-app/main/session-summary.js` — the mapping and its reasoning
 * live there, and this is the wire shape it emits). The channel pane's SESSION
 * PILLS render from these; rollback plan §3.3.
 *
 * `state` is three-valued on purpose. "thinking" is in the plan and is NOT here:
 * it needs `includePartialMessages`, which is off, so it could never be derived.
 * `taskId` is the wire spelling of THREAD, and `""` is a real value — a responder
 * session with no first-class thread collapses it.
 */
export interface DesktopSessionSummary {
  /** Internal, opaque, and NOT stable across a park/recreate — a React key, never
   *  an address. The (channelId, taskId) pair is what `reopen` is called with. */
  sessionId: string;
  channelId: string;
  taskId: string;
  /** The friendly handle ("flint"). Still called an agent in UI copy, because a
   *  session IS an agent session. Per channel, and stable across park/resume. */
  name: string;
  state: "working" | "idle" | "ended";
  channelName: string | null;
  threadTitle: string | null;
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
   *  The renderer-local mirror of this member is
   *  `apps/desktop-ui/src/lib/dopl-bridge.ts`; the consumer is
   *  `@/shared/hooks/use-bridged-image-src`. Optional — an older main has
   *  no such handler, and the caller falls back to initials. */
  avatarDataUri?(url: string): Promise<string | null>;
  appOrigin?: string;
  syncWatch?(workspaceId: string | null): Promise<unknown>;
  onSyncEvent?(cb: (e: { workspaceId: string; table: string }) => void): () => void;
  /** SESSION PILLS (§3.3). `reopen` is the SHARED op both preloads expose (the
   *  session card's "Open thread" and the pill's "Open" are the same call, so
   *  there is one reopen path in main); `summaries` + `onSummaries` are SPA-ONLY
   *  — the remote preload serves the retired website and does not grow surfaces.
   *  All three feature-detected at the call site: an older main has none of them
   *  and `session-pills-bar` renders NOTHING, which is also the plain-browser
   *  answer. The runtime contract is `renderer/app-preload.js`; the renderer's
   *  own typed view is `apps/desktop-ui/src/lib/dopl-bridge.ts`. Change one,
   *  change all three. */
  sessions?: {
    reopen(channelId: string, taskId: string): Promise<{ ok: boolean; reason?: string }>;
    summaries?(): Promise<{ sessions: DesktopSessionSummary[] }>;
    onSummaries?(cb: (e: { sessions: DesktopSessionSummary[] }) => void): () => void;
  };
}

/** The bundled-SPA bridge, or null — including on the legacy wrapper,
 *  whose partial `window.dopl` must never be mistaken for it. */
export function getSpaBridge(): SpaBridgeSurface | null {
  if (typeof window === "undefined") return null;
  const b = (window as { dopl?: Partial<SpaBridgeSurface> }).dopl;
  // `apiRequest` alone is the SPA marker: the legacy wrapper's partial
  // window.dopl never has it, and it is the one capability every consumer
  // of this helper ultimately rides. Optional members stay feature-
  // detected at their call sites.
  if (b && typeof b.apiRequest === "function") {
    return b as SpaBridgeSurface;
  }
  return null;
}

/** True only in the bundled SPA renderer. */
export function isSpaRenderer(): boolean {
  return getSpaBridge() !== null;
}
