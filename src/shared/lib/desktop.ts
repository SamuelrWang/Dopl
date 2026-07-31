/**
 * Desktop-shell detection. The Dopl macOS app (an Electron wrapper) exposes a
 * read-only `window.dopl` marker via its preload bridge. The web app uses it to
 * branch auth into the system-browser + `dopl://` deep-link flow instead of the
 * normal in-window redirect, which can't work in the wrapper (Supabase PKCE
 * needs the OAuth to run in the browser where the code-verifier lives).
 */
/**
 * The narrow per-channel working-directory bridge exposed by the desktop
 * preload (`window.dopl.channels`). Present ONLY inside the desktop shell. Every
 * method resolves to the ABBREVIATED display label ("~/Downloads/repo") or null
 * (sandbox default) — the raw absolute path never crosses into the web page.
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
 * The narrow "reopen session window" bridge exposed by the MAIN-window preload
 * (`window.dopl.sessions`). Present ONLY inside the desktop shell. It lets the
 * web session-card ask the main process to reveal a hidden (or front a visible)
 * LIVE session window for a (channel, task). One fixed-name invoke, ids coerced
 * to strings; it never starts a query — just shows an existing window. Resolves
 * `{ ok: false }` when no live session exists for that pair (a settled task's
 * window is destroyed on settle, so it is not window-reopenable).
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

declare global {
  interface Window {
    dopl?: DoplDesktopBridge;
  }
}

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && !!window.dopl?.isDesktop;
}

/**
 * The channel-folder bridge when running inside the desktop shell AND the folder
 * API is present, else null. Feature-detected on `chooseFolder` so a plain
 * browser (no bridge) and an older desktop build (marker but no folder API) both
 * cleanly yield null — the caller renders nothing.
 */
export function getDesktopChannelFolders(): DoplChannelsBridge | null {
  if (typeof window === "undefined") return null;
  const channels = window.dopl?.channels;
  return channels && typeof channels.chooseFolder === "function" ? channels : null;
}

/**
 * The session-reopen bridge when running inside the desktop shell AND the reopen
 * API is present, else null. Feature-detected on `sessions.reopen` so a plain
 * browser (no bridge) and an older desktop build (marker but no sessions API)
 * both cleanly yield null — the caller renders nothing.
 */
export function getDesktopSessions(): DoplSessionsBridge | null {
  if (typeof window === "undefined") return null;
  const sessions = window.dopl?.sessions;
  return sessions && typeof sessions.reopen === "function" ? sessions : null;
}
