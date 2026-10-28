/**
 * THE DEMO DEVELOPER ACCOUNT for `/playground/developers` — hard-coded, no DB, no API, no auth.
 *
 * Every row is typed with the frozen Device SDK contracts (`@dopl/contracts/device-sdk`), so the
 * portal renders the same shapes the `/v1` API returns; `fixtures.test.ts` parses each one through
 * its zod schema. Events, webhooks and the chart series live in `./activity.ts`.
 */
import type {
  ApiKey,
  CapabilityDescriptor,
  CapabilityId,
  Connection,
  ContextProfile,
  Device,
  DeviceKind,
  Environment,
  Grant,
} from "@dopl/contracts/device-sdk";
import { CAPABILITY_RISK_TIER } from "@dopl/contracts/device-sdk";
import { DOPL_KIND_PROFILES } from "@/features/device-sdk/delivery/default-profiles";
import { GLASSES_REPLY_GUIDANCE } from "../../../../../packages/mcp-server/src/tools/glasses-reply-guidance";

/** The demo's clock: every relative time on the page is measured from here. */
export const DEMO_NOW = "2026-10-27T12:00:00.000Z";
const NOW_MS = Date.parse(DEMO_NOW);
/** ISO timestamp `minutes` before {@link DEMO_NOW}. */
export const ago = (minutes: number): string => new Date(NOW_MS - minutes * 60_000).toISOString();
const DAY = 24 * 60;

export const DEMO_ORG = { id: "org_acme", name: "Acme Agents" } as const;
export const DEMO_PROJECT = {
  id: "proj_acme_assistant",
  org_id: DEMO_ORG.id,
  name: "Acme Assistant",
  api_version: "2026-10-27",
  branding: { display_name: "Acme Assistant", accent_color: "#3b5bdb" },
} as const;

/* ───────────────────────────── devices ───────────────────────────── */

function cap(adapter: string, capability: CapabilityId, latency: CapabilityDescriptor["latency_class"], limits: CapabilityDescriptor["limits"] = {}): CapabilityDescriptor {
  return { capability, limits, latency_class: latency, risk_tier: CAPABILITY_RISK_TIER[capability], since_adapter: adapter };
}

const G2_CAPS: CapabilityDescriptor[] = [
  cap("even_g2@0.1.0", "presence.read", "realtime"),
  cap("even_g2@0.1.0", "present.notify", "interactive", { max_lines: 5, charset: "ascii+box" }),
  cap("even_g2@0.1.0", "present.display", "interactive", {
    width_px: 576,
    height_px: 248,
    max_blocks: 12,
    max_text_bytes: 960,
    charset: "ascii+box",
    color: "mono",
  }),
  cap("even_g2@0.1.0", "ask.choice", "interactive", { min_options: 2, max_options: 4, hold_s: 200 }),
  cap("even_g2@0.1.0", "input.utterance", "realtime"),
  cap("even_g2@0.1.0", "input.tap", "realtime"),
];

const DESKTOP_CAPS: CapabilityDescriptor[] = [
  cap("desktop@0.1.0", "presence.read", "realtime", { online_window_s: 120 }),
  cap("desktop@0.1.0", "present.notify", "interactive"),
];

const SIM_CAPS: Record<"glasses" | "phone" | "robot", CapabilityDescriptor[]> = {
  glasses: G2_CAPS.map((c) => ({ ...c, since_adapter: "simulator@0.1.0" })),
  phone: [
    cap("simulator@0.1.0", "presence.read", "realtime"),
    cap("simulator@0.1.0", "present.notify", "interactive"),
    cap("simulator@0.1.0", "ask.confirm", "interactive"),
    cap("simulator@0.1.0", "capture.photo", "deferred"),
  ],
  robot: [
    cap("simulator@0.1.0", "state.read", "realtime"),
    cap("simulator@0.1.0", "act.set", "interactive"),
    cap("simulator@0.1.0", "act.motion.move", "interactive", { max_speed_mps: 0.5 }),
  ],
};

function g2(id: string, online: boolean, seenMin: number, firmware = "1.4.2"): Device {
  return {
    id,
    kind: "glasses",
    vendor: "even_realities",
    model: "even_g2",
    firmware,
    adapter_id: "even_g2",
    adapter_version: "0.1.0",
    capabilities: G2_CAPS,
    online,
    last_seen_at: ago(seenMin),
  };
}

