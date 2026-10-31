/**
 * The end users of Larkfield Assist and the PHYSICAL devices they own. 25 live users and 4 test
 * users. A user's totals are the sum of their devices, so every page's numbers add up.
 */
import type { CapabilityScope } from "@dopl/device-contracts";
import { minsAgo, type Env } from "./company";
import type { ModelId } from "./catalog";

export type DeviceState = "online" | "offline" | "stale" | "needs_relink";

export interface OwnedDevice {
  id: string;
  userId: string;
  modelId: ModelId;
  /** A test device on a model, in the Test environment only. */
  simulated: boolean;
  name: string;
  firmware: string;
  state: DeviceState;
  lastSeenAt: string;
  pairedAt: string;
  deliveries7d: number;
  seen7d: number;
  grants: CapabilityScope[];
}

export type Plan = "free" | "pro" | "team";

export interface PortalUser {
  id: string;
  name: string;
  env: Env;
  plan: Plan;
  region: "us-east" | "us-west" | "eu-west" | "ap-south";
  devices: OwnedDevice[];
  activeDeviceId: string | null;
  lastDeliveryAt: string | null;
  lastActiveMins: number;
  prefs: UserPrefs;
}

export interface UserPrefs {
  tone: "neutral" | "brief" | "detailed";
  language: "en" | "es" | "de" | "ja" | "pt";
  quietFrom: string;
  quietTo: string;
  preferred: ModelId | "auto";
  blocked: ModelId[];
}

const G2_GRANTS: CapabilityScope[] = ["presence.read", "present.*", "ask.choice", "input.*"];
const DESKTOP_GRANTS: CapabilityScope[] = ["presence.read", "present.notify"];
const SIM_GRANTS: CapabilityScope[] = ["presence.read", "present.*", "ask.*", "input.*", "capture.photo"];

type DeviceSeed = [ModelId, string, string, DeviceState, number, number, number, number, boolean?];
//                 model   suffix  firmware state   lastSeenMins pairedDays deliveries seen simulated

const g2 = (suffix: string, fw: string, state: DeviceState, seen: number, paired: number, del: number, ok: number): DeviceSeed =>
  ["g2", suffix, fw, state, seen, paired, del, ok];
const desk = (suffix: string, fw: string, state: DeviceState, seen: number, paired: number, del: number, ok: number): DeviceSeed =>
  ["macos", suffix, fw, state, seen, paired, del, ok];
const sim = (model: ModelId, suffix: string, state: DeviceState, seen: number, paired: number, del: number): DeviceSeed =>
  [model, suffix, "sim 0.1.0", state, seen, paired, del, del, true];

interface UserSeed {
  id: string;
  name: string;
  plan: Plan;
  region: PortalUser["region"];
  active: number;
  env?: Env;
  devices: DeviceSeed[];
  prefs?: Partial<UserPrefs>;
}

