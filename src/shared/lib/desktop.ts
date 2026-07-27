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

export interface DoplDesktopBridge {
  isDesktop: boolean;
  platform?: string;
  versions?: { electron?: string; chrome?: string };
  channels?: DoplChannelsBridge;
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
