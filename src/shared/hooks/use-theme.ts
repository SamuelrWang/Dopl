"use client";

import { useEffect } from "react";

/**
 * Theme controller — now a fixed-dark shim.
 *
 * The dark/light toggle was removed with the new-design rollout: the
 * (app) routes carry their own fixed palette (AppShell light scope),
 * and every legacy surface (canvas, marketing, auth, admin) renders
 * the dark token set. This hook pins the `<html>` class to dark and
 * clears any previously-saved "light" preference so users who toggled
 * light before the rollout don't get a half-themed legacy page.
 *
 * Delete this hook (and the `html.light` token block in globals.css)
 * when the legacy surfaces finish converting.
 */
export function useTheme() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.classList.remove("light");
    try {
      localStorage.removeItem("dopl-theme");
    } catch {
      // ignore (private mode)
    }
  }, []);
}
