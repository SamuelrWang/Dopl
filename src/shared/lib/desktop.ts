/**
 * Desktop-shell detection. The Dopl macOS app (an Electron wrapper) exposes a
 * read-only `window.dopl` marker via its preload bridge. The web app uses it to
 * branch auth into the system-browser + `dopl://` deep-link flow instead of the
 * normal in-window redirect, which can't work in the wrapper (Supabase PKCE
 * needs the OAuth to run in the browser where the code-verifier lives).
 */
export interface DoplDesktopBridge {
  isDesktop: boolean;
  platform?: string;
  versions?: { electron?: string; chrome?: string };
}

declare global {
  interface Window {
    dopl?: DoplDesktopBridge;
  }
}

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && !!window.dopl?.isDesktop;
}
