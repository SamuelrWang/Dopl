"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "dopl-theme";
const CHANGE_EVENT = "dopl-theme-change";

/**
 * Routes that must stay dark regardless of the saved preference: the
 * marketing landing, auth, legal, docs, and the design demo. Keep this
 * list in sync with the pre-hydration script in `src/app/layout.tsx` and
 * with `isNoChrome` / `NO_SIDEBAR_PATHS` in `layout-shell.tsx`.
 */
export function isForcedDarkPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/docs") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/pricing") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/design")
  );
}

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Subscribe to preference changes — this tab (custom event) and others (storage). */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeStoredTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore (private mode); the event + server write still apply
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function applyThemeClass(effective: Theme) {
  const root = document.documentElement;
  root.classList.toggle("light", effective === "light");
  root.classList.toggle("dark", effective !== "light");
}

/**
 * Theme controller. `theme` is the user's saved preference (read from
 * localStorage via an external store, so it's SSR-safe and syncs across
 * tabs/instances). The *effective* theme is dark on forced-dark routes.
 * The hook owns the `<html>` class and re-applies it on preference or
 * route change.
 */
export function useTheme() {
  const pathname = usePathname();
  const isForced = isForcedDarkPath(pathname);
  const theme = useSyncExternalStore<Theme>(
    subscribe,
    readStoredTheme,
    () => "dark",
  );

  // Cross-device: if this device has no saved choice yet, adopt the server
  // preference. Writing storage + firing the event re-renders via the store.
  useEffect(() => {
    let hasLocal = false;
    try {
      hasLocal = localStorage.getItem(STORAGE_KEY) != null;
    } catch {
      hasLocal = false;
    }
    if (hasLocal) return;
    void fetch("/api/user/preferences/theme")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { value?: { theme?: Theme } } | null) => {
        const t = d?.value?.theme;
        if (t === "light" || t === "dark") writeStoredTheme(t);
      })
      .catch(() => {});
  }, []);

  // Apply the effective theme class (external-system sync — no setState).
  useEffect(() => {
    applyThemeClass(isForced ? "dark" : theme);
  }, [theme, isForced]);

  const setTheme = useCallback((next: Theme) => {
    writeStoredTheme(next);
    void fetch("/api/user/preferences/theme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: { theme: next } }),
    }).catch(() => {});
  }, []);

  return { theme, setTheme, isForced };
}