function desktop(id: string, online: boolean, seenMin: number): Device {
  return {
    id,
    kind: "desktop",
    vendor: "dopl",
    model: "macos",
    firmware: "1.42.0",
    adapter_id: "desktop",
    adapter_version: "0.1.0",
    capabilities: DESKTOP_CAPS,
    online,
    last_seen_at: ago(seenMin),
  };
}

function sim(id: string, kind: "glasses" | "phone" | "robot", online: boolean): Device {
  return {
    id,
    kind,
    vendor: "dopl",
    model: `simulated_${kind}`,
    firmware: null,
    adapter_id: "simulator",
    adapter_version: "0.1.0",
    capabilities: SIM_CAPS[kind],
    online,
    last_seen_at: online ? ago(1) : ago(3 * 60),
  };
}

/* ───────────────────────────── connections ───────────────────────────── */

const grant = (scope: Grant["scope"], grantedMin: number, ttlDays: number | null = null): Grant => ({
  scope,
  granted_at: ago(grantedMin),
  expires_at: ttlDays === null ? null : ago(grantedMin - ttlDays * DAY),
});

function conn(
  id: string,
  user: string,
  device: Device,
  grants: Grant[],
  createdMin: number,
  status: Connection["status"] = "active"
): Connection {
  return {
    id,
    external_user_id: user,
    status,
    device,
    grants,
    created_at: ago(createdMin),
    revoked_at: status === "revoked" ? ago(createdMin / 4) : null,
  };
}

const GLASSES_GRANTS = (m: number) => [grant("present.*", m), grant("ask.*", m), grant("input.*", m), grant("state.*", m)];
const DESKTOP_GRANTS = (m: number) => [grant("present.notify", m), grant("presence.read", m)];

const TEST_CONNECTIONS: Connection[] = [
  conn("conn_t_01", "user_dev_sam", g2("dev_t_g2_01", true, 2), GLASSES_GRANTS(6 * DAY), 6 * DAY),
  conn("conn_t_02", "user_dev_sam", desktop("dev_t_desk_01", true, 1), DESKTOP_GRANTS(6 * DAY), 6 * DAY),
  conn("conn_t_03", "user_qa_ines", sim("dev_t_sim_glasses", "glasses", true), GLASSES_GRANTS(2 * DAY), 2 * DAY),
  conn(
    "conn_t_04",
    "user_qa_ines",
    sim("dev_t_sim_phone", "phone", true),
    [grant("present.*", 2 * DAY), grant("ask.*", 2 * DAY), grant("capture.photo", 2 * DAY, 7)],
    2 * DAY
  ),
  conn(
    "conn_t_05",
    "user_qa_robotics",
    sim("dev_t_sim_robot", "robot", true),
    [grant("state.*", DAY), grant("act.*", DAY), grant("act.motion.*", DAY, 1)],
    DAY
  ),
  conn("conn_t_06", "sim_device_offline", sim("dev_t_sim_offline", "glasses", false), GLASSES_GRANTS(DAY), DAY),
  conn("conn_t_07", "sim_confirm_denied", sim("dev_t_sim_denied", "robot", true), [grant("act.*", DAY), grant("act.motion.*", DAY)], DAY),
];

const LIVE_USERS = [
  "user_1042",
  "user_1077",
  "user_1093",
  "user_1108",
  "user_1131",
  "user_1164",
  "user_1172",
  "user_1209",
  "user_1215",
  "user_1240",
];

const LIVE_CONNECTIONS: Connection[] = LIVE_USERS.flatMap((user, i): Connection[] => {
  const created = (30 - i * 2) * DAY;
  const glasses = conn(
    `conn_l_${i}g`,
    user,
    g2(`dev_l_g2_${i}`, i % 3 !== 2, i % 3 === 2 ? 9 * 60 : 1 + i, i % 4 === 0 ? "1.4.1" : "1.4.2"),
    GLASSES_GRANTS(created),
    created,
    i === 7 ? "needs_reauth" : i === 9 ? "revoked" : "active"
  );
  if (i % 2 === 1) return [glasses];
  return [glasses, conn(`conn_l_${i}d`, user, desktop(`dev_l_desk_${i}`, i !== 4, i === 4 ? 2 * DAY : 3), DESKTOP_GRANTS(created), created)];
});

/* ───────────────────────────── API keys ───────────────────────────── */