const SEEDS: UserSeed[] = [
  { id: "tech_1042", name: "Amara Osei", plan: "team", region: "us-east", active: 3, devices: [g2("4b1c", "1.4.2", "online", 1, 74, 212, 207), desk("91ae", "1.43.0", "online", 2, 74, 64, 63)] },
  { id: "tech_1058", name: "Lucas Ferreira", plan: "team", region: "us-east", active: 8, devices: [g2("77d0", "1.4.2", "online", 4, 70, 188, 181)], prefs: { language: "pt" } },
  { id: "tech_1063", name: "Ingrid Solheim", plan: "pro", region: "eu-west", active: 12, devices: [g2("a2f9", "1.4.2", "online", 6, 66, 163, 160), desk("02bb", "1.43.0", "offline", 95, 41, 38, 37)], prefs: { language: "de", quietFrom: "20:00", quietTo: "07:00" } },
  { id: "tech_1077", name: "Kenji Morales", plan: "pro", region: "us-west", active: 21, devices: [g2("cc31", "1.3.8", "needs_relink", 2880, 62, 121, 96)] },
  { id: "tech_1084", name: "Nadia Rahman", plan: "team", region: "eu-west", active: 5, devices: [g2("18e7", "1.4.2", "online", 1, 60, 241, 236), desk("fa02", "1.43.0", "online", 3, 58, 77, 77)], prefs: { tone: "brief" } },
  { id: "tech_1091", name: "Oskar Lindqvist", plan: "free", region: "eu-west", active: 180, devices: [g2("3a6d", "1.3.8", "offline", 310, 55, 46, 43)] },
  { id: "tech_1096", name: "Thandi Mokoena", plan: "pro", region: "ap-south", active: 34, devices: [g2("90c4", "1.4.1", "online", 12, 53, 134, 128)] },
  { id: "tech_1107", name: "Tomasz Wrona", plan: "team", region: "eu-west", active: 2, devices: [g2("e115", "1.4.2", "online", 1, 3, 96, 95), g2("6d20", "1.3.8", "stale", 27360, 48, 41, 27), g2("b7f3", "1.3.8", "stale", 20160, 31, 18, 9)], prefs: { language: "de" } },
  { id: "tech_1113", name: "Sofia Marchetti", plan: "pro", region: "eu-west", active: 16, devices: [g2("5c88", "1.4.2", "online", 9, 47, 147, 143), desk("7e13", "1.42.1", "online", 14, 47, 29, 29)] },
  { id: "tech_1120", name: "Ethan Brandvold", plan: "free", region: "us-west", active: 1440, devices: [desk("c409", "1.41.0", "offline", 1460, 44, 22, 21)] },
  { id: "tech_1128", name: "Yara Haddad", plan: "team", region: "us-east", active: 7, devices: [g2("d93e", "1.4.2", "online", 3, 42, 204, 197)], prefs: { tone: "detailed", preferred: "g2" } },
  { id: "tech_1134", name: "Mateo Quiroga", plan: "pro", region: "us-west", active: 55, devices: [g2("2fb6", "1.3.8", "needs_relink", 4320, 40, 88, 61), desk("11d7", "1.43.0", "online", 40, 40, 31, 31)], prefs: { language: "es" } },
  { id: "tech_1141", name: "Hana Novakova", plan: "pro", region: "eu-west", active: 28, devices: [g2("84a1", "1.4.1", "online", 18, 37, 112, 107)] },
  { id: "tech_1149", name: "Bastien Leroy", plan: "free", region: "eu-west", active: 4320, devices: [g2("f07c", "1.3.8", "offline", 4400, 36, 17, 15)] },
  { id: "tech_1155", name: "Grace Oyelaran", plan: "team", region: "us-east", active: 11, devices: [g2("3e9a", "1.4.2", "online", 7, 33, 176, 172), desk("a640", "1.43.0", "online", 10, 33, 53, 52)] },
  { id: "tech_1162", name: "Rohan Pillai", plan: "pro", region: "ap-south", active: 42, devices: [g2("b25d", "1.4.1", "online", 30, 31, 98, 92)], prefs: { quietFrom: "22:00", quietTo: "06:00" } },
  { id: "tech_1168", name: "Elif Karaca", plan: "pro", region: "eu-west", active: 19, devices: [g2("61f8", "1.4.2", "online", 11, 29, 131, 129)], prefs: { blocked: ["macos"] } },
  { id: "tech_1173", name: "Caleb Whitlock", plan: "free", region: "us-east", active: 2880, devices: [desk("3cc2", "1.40.2", "offline", 2900, 26, 12, 12)] },
  { id: "tech_1179", name: "Mina Sorensen", plan: "team", region: "us-west", active: 6, devices: [g2("7a04", "1.4.2", "online", 2, 24, 158, 153), desk("e8b9", "1.43.0", "online", 5, 24, 44, 44)] },
  { id: "tech_1186", name: "Andre Baptiste", plan: "pro", region: "us-east", active: 73, devices: [g2("c16f", "1.3.8", "needs_relink", 1600, 21, 72, 54)] },
  { id: "tech_1192", name: "Zofia Kaminska", plan: "pro", region: "eu-west", active: 25, devices: [g2("49d2", "1.4.2", "online", 15, 18, 89, 87)], prefs: { language: "de" } },
  { id: "tech_1198", name: "Daniel Ikeda", plan: "team", region: "ap-south", active: 9, devices: [g2("ad77", "1.4.2", "online", 5, 14, 117, 115), desk("50ef", "1.43.0", "offline", 200, 14, 19, 18)], prefs: { language: "ja" } },
  { id: "tech_1204", name: "Clara Whitfield", plan: "free", region: "us-west", active: 610, devices: [g2("1be3", "1.4.1", "offline", 640, 9, 26, 25)] },
  { id: "tech_1211", name: "Idris Sesay", plan: "pro", region: "us-east", active: 38, devices: [g2("08ca", "1.4.2", "online", 22, 6, 64, 62)] },
  { id: "tech_1219", name: "Paloma Ruiz", plan: "pro", region: "us-west", active: 14, devices: [desk("9d31", "1.43.0", "online", 8, 4, 33, 33)], prefs: { language: "es" } },
  { id: "qa_mei", name: "Mei Tanaka-Ross", plan: "team", region: "us-east", active: 9, env: "test", devices: [sim("g2", "a100", "online", 1, 80, 318), g2("t771", "1.4.2", "online", 9, 60, 42, 42)] },
  { id: "qa_dario", name: "Dario Vance", plan: "pro", region: "us-west", active: 240, env: "test", devices: [sim("macos", "a101", "online", 180, 75, 126)] },
  { id: "qa_lab_1", name: "Test lab bench 1", plan: "free", region: "us-east", active: 30, env: "test", devices: [sim("g2", "a102", "online", 12, 40, 87)] },
  { id: "qa_lab_2", name: "Test lab bench 2", plan: "free", region: "us-east", active: 1800, env: "test", devices: [sim("g2", "a103", "offline", 1800, 40, 19)] },
];

