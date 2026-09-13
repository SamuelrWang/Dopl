/**
 * THE WINDOW'S OWN CHROME, over the bridge (2026-09-13).
 *
 * The agent pop-out is FRAMELESS since Samuel's Wispr-Flow ruling (`main/agent-window.js` took
 * `frame: false`), so macOS draws no close button and no zoom button and its header draws its own.
 * These two wrappers are how those buttons reach main.
 *
 * ⚠ WHY IT IS NOT IN `spa-bridge.ts`. That file sits at EXACTLY the 500-line cap (INVARIANTS §1,
 * lint-enforced at `error` over `src/**`), and a file at the cap cannot absorb a new namespace —
 * let alone the paragraph explaining one. The seam is honest rather than a dodge: the bridge
 * surface moves when the DESKTOP's ops move, and this moves when a WINDOW's chrome does. The
 * detection still goes through `getSpaBridge()`, so there is exactly one reader of `window.dopl`.
 *
 * ⚠ NEITHER OP TAKES AN ARGUMENT, AND THAT IS THE SECURITY CONTENT. Main resolves the target as
 * `BrowserWindow.fromWebContents(event.sender)` (`main/window-chrome.js`), so the ONLY window
 * either op can reach is the one the call came from. There is no window id on this wire to hold
 * wrong, and none to forge.
 *
 * ⚠ DETECT THE OP, NEVER THE WRAPPER. `canControlOwnWindow` reads the BRIDGE method, because these
 * wrappers are exports of this module and are therefore always functions — the bug
 * `agents-controls.ts › canMessageAgent` records having shipped once, which rendered a composer
 * that could only ever refuse. A plain browser and a main predating `main/window-chrome.js` both
 * answer `false`, and the header renders NO buttons rather than dead ones (INVARIANTS §11).
 */

import { getSpaBridge } from "./spa-bridge";

/**
 * ONE TAB OF THE AGENT WINDOW, as main describes it (`main/agent-window.js › openAgentWindow`).
 *
 * ⚠ **IT IS AN ADDRESS AND NOT A VIEW MODEL — no name, no state, no title.** Main does not know
 * what an agent is CALLED: names live in the renderer's own session feed
 * (`agents-model.ts › agentDisplayName`), which is also what keeps a rename instant on the strip
 * instead of waiting for a push. `key` is `agentWindowKey`'s — (channel, thread, agent).
 */
export interface AgentWindowTab {
  key: string;
  segment: string;
  channelId: string;
  taskId: string;
  /** `""` when the caller did not know it — the route degrades to the pair (see main's header). */
  agentId: string;
}

/** The `appWindow` namespace `renderer/app-preload.js` exposes. Every member optional: an older
 *  main exposes the object without them, and the type cannot know. */
interface AppWindowBridge {
  close?(): Promise<{ ok: boolean } | null>;
  toggleMaximize?(): Promise<{ ok: boolean; maximized?: boolean } | null>;
  closeTab?(key: string): Promise<{ ok: boolean } | null>;
  onTabs?(
    cb: (payload: { tabs: AgentWindowTab[]; focusKey: string }) => void
  ): () => void;
}

function appWindow(): AppWindowBridge | null {
  const bridge = getSpaBridge() as (Record<string, unknown> & object) | null;
  const ns = bridge ? (bridge as { appWindow?: AppWindowBridge }).appWindow : null;
  return ns ?? null;
}

/**
 * Whether this build can close and zoom its OWN window.
 *
 * ⚠ BOTH OPS OR NEITHER, deliberately. They shipped together in one preload block and one main
 * module, so a build with one and not the other does not exist; gating them separately would be
 * two answers to one question, and a half-drawn window chrome (a close button with no zoom) is a
 * worse surface than the OS buttons it replaced.
 */
export function canControlOwnWindow(): boolean {
  const ns = appWindow();
  return typeof ns?.close === "function" && typeof ns?.toggleMaximize === "function";
}

/** CLOSE this window — what the native close button did. */
export async function closeOwnWindow(): Promise<{ ok: boolean }> {
  const ns = appWindow();
  if (typeof ns?.close !== "function") return { ok: false };
  const res = await ns.close();
  return { ok: res?.ok === true };
}

/**
 * Whether this build's agent window is TABBED (2026-09-13).
 *
 * ⚠ **DETECT THE OP, NEVER THE WRAPPER** — the same rule `canControlOwnWindow` states above, and
 * the same reason: these exports are always functions. Both members or neither, because they
 * shipped in one preload block; a build that could close a tab but never hear the set would render
 * a strip that goes stale on every open.
 * ⚠ **A `false` HERE IS NOT AN ERROR STATE.** The window falls back to the ONE tab its own route
 * carries — which is exactly what it showed before tabs existed (INVARIANTS §11).
 */
export function canHostAgentTabs(): boolean {
  const ns = appWindow();
  return typeof ns?.closeTab === "function" && typeof ns?.onTabs === "function";
}

/** CLOSE ONE TAB — the × on the strip. ⚠ Main takes the window down with the LAST tab; this
 *  side never closes the window itself, or that rule would have two implementations. */
export async function closeOwnTab(key: string): Promise<{ ok: boolean }> {
  const ns = appWindow();
  if (typeof ns?.closeTab !== "function") return { ok: false };
  const res = await ns.closeTab(key);
  return { ok: res?.ok === true };
}

/**
 * SUBSCRIBE to main's tab set. Returns an unsubscribe; a build without the op returns a no-op one,
 * so a caller's `useEffect` cleanup is unconditional.
 *
 * ⚠ **THE PAYLOAD IS THE WHOLE LIST PLUS A FOCUS COMMAND**, never a delta — `focusKey` says which
 * tab to SHOW now (main just opened or closed one). Local tab clicks are the renderer's and ring
 * nothing here, so this must not be read as "what the operator has selected".
 */
export function onAgentWindowTabs(
  cb: (payload: { tabs: AgentWindowTab[]; focusKey: string }) => void
): () => void {
  const ns = appWindow();
  if (typeof ns?.onTabs !== "function") return () => {};
  return ns.onTabs(cb);
}

/** ZOOM / UN-ZOOM this window — what the green button did. Answers the state it landed in. */
export async function toggleOwnWindowMaximize(): Promise<{
  ok: boolean;
  maximized?: boolean;
}> {
  const ns = appWindow();
  if (typeof ns?.toggleMaximize !== "function") return { ok: false };
  const res = await ns.toggleMaximize();
  return { ok: res?.ok === true, maximized: res?.maximized };
}
