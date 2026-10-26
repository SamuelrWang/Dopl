"use client";

import { useSyncExternalStore } from "react";
import type { RuntimeCredentialStatus } from "@/shared/lib/spa-bridge";
import { STAGING_RUNTIME_CREDENTIALS } from "../settings-mock-data";

/**
 * STUB of `@/features/channels/components/runtime-signin` — same exports, over an in-memory list
 * instead of main's `runtimeAuth` bridge. "Sign in" shows "Signing in…" and lands "Connected"
 * after a beat; Cancel puts it back. `raiseStagingSignInPrompt` lets `/popups` raise the app-level
 * prompt (`RuntimeSignInPrompt`) the way main does.
 */

let runtimes: RuntimeCredentialStatus[] = STAGING_RUNTIME_CREDENTIALS.map((r) => ({ ...r }));
const listeners = new Set<(next: RuntimeCredentialStatus[]) => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function patch(runtimeId: string, change: Partial<RuntimeCredentialStatus>) {
  runtimes = runtimes.map((r) => (r.runtimeId === runtimeId ? { ...r, ...change } : r));
  for (const l of listeners) l(runtimes);
}

export function canSignInToRuntime(): boolean {
  return true;
}

function later(runtimeId: string, change: Partial<RuntimeCredentialStatus>): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    timers.set(
      runtimeId,
      setTimeout(() => {
        timers.delete(runtimeId);
        patch(runtimeId, change);
        resolve({ ok: true });
      }, 1200)
    );
  });
}

export function signInToRuntime(runtimeId?: string | null): Promise<{ ok: boolean }> {
  const id = runtimeId || "claude";
  patch(id, { state: "signing-in" });
  return later(id, { state: "connected", prompt: false, full: "off" });
}

export function signInFullToRuntime(runtimeId: string): Promise<{ ok: boolean }> {
  patch(runtimeId, { full: "signing-in" });
  return later(runtimeId, { full: "on" });
}

export function canCancelRuntimeSignIn(): boolean {
  return true;
}

export function cancelRuntimeSignIn(runtimeId: string): void {
  clearTimeout(timers.get(runtimeId));
  timers.delete(runtimeId);
  const row = runtimes.find((r) => r.runtimeId === runtimeId);
  patch(runtimeId, row?.state === "signing-in" ? { state: "not-connected" } : { full: "off" });
}

export function dismissSignInPrompt(runtimeId: string): void {
  patch(runtimeId, { prompt: false });
}

/** STAGING ONLY: what main does when an agent needs a runtime's sign-in. */
export function raiseStagingSignInPrompt(runtimeId = "grok"): void {
  patch(runtimeId, { prompt: true });
}

export function useRuntimeCredentials(): RuntimeCredentialStatus[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function subscribe(onChange: () => void): () => void {
  const listener = () => onChange();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): RuntimeCredentialStatus[] {
  return runtimes;
}
