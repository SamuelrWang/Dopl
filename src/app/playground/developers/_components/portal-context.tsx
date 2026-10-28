"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { ApiKey, CapabilityDescriptor, ContextProfile, Environment } from "@dopl/device-contracts";
import { DEMO_ENVS, DEMO_NOW, DEMO_PROJECT, type EnvFixtures } from "../_data/fixtures";
import { DEMO_ACTIVITY, type EnvActivity } from "../_data/activity";
import { DEMO_SESSIONS, type ConnectSessionRow } from "../_data/connect-sessions";
import { buildLog, type LogRow } from "../_data/log";
import { randomTail } from "./portal-actions";
import { getServerSnapshot, getSnapshot, subscribe, update, type Snapshot } from "./portal-store";
import {
  addType,
  goLive,
  recordTests,
  removeType,
  stepOwnDevice,
  type CapabilityTest,
  type TypeState,
} from "../_data/device-type-status";
import { seedState } from "../_data/device-types";

/**
 * `usePortal`: the store (`./portal-store.ts`) as each section reads it: the env's fixtures with
 * this tab's edits laid over them, the simulator's and portal's rows merged into the activity, and
 * the unified log built from all of it. Also the device-type and key actions.
 */

function setEnv(env: Environment) {
  update((s) => ({ ...s, env }));
}

/** Adds a key to the current env and returns the full secret (shown once). */
function createKey(kind: ApiKey["kind"], scopes: ApiKey["scopes"]): string {
  const env = getSnapshot().env;
  const prefix = kind === "publishable" ? `pk_${env}_` : `sk_${env}_`;
  const secret = prefix + randomTail(24);
  const row: ApiKey = {
    id: `key_new_${randomTail(6)}`,
    project_id: DEMO_PROJECT.id,
    kind,
    env,
    prefix: secret.slice(0, prefix.length + 4),
    scopes: kind === "publishable" ? ["connect"] : scopes,
    created_at: DEMO_NOW,
    last_used_at: null,
    revoked_at: null,
    expires_at: null,
  };
  update((s) => ({ ...s, keys: { ...s.keys, [env]: [row, ...s.keys[env]] } }));
  return secret;
}

function revokeKey(id: string) {
  update((s) => ({
    ...s,
    keys: { ...s.keys, [s.env]: s.keys[s.env].map((k) => (k.id === id ? { ...k, revoked_at: DEMO_NOW } : k)) },
  }));
}

function saveOverride(profile: ContextProfile) {
  update((s) => ({ ...s, overrides: { ...s.overrides, [s.env]: { ...profile, version: (profile.version ?? 0) + 1 } } }));
}

type Descriptors = readonly CapabilityDescriptor[] | null;

const typeOf = (s: Snapshot, id: string, d: Descriptors) => s.types[id] ?? seedState(id, d);

function changeType(id: string, d: Descriptors, fn: (t: TypeState) => TypeState) {
  update((s) => ({ ...s, types: { ...s.types, [id]: fn(typeOf(s, id, d)) } }));
}

const addDeviceType = (id: string, d: Descriptors) => changeType(id, d, addType);
const removeDeviceType = (id: string, d: Descriptors) => changeType(id, d, removeType);
const goLiveType = (id: string, d: Descriptors) => changeType(id, d, goLive);
const stepOwnDeviceType = (id: string, d: Descriptors) => changeType(id, d, stepOwnDevice);
function recordTypeTests(id: string, d: readonly CapabilityDescriptor[], results: CapabilityTest[]) {
  changeType(id, d, (t) => recordTests(t, results, d.map((x) => x.capability)));
}

export interface DeviceTypeActions {
  typeState: (id: string, d: Descriptors) => TypeState;
  addDeviceType: typeof addDeviceType;
  removeDeviceType: typeof removeDeviceType;
  goLiveType: typeof goLiveType;
  stepOwnDeviceType: typeof stepOwnDeviceType;
  recordTypeTests: typeof recordTypeTests;
  /** The project's first active test secret key: the one the connect code shows, masked. */
  testKey: ApiKey | null;
}

export interface PortalState extends DeviceTypeActions {
  env: Environment;
  setEnv: (env: Environment) => void;
  fx: EnvFixtures;
  /** The fixtures' activity plus the simulator's and the portal's own rows. */
  activity: EnvActivity;
  sessions: ConnectSessionRow[];
  /** Requests, Connect, deliveries and webhooks in one list, newest first. */
  log: LogRow[];
  /** The whole store, for the sections that read their own slice (simulator, webhooks, Connect). */
  store: Snapshot;
  keys: ApiKey[];
  createKey: typeof createKey;
  revokeKey: typeof revokeKey;
  saveOverride: typeof saveOverride;
}

export function usePortal(): PortalState {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => {
    const base = DEMO_ENVS[s.env];
    const raw = DEMO_ACTIVITY[s.env];
    const test = s.env === "test";
    const activity: EnvActivity = {
      ...raw,
      events: test ? [...s.sim.events, ...raw.events] : raw.events,
      webhooks: [...s.sent[s.env], ...(test ? s.sim.webhooks : []), ...raw.webhooks],
    };
    const sessions = DEMO_SESSIONS[s.env];
    const override = s.overrides[s.env];
    const fx: EnvFixtures = override
      ? { ...base, profiles: base.profiles.map((p) => (p.source === "project" ? { ...p, profile: override } : p)) }
      : base;
    return {
      env: s.env,
      setEnv,
      fx,
      activity,
      sessions,
      log: buildLog({ events: activity.events, webhooks: activity.webhooks, sessions, keys: s.keys[s.env] }),
      store: s,
      keys: s.keys[s.env],
      createKey,
      revokeKey,
      saveOverride,
      typeState: (id: string, d: Descriptors) => typeOf(s, id, d),
      addDeviceType,
      removeDeviceType,
      goLiveType,
      stepOwnDeviceType,
      recordTypeTests,
      testKey: s.keys.test.find((k) => k.kind === "secret" && !k.revoked_at) ?? null,
    };
  }, [s]);
}
