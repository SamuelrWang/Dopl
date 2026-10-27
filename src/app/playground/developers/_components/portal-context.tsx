"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { ApiKey, ContextProfile, Environment } from "@dopl/contracts/device-sdk";
import { DEMO_ENVS, DEMO_NOW, DEMO_PROJECT, type EnvFixtures } from "../_data/fixtures";
import { DEMO_ACTIVITY, type EnvActivity } from "../_data/activity";

/**
 * The portal's LOCAL state: the env switch, keys created / revoked in this tab, and edits to the
 * project's profile override. A module-level store (not a layout provider) so it survives moving
 * between sections; nothing is sent anywhere, and a reload restores the fixtures. The server always
 * renders the initial snapshot.
 */
interface Snapshot {
  env: Environment;
  keys: Record<Environment, ApiKey[]>;
  overrides: Record<Environment, ContextProfile | null>;
}

const INITIAL: Snapshot = {
  env: "test",
  keys: { test: DEMO_ENVS.test.keys, live: DEMO_ENVS.live.keys },
  overrides: { test: null, live: null },
};

let snapshot = INITIAL;
const listeners = new Set<() => void>();

function update(fn: (s: Snapshot) => Snapshot) {
  snapshot = fn(snapshot);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const randomTail = (n: number) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

function setEnv(env: Environment) {
  update((s) => ({ ...s, env }));
}

/** Adds a key to the current env and returns the full secret (shown once). */
function createKey(kind: ApiKey["kind"], scopes: ApiKey["scopes"]): string {
  const env = snapshot.env;
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

export interface PortalState {
  env: Environment;
  setEnv: (env: Environment) => void;
  fx: EnvFixtures;
  activity: EnvActivity;
  keys: ApiKey[];
  createKey: typeof createKey;
  revokeKey: typeof revokeKey;
  saveOverride: typeof saveOverride;
}

export function usePortal(): PortalState {
  const s = useSyncExternalStore(subscribe, () => snapshot, () => INITIAL);
  return useMemo(() => {
    const base = DEMO_ENVS[s.env];
    const override = s.overrides[s.env];
    const fx: EnvFixtures = override
      ? { ...base, profiles: base.profiles.map((p) => (p.source === "project" ? { ...p, profile: override } : p)) }
      : base;
    return { env: s.env, setEnv, fx, activity: DEMO_ACTIVITY[s.env], keys: s.keys[s.env], createKey, revokeKey, saveOverride };
  }, [s]);
}
