"use client";

/**
 * The per-runtime model catalogs off a settings read, shared by the launch-selection hooks.
 * Re-reads only while some catalog is `loading` — bounded, not a poll — and once more when the
 * window regains focus after a settled failure or a stalled load. An exhausted budget stays
 * `loading`, never becomes `unavailable` (INVARIANTS §11). A runtime with no catalog reads `null`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  catalogFor,
  normalizeCatalogs,
  NO_CATALOGS,
  type ModelCatalog,
  type ModelCatalogs,
} from "../lib/model-catalog";

export const RELOAD_DELAY_MS = 1200;

/**
 * The longest main takes to settle a roster read (Codex `--version` probe 5s + `model/list` 8s;
 * Claude's probe 10s). The re-read budget must outlast it or the picker stays `loading` (F3).
 */
export const MAIN_ROSTER_SETTLE_MS = 13000;

export const MAX_RELOADS = Math.ceil((MAIN_ROSTER_SETTLE_MS + 2000) / RELOAD_DELAY_MS);

export interface RuntimeCatalogsState {
  catalogs: ModelCatalogs;
  /** Adopt a raw settings reply. A reply that is not an object (a failed read) keeps what is held. */
  adopt: (reply: unknown) => void;
  /** A read effect's dependency: it changes while a roster is loading. */
  reloadToken: number;
  /** The catalog for one runtime (`''` = the default runtime), or `null`. */
  catalogFor: (runtimeId: string, defaultRuntimeId: string) => ModelCatalog | null;
}

export function useRuntimeCatalogs(): RuntimeCatalogsState {
  const [catalogs, setCatalogs] = useState<ModelCatalogs>(NO_CATALOGS);
  const [reloadToken, setReloadToken] = useState(0);
  const [reloadsLeft, setReloadsLeft] = useState(MAX_RELOADS);

  const adopt = useCallback((reply: unknown) => {
    if (!reply || typeof reply !== "object") return;
    const row = reply as { catalogs?: unknown; catalogVersion?: unknown };
    setCatalogs(normalizeCatalogs(row.catalogs, row.catalogVersion));
  }, []);

  const loading = useMemo(
    () => Object.values(catalogs).some((c) => c.status === "loading"),
    [catalogs]
  );

  // The two settled statuses an operator's repair (install, sign in) can change.
  const settledFailure = useMemo(
    () => Object.values(catalogs).some((c) => c.status === "unavailable" || c.status === "stale"),
    [catalogs]
  );

  const stalled = loading && reloadsLeft <= 0;

  useEffect(() => {
    if ((!settledFailure && !stalled) || typeof window === "undefined") return;
    const reread = () => {
      if (document.visibilityState === "hidden") return;
      setReloadsLeft(MAX_RELOADS);
      setReloadToken((n) => n + 1);
    };
    window.addEventListener("focus", reread);
    document.addEventListener("visibilitychange", reread);
    return () => {
      window.removeEventListener("focus", reread);
      document.removeEventListener("visibilitychange", reread);
    };
  }, [settledFailure, stalled]);

  useEffect(() => {
    if (!loading || reloadsLeft <= 0) return;
    const timer = setTimeout(() => {
      setReloadsLeft((n) => n - 1);
      setReloadToken((n) => n + 1);
    }, RELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading, reloadsLeft, catalogs]);

  const read = useCallback(
    (runtimeId: string, defaultRuntimeId: string): ModelCatalog | null => {
      const id = runtimeId || defaultRuntimeId;
      return id ? catalogFor(catalogs, id) : null;
    },
    [catalogs]
  );

  return { catalogs, adopt, reloadToken, catalogFor: read };
}
