"use client";

/**
 * Sign this Mac in to ONE runtime — the entry into its auth recovery flow (`runtimeAuth.signIn`, main's
 * `runtime:signIn`). The subject is the machine's credential for that runtime, not an agent, so it
 * takes a runtime id and nothing else. No credential crosses the bridge in either direction.
 */

import { getSpaBridge } from "@/shared/lib/spa-bridge";

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
