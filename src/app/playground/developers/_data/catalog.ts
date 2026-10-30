/**
 * The device hierarchy, four levels (Samuel, 2026-10-29): Category, then Integration (what we
 * connect through, a brand SDK or a platform), then Model, then a user's physical device
 * (`./users.ts`). A developer adds an INTEGRATION. Levels never share one list. The simulator is
 * not an entry here: it is a test option on each model. Capability ids, tiers and policies come
 * from `@dopl/device-contracts`; live models list what their adapters publish.
 */
import type { CapabilityId, DeliverIntent, DeviceKind, RiskTier } from "@dopl/device-contracts";
import { CAPABILITY_RISK_TIER, type RISK_TIER_DEFAULT_POLICY } from "@dopl/device-contracts";

export type CategoryId = "glasses" | "desktop" | "phone" | "vehicle" | "home" | "robots";
export type IntegrationId = "even_realities" | "meta" | "mentra" | "dopl_desktop" | "ios" | "carplay" | "home_assistant";
export type ModelId = "g2" | "meta_glasses" | "mentra_glasses" | "macos" | "iphone_16" | "any_car" | "thermostat";
export type IntegrationStatus = "testing" | "live";
export type Surface = "lens" | "panel";

export interface Category {
  id: CategoryId;
  name: string;
  /** The contract's device kind, for the glyph. Home merges `home_hub` and `home_device`. */
  kind: DeviceKind;
}

export const CATEGORIES: readonly Category[] = [
  { id: "glasses", name: "Glasses", kind: "glasses" },
  { id: "desktop", name: "Desktop", kind: "desktop" },
  { id: "phone", name: "Phone", kind: "phone" },
  { id: "vehicle", name: "Vehicle", kind: "vehicle" },
  { id: "home", name: "Home", kind: "home_hub" },
  { id: "robots", name: "Robots", kind: "robot" },
];

export interface Model {
  id: ModelId;
  name: string;
  integrationId: IntegrationId;
  capabilities: readonly CapabilityId[];
  intents: readonly DeliverIntent[];
  surface: Surface;
  /** Hard limits of the hardware: the safety floor an override cannot pass. */
  floor: { maxLines: number; maxChars: number; lineWidth: number; maxOptions: number };
}

export interface Integration {
  id: IntegrationId;
  name: string;
  categoryId: CategoryId;
  comingSoon: boolean;
  adapter: string;
  models: readonly Model[];
}

const LENS_FLOOR = { maxLines: 4, maxChars: 400, lineWidth: 34, maxOptions: 4 };
const PANEL_FLOOR = { maxLines: 12, maxChars: 1200, lineWidth: 46, maxOptions: 4 };

export const INTEGRATIONS: readonly Integration[] = [
  {
    id: "even_realities",
    name: "Even Realities",
    categoryId: "glasses",
    comingSoon: false,
    adapter: "even_g2@0.1.0",
    models: [
      {
        id: "g2",
        name: "G2",
        integrationId: "even_realities",
        capabilities: ["presence.read", "present.notify", "present.display", "ask.choice", "input.utterance", "input.tap"],
        intents: ["message", "ask", "notify", "display"],
        surface: "lens",
        floor: LENS_FLOOR,
      },
    ],
  },
  {
    id: "meta",
    name: "Meta",
    categoryId: "glasses",
    comingSoon: true,
    adapter: "meta@preview",
    models: [
      {
        id: "meta_glasses",
        name: "Meta glasses",
        integrationId: "meta",
        capabilities: ["presence.read", "present.notify", "present.speak", "capture.photo", "input.utterance"],
        intents: ["message", "notify"],
        surface: "lens",
        floor: LENS_FLOOR,
      },
    ],
  },
  {
    id: "mentra",
    name: "Mentra",
    categoryId: "glasses",
    comingSoon: true,
    adapter: "mentra@preview",
    models: [
      {
        id: "mentra_glasses",
        name: "Mentra glasses",
        integrationId: "mentra",
        capabilities: ["presence.read", "present.notify", "present.display", "ask.choice", "capture.photo", "input.utterance"],
        intents: ["message", "ask", "notify", "display"],
        surface: "lens",
        floor: LENS_FLOOR,
      },
    ],
  },
  {
    id: "dopl_desktop",
    name: "Dopl desktop app",
    categoryId: "desktop",
    comingSoon: false,
    adapter: "desktop@0.1.0",
    models: [
      {
        id: "macos",
        name: "macOS",
        integrationId: "dopl_desktop",
        capabilities: ["presence.read", "present.notify"],
        intents: ["message", "notify"],
        surface: "panel",
        floor: PANEL_FLOOR,
      },
    ],
  },
  {
    id: "ios",
    name: "iOS",
    categoryId: "phone",
    comingSoon: true,
    adapter: "ios@preview",
    models: [
      {
        id: "iphone_16",
        name: "iPhone 16",
        integrationId: "ios",
        capabilities: ["presence.read", "present.notify", "present.haptic", "ask.choice", "ask.confirm", "ask.text", "capture.photo"],
        intents: ["message", "ask", "notify"],
        surface: "panel",
        floor: PANEL_FLOOR,
      },
    ],
  },
  {
    id: "carplay",
    name: "CarPlay",
    categoryId: "vehicle",
    comingSoon: true,
    adapter: "carplay@preview",
    models: [
      {
        id: "any_car",
        name: "Any supported car",
        integrationId: "carplay",
        capabilities: ["telemetry.read", "present.speak", "act.navigate", "act.lock", "act.motion.vehicle"],
        intents: ["notify"],
        surface: "panel",
        floor: PANEL_FLOOR,
      },
    ],
  },
  {
    id: "home_assistant",
    name: "Home Assistant",
    categoryId: "home",
    comingSoon: true,
    adapter: "home_assistant@preview",
    models: [
      {
        id: "thermostat",
        name: "Thermostat",
        integrationId: "home_assistant",
        capabilities: ["state.read", "present.speak", "act.set", "act.lock"],
        intents: ["notify"],
        surface: "panel",
        floor: PANEL_FLOOR,
      },
    ],
  },
];

