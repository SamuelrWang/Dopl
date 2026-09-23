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
 * ⚠ **NOTHING HERE SUBSTITUTES A RUNTIME'S MODELS.** The only fallback in this file is the
 * DEFAULT runtime's frozen list, and only when the desktop said nothing at all
 * (`hasCatalogKey === false`, i.e. a build older than the catalog contract). Every other runtime
 * on such a build gets `null` and renders the platform default — answering it with Claude's four
 * ids is the exact failure the plan forbids.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultRuntimeFallbackCatalog } from "../lib/agent-models";
import {
  catalogFor,
  hasCatalogKey,
  normalizeCatalogs,
  NO_CATALOGS,
  type ModelCatalog,
  type ModelCatalogs,
} from "../lib/model-catalog";

/** How many times a settings read is repeated while a live roster is still being fetched. */
export const MAX_RELOADS = 6;

/** How long between those re-reads. ⚠ Comfortably under main's own 8s `model/list` leash. */
export const RELOAD_DELAY_MS = 1200;

export interface RuntimeCatalogsState {
  /** Every runtime's catalog, keyed by runtime id. `{}` until a read answers. */
  catalogs: ModelCatalogs;
  /**
   * THIS DESKTOP SPOKE THE CATALOG CONTRACT AT ALL. ⚠ FALSE IS "IT DID NOT SAY", NOT "NO MODELS":
   * a build older than U6 omits the key entirely, and an unknown-is-empty read would empty the
   * picker on a machine that works perfectly. Latched to true, `connectedKnown`'s rule.
   */
  catalogsKnown: boolean;
  /** Adopt a raw settings reply. ⚠ Reads the RAW object, before any normalizer, so the own-key
   *  probe sees what the desktop actually sent. */
  adopt: (reply: unknown) => void;
  /** Bump this into a read effect's dependency list — it changes while a roster is loading. */
  reloadToken: number;
  /** The catalog for one runtime, with the older-desktop fallback applied. */
  catalogFor: (runtimeId: string, defaultRuntimeId: string) => ModelCatalog | null;
}

export function useRuntimeCatalogs(): RuntimeCatalogsState {
  const [catalogs, setCatalogs] = useState<ModelCatalogs>(NO_CATALOGS);
  const [catalogsKnown, setCatalogsKnown] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [reloadsLeft, setReloadsLeft] = useState(MAX_RELOADS);

  const adopt = useCallback((reply: unknown) => {
    if (!hasCatalogKey(reply)) return; // an older desktop: leave `catalogsKnown` false
    setCatalogsKnown(true);
    const row = reply as { catalogs?: unknown; catalogVersion?: unknown };
    const next = normalizeCatalogs(row.catalogs, row.catalogVersion);
    setCatalogs(next);
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

  useEffect(() => {
    if (!settledFailure || typeof window === "undefined") return;
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
  }, [settledFailure]);

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
      if (!id) return null;
      const hit = catalogFor(catalogs, id);
      if (hit) return hit;
      // ⚠ THE ONE FALLBACK, AND IT IS SCOPED TWICE: only when the desktop said NOTHING, and only
      // for the DEFAULT runtime. See the header.
      if (catalogsKnown || id !== defaultRuntimeId) return null;
      return defaultRuntimeFallbackCatalog(id);
    },
    [catalogs, catalogsKnown]
  );

  return { catalogs, catalogsKnown, adopt, reloadToken, catalogFor: read };
}
