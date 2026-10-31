/**
 * The device hierarchy the portal shows: Category, then Integration (what we connect through), then Model,
 * then a user's physical device. Only what has a wired adapter is listed. Pure, so client pages can read it;
 * `catalog.test.ts` holds the capability lists equal to the adapters' own `describe()`.
 */
import type { CapabilityId, DeviceKind, RiskTier } from "@dopl/device-contracts";

export type CategoryId = "glasses" | "desktop" | "phone" | "home" | "watch" | "vehicle" | "robots";
export type IntegrationId = "even_realities" | "dopl_desktop" | "google_home" | "simulator";
export type ModelId = "g2" | "macos" | "google_speaker" | "simulated";

export interface Category {
  id: CategoryId;
  name: string;
  kinds: readonly DeviceKind[];
}

export const CATEGORIES: readonly Category[] = [
  { id: "glasses", name: "Glasses", kinds: ["glasses"] },
  { id: "desktop", name: "Desktop", kinds: ["desktop"] },
  { id: "phone", name: "Phone", kinds: ["phone"] },
  { id: "home", name: "Home", kinds: ["home_hub", "home_device"] },
  { id: "watch", name: "Watch", kinds: ["watch"] },
  { id: "vehicle", name: "Vehicle", kinds: ["vehicle"] },
  { id: "robots", name: "Robots", kinds: ["robot"] },
];

export interface Model {
  id: ModelId;
  name: string;
  integrationId: IntegrationId;
  /** The default capabilities this model's adapter publishes. A simulated device's vary by kind. */
  capabilities: readonly CapabilityId[];
}

export interface Integration {
  id: IntegrationId;
  name: string;
  /** The adapter id on `devices.adapter_id`. */
  adapterId: string;
  adapter: string;
  categoryId: CategoryId;
  models: readonly Model[];
  /** Only offered in the test environment. */
  testOnly?: boolean;
}

export const INTEGRATIONS: readonly Integration[] = [
  {
    id: "even_realities",
    name: "Even Realities",
    adapterId: "even_g2",
    adapter: "even_g2@0.1.0",
    categoryId: "glasses",
    models: [{ id: "g2", name: "G2", integrationId: "even_realities", capabilities: ["presence.read", "present.notify", "present.display", "ask.choice", "input.utterance", "input.tap"] }],
  },
  {
    id: "dopl_desktop",
    name: "Dopl desktop",
    adapterId: "desktop",
    adapter: "desktop@0.1.0",
    categoryId: "desktop",
    models: [{ id: "macos", name: "Mac", integrationId: "dopl_desktop", capabilities: ["presence.read", "present.notify"] }],
  },
  {
    id: "google_home",
    name: "Google Home",
    adapterId: "google_home",
    adapter: "google_home@0.1.0",
    categoryId: "home",
    models: [{ id: "google_speaker", name: "Speaker", integrationId: "google_home", capabilities: ["presence.read", "present.speak"] }],
  },
  {
    id: "simulator",
    name: "Simulator",
    adapterId: "simulator",
    adapter: "simulator@0.1.0",
    categoryId: "phone",
    testOnly: true,
    models: [{ id: "simulated", name: "Simulated device", integrationId: "simulator", capabilities: ["presence.read", "present.notify", "present.display", "ask.choice"] }],
  },
];

export const ALL_MODELS: readonly Model[] = INTEGRATIONS.flatMap((i) => i.models);

export const integrationById = (id: string): Integration | null => INTEGRATIONS.find((i) => i.id === id) ?? null;
export const categoryById = (id: CategoryId): Category => CATEGORIES.find((c) => c.id === id)!;
export const modelById = (id: ModelId): Model => ALL_MODELS.find((m) => m.id === id)!;
export const integrationOf = (id: ModelId): Integration => integrationById(modelById(id).integrationId)!;
export const categoryOf = (id: ModelId): Category => categoryById(integrationOf(id).categoryId);

/** A device row's model, by its adapter. Null for an adapter this portal does not list. */
export function modelOfAdapter(adapterId: string): ModelId | null {
  return INTEGRATIONS.find((i) => i.adapterId === adapterId)?.models[0].id ?? null;
}

export const trail = (id: ModelId): [string, string, string] => [categoryOf(id).name, integrationOf(id).name, modelById(id).name];

export const TIER_LABEL: Record<RiskTier, string> = {
  T0: "Read",
  T1: "Present",
  T2: "Ambient sensing",
  T3: "Reversible action",
  T4: "Safety critical",
};

/** What a tier does by default, as the runtime enforces it: nothing can complete a confirmation yet, so T4 is denied. */
export const TIER_POLICY: Record<RiskTier, string> = {
  T0: "Allowed",
  T1: "Allowed",
  T2: "User grant required",
  T3: "User grant required",
  T4: "Denied",
};

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
  "act.media": "Media",
};

export const functionsOf = (model: Model): string[] => model.capabilities.flatMap((c) => CAPABILITY_LABEL[c] ?? []);

/** The real key scopes (`@dopl/device-contracts › API_KEY_SCOPES`), with the words the portal uses. */
export const KEY_SCOPES = [
  { id: "actions:write", name: "Send to devices" },
  { id: "devices:read", name: "Read devices and users" },
  { id: "connect", name: "Link devices" },
  { id: "analytics:read", name: "Read events" },
] as const;

/** Events something emits today. The rest of the contract's names have no sender yet, so no one may pick them. */
export const LIVE_WEBHOOK_EVENTS = ["action.completed", "action.failed", "connection.created", "connection.revoked", "input.utterance"] as const;