const GRANTS: Partial<Record<ModelId, CapabilityScope[]>> = { g2: G2_GRANTS, macos: DESKTOP_GRANTS };
const THING: Partial<Record<ModelId, string>> = { g2: "G2", macos: "MacBook" };

/** A physical device's own name: whose it is and what it is. */
function deviceName(owner: string, model: ModelId, simulated: boolean | undefined, index: number): string {
  if (simulated) return `Simulated ${model === "macos" ? "macOS" : "G2"}`;
  const first = owner.split(" ")[0];
  return `${first}'s ${index > 0 ? "older " : ""}${THING[model] ?? model}`;
}

function build(seed: UserSeed): PortalUser {
  const devices: OwnedDevice[] = seed.devices.map(([modelId, suffix, firmware, state, seen, paired, deliveries7d, seen7d, simulated], i) => ({
    id: `dev_${simulated ? "sim" : modelId === "g2" ? "g2" : "desk"}_${suffix}`,
    userId: seed.id,
    modelId,
    simulated: simulated ?? false,
    name: deviceName(seed.name, modelId, simulated, seed.devices.slice(0, i).filter((d) => d[0] === modelId).length),
    firmware,
    state,
    lastSeenAt: minsAgo(seen),
    pairedAt: minsAgo(paired * 1440),
    deliveries7d,
    seen7d,
    grants: simulated ? SIM_GRANTS : (GRANTS[modelId] ?? []),
  }));
  const live = devices.filter((d) => d.state === "online").sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  return {
    id: seed.id,
    name: seed.name,
    env: seed.env ?? "live",
    plan: seed.plan,
    region: seed.region,
    devices,
    activeDeviceId: live[0]?.id ?? null,
    lastDeliveryAt: minsAgo(seed.active + 1),
    lastActiveMins: seed.active,
    prefs: { tone: "neutral", language: "en", quietFrom: "off", quietTo: "off", preferred: "auto", blocked: [], ...seed.prefs },
  };
}

export const ALL_USERS: readonly PortalUser[] = SEEDS.map(build);
export const ALL_DEVICES: readonly OwnedDevice[] = ALL_USERS.flatMap((u) => u.devices);

export const userById = (id: string): PortalUser | null => ALL_USERS.find((u) => u.id === id) ?? null;
export const ownedDevice = (id: string): OwnedDevice | null => ALL_DEVICES.find((d) => d.id === id) ?? null;

export const userDeliveries = (u: PortalUser) => u.devices.reduce((n, d) => n + d.deliveries7d, 0);
export const userSeen = (u: PortalUser) => u.devices.reduce((n, d) => n + d.seen7d, 0);
export const userRate = (u: PortalUser) => {
  const del = userDeliveries(u);
  return del === 0 ? 0 : Math.round((userSeen(u) / del) * 100);
};

export const needsRelink = (u: PortalUser) => u.devices.some((d) => d.state === "needs_relink");
export const hasStale = (u: PortalUser) => u.devices.some((d) => d.state === "stale");
export const hasIssues = (u: PortalUser) => needsRelink(u) || hasStale(u) || userRate(u) < 90;

export const STATE_LABEL: Record<DeviceState, string> = {
  online: "Online",
  offline: "Offline",
  stale: "Stale pairing",
  needs_relink: "Needs relink",
};

export const PLAN_LABEL: Record<Plan, string> = { free: "Free", pro: "Pro", team: "Team" };
export const REGION_LABEL: Record<PortalUser["region"], string> = { "us-east": "US east", "us-west": "US west", "eu-west": "EU west", "ap-south": "AP south" };
export const LANGUAGE_LABEL: Record<UserPrefs["language"], string> = { en: "English", es: "Spanish", de: "German", ja: "Japanese", pt: "Portuguese" };
export const TONE_LABEL: Record<UserPrefs["tone"], string> = { neutral: "Neutral", brief: "Brief", detailed: "Detailed" };
