import { describe, expect, it } from "vitest";
import {
  ApiKeySchema,
  ConnectionSchema,
  ContextProfileSchema,
  DeviceEventRowSchema,
  DeviceSchema,
  ENVIRONMENTS,
  TEST_MAGIC_DEVICE_IDS,
  WebhookEventNameSchema,
} from "@dopl/contracts/device-sdk";
import { GLASSES_REPLY_GUIDANCE } from "../../../../../packages/mcp-server/src/tools/glasses-reply-guidance";
import { DEMO_ACTIVITY } from "./activity";
import { DEMO_ENVS } from "./fixtures";

/** The demo portal's fixtures are wire-shaped: every row parses through the real contract schema. */
describe.each(ENVIRONMENTS)("developer portal demo fixtures (%s)", (env) => {
  const fx = DEMO_ENVS[env];
  const act = DEMO_ACTIVITY[env];

  it("keys, connections, devices and profiles parse as contracts", () => {
    for (const k of fx.keys) {
      expect(ApiKeySchema.parse(k)).toEqual(k);
      expect(k.env).toBe(env);
      expect(k.prefix.startsWith(k.kind === "publishable" ? "pk_" : `sk_${env}_`)).toBe(true);
    }
    for (const c of fx.connections) expect(ConnectionSchema.parse(c)).toEqual(c);
    for (const d of fx.devices) expect(DeviceSchema.parse(d)).toEqual(d);
    for (const p of fx.profiles) expect(ContextProfileSchema.parse(p.profile)).toEqual(p.profile);
  });

  it("events and webhook rows are contract-shaped and in this env", () => {
    expect(act.events.length).toBeGreaterThan(20);
    for (const e of act.events) {
      expect(DeviceEventRowSchema.parse(e)).toEqual(e);
      expect(e.env).toBe(env);
    }
    for (const w of act.webhooks) expect(WebhookEventNameSchema.parse(w.event_type)).toBe(w.event_type);
    expect(act.series).toHaveLength(30);
  });

  it("the glasses default is the one guidance text, plus exactly one project override", () => {
    const glasses = fx.profiles.find((p) => p.source === "dopl_default" && p.profile.match.kind === "glasses");
    expect(glasses?.profile.prompt_append).toBe(GLASSES_REPLY_GUIDANCE);
    expect(fx.profiles.filter((p) => p.source === "project")).toHaveLength(1);
  });
});

describe("test env", () => {
  it("carries simulators for both magic ids, and live carries none", () => {
    const users = DEMO_ENVS.test.connections.map((c) => c.external_user_id);
    for (const magic of Object.keys(TEST_MAGIC_DEVICE_IDS)) expect(users).toContain(magic);
    expect(DEMO_ENVS.live.devices.some((d) => d.adapter_id === "simulator")).toBe(false);
  });
});
