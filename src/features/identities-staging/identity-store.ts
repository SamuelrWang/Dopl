"use client";

/**
 * UI-STAGING IN-MEMORY STORE for /identities: the identity rows the staged hooks read and write.
 * A tiny external store (`useSyncExternalStore`) so every section re-renders on a write, as the
 * real optimistic cache patch does. No Supabase, no fetch. `resetIdentityStore()` runs on mount.
 */

import { useSyncExternalStore } from "react";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import { SEED_IDENTITIES } from "./data";

interface IdentityState {
  identities: AgentIdentity[];
  /** Staging switch: the Personal (home-shelf) read answers with an error until retried. */
  homeReadFails: boolean;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let state: IdentityState = { identities: clone(SEED_IDENTITIES), homeReadFails: false };
const listeners = new Set<() => void>();

function emit(next: IdentityState) {
  state = next;
  for (const l of listeners) l();
}

export function resetIdentityStore(): void {
  state = { identities: clone(SEED_IDENTITIES), homeReadFails: false };
}

export function setHomeReadFails(fails: boolean): void {
  emit({ ...state, homeReadFails: fails });
}

export function useIdentityState(): IdentityState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}

export function latency(ms = 260): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let seq = 0;
export function insertIdentity(row: Omit<AgentIdentity, "id">): AgentIdentity {
  seq += 1;
  const created = { ...row, id: `id-staging-${Date.now().toString(36)}-${seq}` };
  emit({ ...state, identities: [...state.identities, created] });
  return created;
}

export function replaceIdentity(row: AgentIdentity): void {
  emit({
    ...state,
    identities: state.identities.map((i) => (i.id === row.id ? row : i)),
  });
}

export function removeIdentity(id: string): void {
  emit({ ...state, identities: state.identities.filter((i) => i.id !== id) });
}
