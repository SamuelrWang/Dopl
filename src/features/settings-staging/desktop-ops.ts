/**
 * The main-process ops the Settings modal and the channel Settings tab reach over the bridge,
 * played in memory: `runtimeAuth` (the runtime sign-in bars and the app-level sign-in prompt)
 * and `channels.{get,set}AgentDefaults` / `{get,set}LaunchPosture` (the launch record
 * `channels/hooks/use-launch-selection.ts` reads). Registered by the frame's bridge layer
 * (`ui-staging/staging-app-bridge.ts`).
 */

import type { RuntimeCredentialStatus } from "@/shared/lib/spa-bridge";
import {
  STAGING_LEVEL_SETTINGS,
  STAGING_RUNTIME_CREDENTIALS,
  STAGING_RUNTIMES,
} from "./settings-mock-data";

const SIGN_IN_MS = 1200;

let runtimes: RuntimeCredentialStatus[] = STAGING_RUNTIME_CREDENTIALS.map((r) => ({ ...r }));
const statusListeners = new Set<(payload: { runtimes: RuntimeCredentialStatus[] }) => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function patch(runtimeId: string, change: Partial<RuntimeCredentialStatus>): void {
  runtimes = runtimes.map((r) => (r.runtimeId === runtimeId ? { ...r, ...change } : r));
  for (const listener of statusListeners) listener({ runtimes });
}

function later(runtimeId: string, change: Partial<RuntimeCredentialStatus>): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    timers.set(
      runtimeId,
      setTimeout(() => {
        timers.delete(runtimeId);
        patch(runtimeId, change);
        resolve({ ok: true });
      }, SIGN_IN_MS)
    );
  });
}

/** What main does when an agent needs a runtime's sign-in: raise its prompt. */
export function raiseStagingSignInPrompt(runtimeId = "grok"): void {
  patch(runtimeId, { prompt: true });
}

export const stagingRuntimeAuth = {
  async signIn(runtimeId = "claude") {
    patch(runtimeId, { state: "signing-in" });
    return later(runtimeId, { state: "connected", prompt: false, full: "off" });
  },
  async signInFull(runtimeId = "claude") {
    patch(runtimeId, { full: "signing-in" });
    return later(runtimeId, { full: "on" });
  },
  async cancelSignIn(runtimeId: string) {
    clearTimeout(timers.get(runtimeId));
    timers.delete(runtimeId);
    const row = runtimes.find((r) => r.runtimeId === runtimeId);
    patch(runtimeId, row?.state === "signing-in" ? { state: "not-connected" } : { full: "off" });
    return { ok: true };
  },
  async status() {
    return { runtimes };
  },
  onStatus(callback: (payload: { runtimes: RuntimeCredentialStatus[] }) => void) {
    statusListeners.add(callback);
    return () => {
      statusListeners.delete(callback);
    };
  },
  async dismissPrompt(runtimeId: string) {
    patch(runtimeId, { prompt: false });
    return { ok: true };
  },
};

type LaunchRecord = Record<string, unknown>;

const DEFAULTS: LaunchRecord = { v: 1, runtime: "", level: "auto", messages: "auto_inbound", byRuntime: {} };
const records = new Map<string, LaunchRecord>();
let agentChain = false;

/** Main's reply shape: the record plus the runtimes, connections and per-runtime levels. */
function reply(key: string): Record<string, unknown> {
  return {
    selection: records.get(key) ?? DEFAULTS,
    runtimes: STAGING_RUNTIMES,
    connected: runtimes.filter((r) => r.state === "connected").map((r) => r.runtimeId),
    defaultRuntime: "claude",
    permissionLevels: STAGING_LEVEL_SETTINGS,
    agentChain,
  };
}

function write(key: string, payload: LaunchRecord): { ok: true } {
  if (typeof payload.agentChain === "boolean") agentChain = payload.agentChain;
  records.set(key, { ...(records.get(key) ?? DEFAULTS), ...payload });
  return { ok: true };
}

export const stagingChannelsOps = {
  async getAgentDefaults() {
    return reply("defaults");
  },
  async setAgentDefaults(defaults: LaunchRecord) {
    return write("defaults", defaults);
  },
  async getLaunchPosture(channelId: string) {
    return reply(`channel:${channelId}`);
  },
  async setLaunchPosture(channelId: string, preset: LaunchRecord) {
    return write(`channel:${channelId}`, preset);
  },
};
