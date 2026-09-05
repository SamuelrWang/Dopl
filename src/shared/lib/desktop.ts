/**
 * Desktop-shell detection via the preload's read-only `window.dopl` marker. Used
 * to branch auth into the system-browser + `dopl://` deep-link flow — the normal
 * in-window redirect can't work in the wrapper, since Supabase PKCE needs the
 * OAuth to run where the code-verifier lives.
 */
/**
 * Per-channel working-directory bridge (`window.dopl.channels`), present ONLY in
 * the desktop shell. ⚠ Every method resolves to ABBREVIATED display labels
 * ("~/Downloads/repo") — the raw absolute path never crosses into the web page.
 */

/**
 * WHERE THIS CHANNEL'S AGENT ACTUALLY RUNS (2026-09-05, task 15).
 *
 * ⚠ TWO FIELDS BECAUSE THE ROW ASKS TWO QUESTIONS, and one nullable label doing
 * double duty is what made the Settings row invent a place that does not exist.
 * The label used to be null whenever no per-channel dir was set, and the renderer
 * printed "Sandbox (default)" over that null — but there is no sandbox: the
 * desktop default is `~/Downloads`, or the homedir when that is missing.
 */
export interface ChannelFolderAnswer {
  /**
   * THE EFFECTIVE WORKING DIRECTORY, abbreviated, and NEVER empty. Main derives
   * it through the same function that produces the spawn cwd
   * (`main/channel-dirs.js › resolvedDirLabel` → `sessionSpawnDir`), so this
   * cannot disagree with where the agent really starts.
   */
  label: string;
  /** Whether a PER-CHANNEL dir is set — the reset control's question, which is
   *  not the same question as the label's. False = the desktop's own default. */
  custom: boolean;
}

export interface DoplChannelsBridge {
  /** The channel's folder answer. ⚠ `null` only when main REFUSED the call (a
   *  non-app-window sender, a bad channel id) — never "no folder". */
  getFolderLabel: (channelId: string) => Promise<ChannelFolderAnswer | null>;
  /** Open the native folder picker (user-driven); resolves the fresh answer.
   *  ⚠ On cancel the stored dir is unchanged, so the prior answer comes back. */
  chooseFolder: (channelId: string) => Promise<ChannelFolderAnswer | null>;
  /** Drop the per-channel dir; resolves the answer for the DEFAULT the channel
   *  just landed on, so the row can still say where that is. */
  clearFolder: (channelId: string) => Promise<ChannelFolderAnswer | null>;
}

/**
 * ⚠ `DoplSessionsBridge` + `getDesktopSessions` USED TO LIVE HERE — the
 * "reopen session window" slice of `window.dopl.sessions`. DELETED 2026-08-18
 * (wave-2 fix pass): their last caller was `components/session-card.tsx`, which
 * went with the session card in wiring plan Phase 5, and a typed slice nobody
 * reads is a claim about the wire that nothing checks.
 *
 * ⚠ **THE IPC IS NOT GONE — only this tree's description of it.** `main/channel-dir-ipc.js`
 * still registers `sessions:reopen` (plus `sessions:pause` / `sessions:end`) and the
 * preload still exposes them; the SPA describes the slice IT uses in
 * `apps/desktop-ui/src/lib/dopl-bridge.ts`. This module's own rule is that each
 * side types only the slice it uses, and the web side uses none of it.
 */

/**
 * THE POP-OUT THREAD WINDOW (`window.dopl.threads`), desktop shell only — wiring plan
 * Phase 10, 2026-08-18. Asks MAIN to open a second window on the same bundle, landing on
 * its OWN top-level route — `/{segment}/thread-window/{channelId}?thread={threadId}`
 * (`apps/desktop-ui/src/routes.tsx › THREAD_WINDOW_PATH`), outside the app shell.
 * ⚠ It landed on the channels route until 2026-08-19, and this comment said so until
 * 2026-08-20 — a window opened to read ONE exchange arrived carrying the whole app.
 *
 * ⚠ ASKS FOR A WINDOW; IT DOES NOT GET ONE. No handle and no window reference crosses back
 * — `{ ok: false }` covers a rejected id, a blocking version floor and a full window budget
 * alike, so a caller cannot tell them apart. Main owns creation, and main is what registers
 * the new window as a bound IPC sender.
 */
export interface DoplThreadWindowsBridge {
  openWindow: (
    /** The canonical `{slug}-{publicId}` workspace segment links are built from. */
    segment: string,
    channelId: string,
    threadId: string
  ) => Promise<{ ok: boolean }>;
}

export interface DoplDesktopBridge {
  isDesktop: boolean;
  platform?: string;
  versions?: { electron?: string; chrome?: string };
  channels?: DoplChannelsBridge;
  threads?: DoplThreadWindowsBridge;
}

/**
 * ⚠ Read through a cast, NEVER a `declare global` on `Window`: two augmentations
 * of `window.dopl` with different types is a hard TS error in any program that
 * sees both, and the desktop SPA sees both (its own
 * `apps/desktop-ui/src/lib/dopl-bridge.ts` plus this module via
 * `useChannelFolder`). Each side describes only the slice it uses.
 */
function doplBridge(): DoplDesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { dopl?: DoplDesktopBridge }).dopl;
}

export function isDesktopApp(): boolean {
  return !!doplBridge()?.isDesktop;
}

/** Channel-folder bridge, else null. Feature-detected on `chooseFolder` so a
 *  plain browser and an older desktop build both yield null. */
export function getDesktopChannelFolders(): DoplChannelsBridge | null {
  const channels = doplBridge()?.channels;
  return channels && typeof channels.chooseFolder === "function" ? channels : null;
}

/** Pop-out-thread-window bridge, else null. Feature-detected on `threads.openWindow` so a
 *  plain browser and an older desktop build both yield null — and the header affordance
 *  that needs it renders NOTHING rather than offering a button that cannot work. */
export function getDesktopThreadWindows(): DoplThreadWindowsBridge | null {
  const threads = doplBridge()?.threads;
  return threads && typeof threads.openWindow === "function" ? threads : null;
}
