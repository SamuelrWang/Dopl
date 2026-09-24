"use client";

/**
 * Dopl's own runtime credentials over the bridge (`runtimeAuth`, main's `runtime-credentials.js`): one
 * runtime's sign-in, every runtime's live status, and closing a sign-in prompt. The subject is the
 * machine's credential for a runtime, not an agent. No credential crosses the bridge in either direction.
 */

import { useEffect, useState } from "react";
import { getSpaBridge, type RuntimeCredentialStatus } from "@/shared/lib/spa-bridge";

/** Whether this build can sign in at all: detects the BRIDGE op, never this module's wrapper. */
export function canSignInToRuntime(): boolean {
  return typeof getSpaBridge()?.runtimeAuth?.signIn === "function";
}

/**
 * Run the sign-in; `''`/absent = the default runtime. `ok` is the credential after the flow, and main
 * has already released that runtime's held sessions when it answers `ok`.
 */
export async function signInToRuntime(
  runtimeId?: string | null
): Promise<{ ok: boolean }> {
  const bridge = getSpaBridge()?.runtimeAuth;
  if (typeof bridge?.signIn !== "function") return { ok: false };
  try {
    const res = await bridge.signIn(runtimeId ?? "");
    return { ok: res?.ok === true };
  } catch {
    return { ok: false };
  }
}

/** Close one runtime's sign-in prompt; main keeps it closed until that runtime's next sign-in. */
export function dismissSignInPrompt(runtimeId: string): void {
  void getSpaBridge()?.runtimeAuth?.dismissPrompt?.(runtimeId).catch(() => {});
}

const NONE: RuntimeCredentialStatus[] = [];

/** Every in-app-sign-in runtime's status, live; empty without the bridge (the web tree, an older desktop). */
export function useRuntimeCredentials(): RuntimeCredentialStatus[] {
  const [runtimes, setRuntimes] = useState(NONE);
  useEffect(() => {
    const auth = getSpaBridge()?.runtimeAuth;
    if (typeof auth?.status !== "function" || typeof auth.onStatus !== "function") return;
    // The first read is stale once a push lands (it is newer) or the surface unmounts.
    let stale = false;
    const off = auth.onStatus((payload) => {
      stale = true;
      setRuntimes(payload.runtimes);
    });
    auth.status().then(
      (payload) => { if (!stale) setRuntimes(payload.runtimes); },
      () => {}
    );
    return () => {
      stale = true;
      off();
    };
  }, []);
  return runtimes;
}
