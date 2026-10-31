/** The Devices catalog's rules: what a card is built from, and what each filter keeps. */
import { CATEGORIES, functionsOf, integrationById, integrationsIn, type Category, type CategoryId, type Integration, type Model } from "../_data/catalog";
import type { OwnedDevice, PortalUser } from "../_data/users";
import type { AddedIntegration, PortalState } from "../_components/portal-store";
import { devicesOfModel, figuresOfDevices, type Figures } from "../_components/stats";

export type DeviceQuick = "all" | "live" | "testing" | "attention";
export const DEVICE_QUICK: { key: DeviceQuick; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "testing", label: "Testing" },
  { key: "attention", label: "Needs attention" },
];
export const LOW_SHOWN = 90;

export interface ModelRow {
  model: Model;
  integration: Integration;
  category: Category;
  added: AddedIntegration;
  devices: OwnedDevice[];
  figures: Figures;
  functions: string[];
  relink: number;
  stale: number;
}

export function modelRows(state: PortalState, users: PortalUser[]): ModelRow[] {
  return CATEGORIES.flatMap((category) =>
    integrationsIn(category.id).flatMap((integration) => {
      const added = state.integrations[integration.id];
      if (!added) return [];
      return integration.models.map((model) => {
        const devices = devicesOfModel(users, model.id);
        return {
          model,
          integration,
          category,
          added,
          devices,
          figures: figuresOfDevices(devices),
          functions: functionsOf(model),
          relink: devices.filter((d) => d.state === "needs_relink").length,
          stale: devices.filter((d) => d.state === "stale").length,
        };
      });
    })
  );
}

export const attentionOf = (row: ModelRow) => row.relink + row.stale;

export interface DeviceFilters {
  q: string;
  quick: DeviceQuick;
  category: CategoryId | "all";
  integration: string;
  fn: string;
}
export const NO_DEVICE_FILTERS: DeviceFilters = { q: "", quick: "all", category: "all", integration: "all", fn: "all" };

export function keeps(row: ModelRow, f: DeviceFilters): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && ![row.model.name, row.integration.name, row.category.name, ...row.functions].some((v) => v.toLowerCase().includes(q))) return false;
  if (f.quick === "live" && row.added.status !== "live") return false;
  if (f.quick === "testing" && row.added.status !== "testing") return false;
  if (f.quick === "attention" && attentionOf(row) === 0) return false;
  if (f.category !== "all" && row.category.id !== f.category) return false;
  if (f.integration !== "all" && row.integration.id !== f.integration) return false;
  return f.fn === "all" || row.functions.includes(f.fn);
}

/** Models a project can still add in a category: the add card's offer. */
export const availableModels = (state: PortalState, id: CategoryId): Model[] => integrationsIn(id).filter((i) => !state.integrations[i.id]).flatMap((i) => i.models);

export const integrationName = (id: string) => integrationById(id)?.name ?? id;

/** Seven days of calls, drawn from the week's total; deterministic per model. */
export function weekBars(id: string): number[] {
  const seed = [...id].reduce((n, c) => n + c.charCodeAt(0), 0);
  const weights = Array.from({ length: 7 }, (_, i) => 3 + ((seed * (i + 3)) % 7));
  const top = Math.max(...weights);
  return weights.map((w) => (w / top) * 100);
}
