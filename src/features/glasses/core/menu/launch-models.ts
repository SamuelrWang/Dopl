/**
 * WHAT THE LENS OFFERS PER RUNTIME (2026-10-08), pure.
 *
 * Each desktop publishes its roster per runtime (`features/model-catalogs`), ONE ROW PER COMPUTER.
 * The lens reads the UNION, with freshness judged per computer:
 * - any FRESH row for the runtime → "Default" + the fresh computers' models (newest first, deduped).
 *   Past launches no fresh list carries are NOT offered: the desktop would refuse them as "no-model".
 * - only STALE rows (old, or that computer stopped publishing this runtime while publishing others)
 *   → "Default" + what they last listed + past launches, and a note to open Dopl on the computer.
 * - NO row → "Default" + past launches (the behaviour before catalogs), and the same note.
 * "Default" is always first: the runtime's own default, which the desktop resolves at launch.
 */

import { agentModelLabel } from "@/features/channels/lib/agent-models";
import { catalogIsStale, type StoredCatalog } from "@/features/model-catalogs/contract";

export const REFRESH_NOTE = "Open Dopl on your computer to refresh this list.";

export interface LaunchModelChoice {
  id: string;
  label: string;
}

export interface RuntimeModels {
  models: LaunchModelChoice[];
  stale: boolean;
  note: string | null;
}

/** Each computer's newest publish, across every runtime it publishes. */
function newestByDevice(catalogs: readonly StoredCatalog[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of catalogs) {
    const at = Date.parse(c.publishedAt);
    if (!Number.isFinite(at)) continue;
    out.set(c.deviceId, Math.max(out.get(c.deviceId) ?? 0, at));
  }
  return out;
}

const newestFirst = (a: StoredCatalog, b: StoredCatalog) =>
  (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0);

export function launchModels(
  runtime: string,
  catalogs: readonly StoredCatalog[],
  historyIds: readonly string[],
  nowMs: number,
  label: (id: string, raw: string) => string = (_id, raw) => raw
): RuntimeModels {
  const newest = newestByDevice(catalogs);
  const rows = catalogs.filter((c) => c.runtime === runtime && c.models.length > 0).sort(newestFirst);
  const fresh = rows.filter((c) => !catalogIsStale(c, newest.get(c.deviceId) ?? 0, nowMs));
  const stale = fresh.length === 0;

  const out: LaunchModelChoice[] = [{ id: "", label: "Default" }];
  const seen = new Set<string>([""]);
  const add = (id: string, raw: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, label: label(id, raw) });
  };
  for (const row of stale ? rows : fresh) {
    for (const m of row.models) add(m.id, m.short || m.label || agentModelLabel(m.id));
  }
  if (stale) for (const id of historyIds) add(id, agentModelLabel(id));
  return { models: out, stale, note: stale ? REFRESH_NOTE : null };
}
