"use client";

/**
 * THE PER-RUNTIME MODEL CATALOGS ON A SETTINGS READ — the half of
 * `use-channel-launch-posture.ts` and `use-launch-selection.ts` that is about the RUNTIME ROSTER
 * rather than about a channel or a defaults record (2026-09-21, U6).
 *
 * ⚠ **ONE MODULE BECAUSE IT IS ONE RULE.** Both hooks read the SAME two fields off the SAME
 * main-process assembly (`main/channel-runtime-reply.js`) and both render the SAME model row; a
 * copy in each is the two-readers-one-fact defect with a MODEL LIST as the thing that drifts.
 *
 * ⚠ **THE `loading` RE-READ IS BOUNDED, AND IT IS NOT A POLL.** A live roster costs a
 * `codex app-server` spawn, so main answers `loading` on a cold process and reads in the
 * background; something has to look again or the picker stays empty forever. It re-reads at most
 * {@link MAX_RELOADS} times, only while some catalog is still `loading`, and stops the moment
 * every catalog has settled — a bounded hand-off, not a standing timer. When the budget runs out
 * the status STAYS `loading`, because "nothing came back yet" is the true statement and inventing
 * `unavailable` here would put words in the desktop's mouth (INVARIANTS §11).
 *
 * ⚠ **A SETTLED FAILURE IS RE-READ WHEN THE WINDOW COMES BACK, AND THAT IS NOT A POLL EITHER**
 * (CXP-5, 2026-09-22). `unavailable` / `stale` is routinely the operator's cue to go and install
 * or sign in to the CLI — in a terminal, outside this window — so the moment they return (window
 * `focus`, or the document turning visible) is the one moment a re-read can say something new.
 * Each return re-reads once, with a fresh `loading` budget, because main answers a retry in flight
 * as `loading` (`main/runtime/model-catalog.js › refresh`). No timer runs while nothing is loading.
 *
 * ⚠ NOTHING HERE SUBSTITUTES A RUNTIME'S MODELS: a runtime with no catalog reads `null`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  catalogFor,
  normalizeCatalogs,
  NO_CATALOGS,
  type ModelCatalog,
  type ModelCatalogs,
} from "../lib/model-catalog";

/** How long between re-reads while a live roster is still being fetched. */
export const RELOAD_DELAY_MS = 1200;

/**
 * The longest main takes to SETTLE a roster read: Codex's `--version` probe (5s,
 * `codex/client.js › PROBE_TIMEOUT_MS`) plus its `model/list` leash (8s, `codex/models.js ›
 * LIST_TIMEOUT_MS`); Claude's handshake probe is 10s. The budget must outlast it, or the picker
 * stops asking before main answers and stays `loading` (F3).
 */
export const MAIN_ROSTER_SETTLE_MS = 13000;

/** How many re-reads: enough to span {@link MAIN_ROSTER_SETTLE_MS} with a margin. */
export const MAX_RELOADS = Math.ceil((MAIN_ROSTER_SETTLE_MS + 2000) / RELOAD_DELAY_MS);

export interface RuntimeCatalogsState {
  /** Every runtime's catalog, keyed by runtime id. `{}` until a read answers. */
  catalogs: ModelCatalogs;
  /** Adopt a raw settings reply. A reply that is not an object (a failed read) keeps what is held. */
  adopt: (reply: unknown) => void;
  /** Bump this into a read effect's dependency list — it changes while a roster is loading. */
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

  // ⚠ `unavailable` AND `stale` — the two settled statuses a repair can change. See the header.
  const settledFailure = useMemo(
    () => Object.values(catalogs).some((c) => c.status === "unavailable" || c.status === "stale"),
    [catalogs]
  );

  // A catalog still `loading` after the whole budget is re-read on focus too (F3).
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
