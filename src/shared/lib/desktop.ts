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

export interface DoplDesktopBridge {
  isDesktop: boolean;
  platform?: string;
  versions?: { electron?: string; chrome?: string };
  channels?: DoplChannelsBridge;
  sessions?: DoplSessionsBridge;
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
