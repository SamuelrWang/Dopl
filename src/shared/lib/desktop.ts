/**
 * Desktop-shell detection via the preload's read-only `window.dopl` marker. Used
 * to branch auth into the system-browser + `dopl://` deep-link flow — the normal
 * in-window redirect can't work in the wrapper, since Supabase PKCE needs the
 * OAuth to run where the code-verifier lives.
 */
/**
 * Per-channel working-directory bridge (`window.dopl.channels`), present ONLY in
 * the desktop shell. ⚠ Every method resolves to the ABBREVIATED display label
 * ("~/Downloads/repo") or null — the raw absolute path never crosses into the
 * web page.
 */
export interface DoplChannelsBridge {
  /** Current label for a channel, or null when it uses the sandbox default. */
  getFolderLabel: (channelId: string) => Promise<string | null>;
  /** Open the native folder picker (user-driven); resolves the new label. */
  chooseFolder: (channelId: string) => Promise<string | null>;
  /** Reset the channel to the sandbox default; resolves null. */
  clearFolder: (channelId: string) => Promise<string | null>;
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