export const ALL_MODELS: readonly Model[] = INTEGRATIONS.flatMap((i) => i.models);

export const integrationById = (id: string): Integration | null => INTEGRATIONS.find((i) => i.id === id) ?? null;
export const categoryById = (id: CategoryId): Category => CATEGORIES.find((c) => c.id === id)!;
export const modelById = (id: ModelId): Model => ALL_MODELS.find((m) => m.id === id)!;
export const integrationOf = (id: ModelId): Integration => integrationById(modelById(id).integrationId)!;
export const categoryOf = (id: ModelId): Category => categoryById(integrationOf(id).categoryId);
export const integrationsIn = (id: CategoryId): Integration[] => INTEGRATIONS.filter((i) => i.categoryId === id);
export const modelsIn = (id: CategoryId): Model[] => integrationsIn(id).flatMap((i) => i.models);

/** "Glasses › Even Realities › G2", what a user's physical device shows under its name. */
export const trail = (id: ModelId): [string, string, string] => [categoryOf(id).name, integrationOf(id).name, modelById(id).name];

export const SEED_INTEGRATIONS: Partial<Record<IntegrationId, { status: IntegrationStatus; addedAt: string; testsPassed: number }>> = {
  even_realities: { status: "live", addedAt: "2026-08-14T15:00:00.000Z", testsPassed: 6 },
  dopl_desktop: { status: "live", addedAt: "2026-09-02T17:30:00.000Z", testsPassed: 2 },
};

/** How a tier is confirmed unless the project narrows it; T4 can never drop to `none`. */
export type ConfirmMode = "none" | "on_device" | "trusted_surface" | "deny";

export const CONFIRM_LABEL: Record<ConfirmMode, string> = {
  none: "No confirmation",
  on_device: "Confirm on device",
  trusted_surface: "Confirm on trusted surface",
  deny: "Always deny",
};

export const TIER_LABEL: Record<RiskTier, string> = {
  T0: "Read",
  T1: "Present",
  T2: "Ambient sensing",
  T3: "Reversible action",
  T4: "Safety critical",
};

export const POLICY_LABEL: Record<(typeof RISK_TIER_DEFAULT_POLICY)[RiskTier], string> = {
  allow: "Allowed",
  explicit_grant: "User grant required",
  allow_confirm_configurable: "Allowed, confirmation configurable",
  confirm_every_call: "Confirmed on every call",
};

export function defaultConfirm(capability: CapabilityId): ConfirmMode {
  const tier = CAPABILITY_RISK_TIER[capability];
  return tier === "T3" || tier === "T4" ? "on_device" : "none";
}

export interface CapabilitySetting {
  on: boolean;
  confirm: ConfirmMode;
}

export function seedCapabilities(model: Model): Partial<Record<CapabilityId, CapabilitySetting>> {
  const out: Partial<Record<CapabilityId, CapabilitySetting>> = {};
  for (const id of model.capabilities) {
    const tier = CAPABILITY_RISK_TIER[id];
    out[id] = { on: tier === "T0" || tier === "T1", confirm: defaultConfirm(id) };
  }
  return out;
}

/** A capability as a function chip: what it lets an agent do. Reads carry no chip. */
const CAPABILITY_LABEL: Partial<Record<CapabilityId, string>> = {
  "present.notify": "Notify",
  "present.display": "Display",
  "present.speak": "Speak",
  "present.haptic": "Haptics",
  "ask.choice": "Ask",
  "ask.confirm": "Confirm",
  "ask.text": "Text reply",
  "input.utterance": "Voice",
  "input.tap": "Tap",
  "capture.photo": "Camera",
  "act.navigate": "Navigate",
  "act.lock": "Lock",
  "act.set": "Control",
};

export const functionsOf = (model: Model): string[] => model.capabilities.flatMap((c) => CAPABILITY_LABEL[c] ?? []);
