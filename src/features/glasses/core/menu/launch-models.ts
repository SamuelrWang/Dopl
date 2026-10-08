/**
 * WHAT THE LENS OFFERS PER RUNTIME (2026-10-08), pure.
 *
 * The roster is the desktop's; since 2026-10-08 it publishes it (`features/model-catalogs`), so:
 * - a FRESH catalog → "Default" + the desktop's own models, its labels. Past launches the catalog no
 *   longer lists are NOT offered: the desktop would refuse them as "no-model".
 * - a STALE catalog (old, or the desktop stopped publishing this runtime while publishing others)
 *   → "Default" + what it last listed + past launches, and a note to open Dopl on the computer.
 * - NO catalog → "Default" + past launches (the behaviour before this table), and the same note.
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

export function launchModels(
  runtime: string,
  catalogs: readonly StoredCatalog[],
  historyIds: readonly string[],
  nowMs: number,
  label: (id: string, raw: string) => string = (_id, raw) => raw
): RuntimeModels {
  const row = catalogs.find((c) => c.runtime === runtime && c.models.length > 0) ?? null;
  const newest = Math.max(0, ...catalogs.map((c) => Date.parse(c.publishedAt)).filter(Number.isFinite));
  const stale = row === null || catalogIsStale(row, newest, nowMs);

  const out: LaunchModelChoice[] = [{ id: "", label: "Default" }];
  const seen = new Set<string>([""]);
  const add = (id: string, raw: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, label: label(id, raw) });
  };
  for (const m of row?.models ?? []) add(m.id, m.short || m.label || agentModelLabel(m.id));
  if (stale) for (const id of historyIds) add(id, agentModelLabel(id));
  return { models: out, stale, note: stale ? REFRESH_NOTE : null };
}