const key = (
  id: string,
  kind: ApiKey["kind"],
  env: Environment,
  prefix: string,
  scopes: ApiKey["scopes"],
  createdMin: number,
  usedMin: number | null,
  extra: Partial<Pick<ApiKey, "revoked_at" | "expires_at">> = {}
): ApiKey => ({
  id,
  project_id: DEMO_PROJECT.id,
  kind,
  env,
  prefix,
  scopes,
  created_at: ago(createdMin),
  last_used_at: usedMin === null ? null : ago(usedMin),
  revoked_at: extra.revoked_at ?? null,
  expires_at: extra.expires_at ?? null,
});

const ALL_SCOPES: ApiKey["scopes"] = ["connect", "devices:read", "actions:write", "analytics:read"];

const TEST_KEYS: ApiKey[] = [
  key("key_t_1", "secret", "test", "sk_test_9cW2", ALL_SCOPES, 14 * DAY, 3),
  key("key_t_2", "secret", "test", "sk_test_Lm4x", ["devices:read", "analytics:read"], 9 * DAY, 2 * 60),
  key("key_t_3", "publishable", "test", "pk_test_7HqA", ["connect"], 14 * DAY, 25),
];

const LIVE_KEYS: ApiKey[] = [
  key("key_l_1", "secret", "live", "sk_live_4fQa", ALL_SCOPES, 3 * DAY, 1),
  key("key_l_2", "secret", "live", "sk_live_Zp81", ALL_SCOPES, 40 * DAY, 3 * DAY, { expires_at: ago(-4 * DAY) }),
  key("key_l_3", "secret", "live", "sk_live_b0Rt", ["analytics:read"], 21 * DAY, 6 * 60),
  key("key_l_4", "publishable", "live", "pk_live_Jd3K", ["connect"], 40 * DAY, 4),
  key("key_l_5", "secret", "live", "sk_live_Qe09", ALL_SCOPES, 60 * DAY, 45 * DAY, { revoked_at: ago(41 * DAY) }),
];

/* ───────────────────────────── context profiles ───────────────────────────── */

/** A profile row as the portal lists it: the Dopl default for a kind, or the project's override. */
export interface DemoProfile {
  source: "dopl_default" | "project";
  profile: ContextProfile;
}

/** Dopl's defaults are the real ones; the glasses text is THE one copy, imported, never restated. */
const DOPL_DEFAULTS: DemoProfile[] = (["glasses", "phone", "desktop", "watch", "vehicle", "robot"] as DeviceKind[]).map(
  (kind) => ({
    source: "dopl_default",
    profile: kind === "glasses" ? { ...DOPL_KIND_PROFILES.glasses, prompt_append: GLASSES_REPLY_GUIDANCE } : DOPL_KIND_PROFILES[kind],
  })
);

const ACME_G2_OVERRIDE: DemoProfile = {
  source: "project",
  profile: {
    id: "acme-g2-briefings",
    version: 3,
    match: { kind: "glasses", model: "even_g2" },
    prompt_append:
      "They are on Acme glasses: lead with the answer in one line, then at most three short bullet-free lines. Offer choices through ask.choice.",
    output: { max_lines: 4, max_chars: 240, format: "plain", markdown: false },
    allowed_capabilities: ["state.*", "present.*", "ask.*", "input.*"],
    display_template: "acme_card",
    confirmation: { T3: "on_device", T4: "deny" },
    overflow: { send_to: "desktop" },
  },
};

/* ───────────────────────────── per-environment bundle ───────────────────────────── */

export interface EnvFixtures {
  env: Environment;
  keys: ApiKey[];
  connections: Connection[];
  profiles: DemoProfile[];
  /** Connected devices, one per active or re-auth connection (a revoked one drops out). */
  devices: Device[];
}

function bundle(env: Environment, keys: ApiKey[], connections: Connection[]): EnvFixtures {
  return {
    env,
    keys,
    connections,
    profiles: [ACME_G2_OVERRIDE, ...DOPL_DEFAULTS],
    devices: connections.filter((c) => c.status !== "revoked").map((c) => c.device),
  };
}

export const DEMO_ENVS: Record<Environment, EnvFixtures> = {
  test: bundle("test", TEST_KEYS, TEST_CONNECTIONS),
  live: bundle("live", LIVE_KEYS, LIVE_CONNECTIONS),
};

/** Who owns a device, for the Devices table. */
export function ownerOf(fx: EnvFixtures, deviceId: string): string | null {
  return fx.connections.find((c) => c.device.id === deviceId)?.external_user_id ?? null;
}
