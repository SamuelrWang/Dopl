/** Category, then integration, then model. A developer adds an integration. */
import type { DeviceKind } from "@dopl/device-contracts";

export type CategoryId = "glasses" | "desktop" | "phone" | "vehicle" | "home" | "robots";
export type IntegrationId = "even_realities" | "meta" | "mentra" | "dopl_desktop" | "ios" | "carplay" | "home_assistant";
export type ModelId = "g2" | "meta_glasses" | "mentra_glasses" | "macos" | "iphone_16" | "any_car" | "thermostat";

export interface Category {
  id: CategoryId;
  name: string;
  kind: DeviceKind;
}

export interface Integration {
  id: IntegrationId;
  name: string;
  categoryId: CategoryId;
  comingSoon: boolean;
  models: readonly { id: ModelId; name: string }[];
  /** The panel's line limit: the hardware's, which a setting cannot pass. */
  lineLimit: number;
}

export const CATEGORIES: readonly Category[] = [
  { id: "glasses", name: "Glasses", kind: "glasses" },
  { id: "desktop", name: "Desktop", kind: "desktop" },
  { id: "phone", name: "Phone", kind: "phone" },
  { id: "vehicle", name: "Vehicle", kind: "vehicle" },
  { id: "home", name: "Home", kind: "home_hub" },
  { id: "robots", name: "Robots", kind: "robot" },
];

export const INTEGRATIONS: readonly Integration[] = [
  { id: "even_realities", name: "Even Realities", categoryId: "glasses", comingSoon: false, models: [{ id: "g2", name: "G2" }], lineLimit: 4 },
  { id: "meta", name: "Meta", categoryId: "glasses", comingSoon: true, models: [{ id: "meta_glasses", name: "Meta glasses" }], lineLimit: 4 },
  { id: "mentra", name: "Mentra", categoryId: "glasses", comingSoon: true, models: [{ id: "mentra_glasses", name: "Mentra glasses" }], lineLimit: 4 },
  { id: "dopl_desktop", name: "Dopl desktop app", categoryId: "desktop", comingSoon: false, models: [{ id: "macos", name: "macOS" }], lineLimit: 12 },
  { id: "ios", name: "iOS", categoryId: "phone", comingSoon: true, models: [{ id: "iphone_16", name: "iPhone 16" }], lineLimit: 12 },
  { id: "carplay", name: "CarPlay", categoryId: "vehicle", comingSoon: true, models: [{ id: "any_car", name: "Any supported car" }], lineLimit: 12 },
  { id: "home_assistant", name: "Home Assistant", categoryId: "home", comingSoon: true, models: [{ id: "thermostat", name: "Thermostat" }], lineLimit: 12 },
];

export const integrationById = (id: IntegrationId): Integration => INTEGRATIONS.find((i) => i.id === id)!;
export const integrationsIn = (id: CategoryId): Integration[] => INTEGRATIONS.filter((i) => i.categoryId === id);
export const categoryById = (id: CategoryId): Category => CATEGORIES.find((c) => c.id === id)!;
export const integrationOfModel = (id: ModelId): Integration => INTEGRATIONS.find((i) => i.models.some((m) => m.id === id))!;
export const modelName = (id: ModelId): string => integrationOfModel(id).models.find((m) => m.id === id)!.name;
