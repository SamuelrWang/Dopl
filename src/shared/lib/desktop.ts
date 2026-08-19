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
 * "Reopen session window" bridge (`window.dopl.sessions`), desktop shell only.
 * Reveals/fronts an existing LIVE session window for a (channel, task). ⚠ Never
 * starts a query. `{ ok: false }` when no live session exists — a settled task's
 * window is destroyed on settle and is not reopenable.
 */
export interface DoplSessionsBridge {
  reopen: (
    channelId: string,
    taskId: string
  ) => Promise<{ ok: boolean; reason?: "no-thread" | "busy" }>;
}

/**
 * THE POP-OUT THREAD WINDOW (`window.dopl.threads`), desktop shell only — wiring plan
 * Phase 10, 2026-08-18. Asks MAIN to open a second window on the same bundle, landing on
 * the channels route with one thread selected.
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
  sessions?: DoplSessionsBridge;
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

/** Session-reopen bridge, else null. Feature-detected on `sessions.reopen` so a
 *  plain browser and an older desktop build both yield null. */
export function getDesktopSessions(): DoplSessionsBridge | null {
  const sessions = doplBridge()?.sessions;
  return sessions && typeof sessions.reopen === "function" ? sessions : null;
}

/** Pop-out-thread-window bridge, else null. Feature-detected on `threads.openWindow` so a
 *  plain browser and an older desktop build both yield null — and the header affordance
 *  that needs it renders NOTHING rather than offering a button that cannot work. */
export function getDesktopThreadWindows(): DoplThreadWindowsBridge | null {
  const threads = doplBridge()?.threads;
  return threads && typeof threads.openWindow === "function" ? threads : null;
}
