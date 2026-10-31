/** The Devices catalog's rules: what a card is built from, and what each filter keeps. A model appears once a device of it is connected. */
import { CATEGORIES, INTEGRATIONS, functionsOf, integrationById, type Category, type CategoryId, type Integration, type Model } from "@/features/device-sdk/portal/catalog";
import { devicesOfModel, figuresOfDevices, type Figures, type OwnedDevice, type PortalUser } from "@/features/device-sdk/portal/view";

type DeviceQuick = "all" | "attention";
export const DEVICE_QUICK: { key: DeviceQuick; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
];

export interface ModelRow {
  model: Model;
  integration: Integration;
  category: Category;
  devices: OwnedDevice[];
  figures: Figures;
  functions: string[];
  relink: number;
  stale: number;
}

export function modelRows(users: readonly PortalUser[]): ModelRow[] {
  return CATEGORIES.flatMap((category) =>
    INTEGRATIONS.filter((i) => i.categoryId === category.id).flatMap((integration) =>
      integration.models.flatMap((model) => {
        const devices = devicesOfModel(users, model.id);
        if (devices.length === 0) return [];
        return [{ model, integration, category, devices, figures: figuresOfDevices(devices), functions: functionsOf(model), relink: devices.filter((d) => d.state === "needs_relink").length, stale: devices.filter((d) => d.state === "stale").length }];
      })
    )
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
  if (f.quick === "attention" && attentionOf(row) === 0) return false;
  if (f.category !== "all" && row.category.id !== f.category) return false;
  if (f.integration !== "all" && row.integration.id !== f.integration) return false;
  return f.fn === "all" || row.functions.includes(f.fn);
}

export const integrationName = (id: string) => integrationById(id)?.name ?? id;
